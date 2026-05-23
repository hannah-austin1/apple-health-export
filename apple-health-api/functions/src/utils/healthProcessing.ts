import { HealthMetric, TimeSample } from "../types";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface Sample {
  type: string;
  date: string;
  value: string;
  unit: string;
}

const AVERAGE_TYPES = new Set([
  "HeartRate",
  "HeartRateVariabilitySDNN",
  "OxygenSaturation",
  "RespiratoryRate",
  "BodyTemperature",
  "SystolicBloodPressure",
  "DiastolicBloodPressure",
  "BloodGlucose",
  "Vo2Max",
  "Weight",
  "BodyMassIndex",
  "BodyFatPercentage",
  "LeanBodyMass",
]);

const COUNT_TYPES = new Set([
  "Steps",
  "FlightsClimbed",
  "NikeFuel",
]);

const TIMESERIES_TYPES = new Set([
  "Steps",
]);

/**
 * Parse a raw date string into YYYY-MM-DD format.
 */
export function parseDate(raw: string): string | null {
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  const rfc = raw.match(/^[A-Za-z]{3},\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (rfc) {
    const months: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04",
      May: "05", Jun: "06", Jul: "07", Aug: "08",
      Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    return `${rfc[3]}-${months[rfc[2]]}-${rfc[1].padStart(2, "0")}`;
  }
  return null;
}

/** Returns an error message, or null when the range is valid. */
export function validateDateRange(from?: string, to?: string): string | null {
  if (from && !DATE_RE.test(from)) {
    return "'from' must be YYYY-MM-DD.";
  }
  if (to && !DATE_RE.test(to)) {
    return "'to' must be YYYY-MM-DD.";
  }
  if (from && to && from > to) {
    return "'from' must be on or before 'to'.";
  }
  return null;
}

export interface AggregatedMetrics {
  sum: number;
  count: number;
  unit: string;
}

export interface AggregateResult {
  byDate: Map<string, Map<string, AggregatedMetrics>>;
  timeseriesByDate: Map<string, Map<string, TimeSample[]>>;
  skippedOutOfRange: number;
}

/**
 * Group samples by date and metric type, applying optional date filters.
 */
export function aggregateSamples(
  data: Sample[],
  fromDate: string | null,
  toDate: string | null
): AggregateResult {
  const byDate = new Map<string, Map<string, AggregatedMetrics>>();
  const timeseriesByDate = new Map<string, Map<string, TimeSample[]>>();
  let skippedOutOfRange = 0;

  for (const sample of data) {
    const date = parseDate(sample.date);
    if (!date) continue;

    if (fromDate && date < fromDate) {
      skippedOutOfRange++;
      continue;
    }
    if (toDate && date > toDate) {
      skippedOutOfRange++;
      continue;
    }

    const value = parseFloat(sample.value);
    if (isNaN(value)) continue;

    const type = sample.type.replace(/\s+/g, "");
    if (!byDate.has(date)) byDate.set(date, new Map());
    const metrics = byDate.get(date) as Map<string, AggregatedMetrics>;

    if (!metrics.has(type)) {
      metrics.set(type, { sum: 0, count: 0, unit: sample.unit });
    }
    const m = metrics.get(type) as AggregatedMetrics;
    m.sum += value;
    m.count += 1;

    if (TIMESERIES_TYPES.has(type)) {
      if (!timeseriesByDate.has(date)) timeseriesByDate.set(date, new Map());
      const ts = timeseriesByDate.get(date) as Map<string, TimeSample[]>;
      if (!ts.has(type)) ts.set(type, []);
      (ts.get(type) as TimeSample[]).push({ time: sample.date, value });
    }
  }

  return { byDate, timeseriesByDate, skippedOutOfRange };
}

export function computeMetricValue(type: string, sum: number, count: number): number {
  if (AVERAGE_TYPES.has(type)) {
    return Math.round((sum / count) * 100) / 100;
  }
  if (COUNT_TYPES.has(type)) {
    return Math.round(sum);
  }
  return Math.round(sum * 100) / 100;
}

/** Merge and deduplicate timeseries samples by timestamp (incoming wins). */
export function mergeTimeseriesSamples(
  existing: TimeSample[],
  incoming: TimeSample[]
): TimeSample[] {
  const sampleMap = new Map<string, TimeSample>();
  for (const s of existing) sampleMap.set(s.time, s);
  for (const s of incoming) sampleMap.set(s.time, s);
  return [...sampleMap.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export interface BuiltHealth {
  health: Record<string, HealthMetric>;
  stored: Record<string, number>;
}

/**
 * Build merged health metrics for one date from aggregated input.
 */
export function buildHealthForDate(
  metrics: Map<string, AggregatedMetrics>,
  timeseriesForDate: Map<string, TimeSample[]> | undefined,
  existingHealth: Record<string, HealthMetric>
): BuiltHealth {
  const health: Record<string, HealthMetric> = {};
  const stored: Record<string, number> = {};

  for (const [type, { sum, count, unit }] of metrics) {
    if (TIMESERIES_TYPES.has(type)) {
      const incomingSamples = timeseriesForDate?.get(type) ?? [];
      const existingSamples: TimeSample[] = existingHealth[type]?.samples ?? [];
      const mergedSamples = mergeTimeseriesSamples(existingSamples, incomingSamples);
      const mergedSum = mergedSamples.reduce((acc, s) => acc + s.value, 0);
      const mergedCount = mergedSamples.length;
      const value = computeMetricValue(type, mergedSum, mergedCount);
      health[type] = { value, unit, count: mergedCount, samples: mergedSamples };
    } else {
      const value = computeMetricValue(type, sum, count);
      health[type] = { value, unit, count };
    }
    stored[type] = health[type].value;
  }

  for (const [type, metric] of Object.entries(existingHealth)) {
    if (!health[type]) {
      health[type] = metric;
      stored[type] = metric.value;
    }
  }

  return { health, stored };
}

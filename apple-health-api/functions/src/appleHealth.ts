import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { HealthMetric, TimeSample } from "./types";
import { invalidateGetCache } from "./cacheUtils";
interface Sample {
  type: string;
  date: string; // ISO-8601 or "EEE, d MMM yyyy HH:mm:ss" (Apple Health export format)
  value: string;
  unit: string;
}
/**
 * POST body for the appleHealth function.
 * `from` and `to` are optional YYYY-MM-DD date filters.
 * When provided, only samples whose parsed date falls within [from, to]
 * (inclusive) are processed — useful when uploading a large historical export
 * but only wanting to update a specific window of Firestore documents.
 */
interface Body {
  data: Sample[];
  from?: string; // YYYY-MM-DD, inclusive (optional)
  to?: string;   // YYYY-MM-DD, inclusive (optional)
}
const db = admin.firestore();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Metric types where samples should be AVERAGED rather than summed.
 * Everything else (steps, calories, distance, etc.) is summed.
 */
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
  "Weight",              // weight — average readings across the day
  "BodyMassIndex",       // BMI — average readings across the day
  "BodyFatPercentage",   // body fat % — average readings across the day
  "LeanBodyMass",        // lean mass — average readings across the day
]);
/**
 * Metric types that represent discrete counts and should be stored as
 * whole integers (no decimal places). These are also summed, not averaged.
 */
const COUNT_TYPES = new Set([
  "Steps",
  "FlightsClimbed",
  "NikeFuel",
]);
/**
 * Metric types that should keep every individual timestamped sample
 * so the client can render intra-day timelines (e.g. cumulative steps).
 */
const TIMESERIES_TYPES = new Set([
  "Steps",
]);
/**
 * Parse a raw date string into YYYY-MM-DD format.
 * Accepts ISO-8601 and Apple Health RFC-like formats.
 * @param {string} raw - Date string to parse.
 * @return {string | null} Normalised date or null if unparseable.
 */
function parseDate(raw: string): string | null {
  // Try ISO first: "2026-05-17T..." or "2026-05-17"
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  // Apple Health RFC-like: "Mon, 18 May 2026 14:00:00"
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
/**
 * Receive Apple Health samples and merge them into the finch-daily/{date}
 * Firestore documents so all daily data lives in one place.
 *
 * POST body:
 *   {
 *     data: Sample[],       // required — array of health samples
 *     from?: "YYYY-MM-DD",  // optional — discard samples before this date
 *     to?:   "YYYY-MM-DD",  // optional — discard samples after this date
 *   }
 *
 * When `from`/`to` are omitted every sample in `data` is processed.
 * Each metric type is written as a dot-notation field path (health.StepCount,
 * health.HeartRate, …) so multiple uploads for the same date accumulate
 * rather than overwriting each other.
 */
export const appleHealth = onRequest(
  { region: "europe-west1" },
  async (request, response) => {
    const { data, from: rawFrom, to: rawTo }: Body = request.body;
    if (!Array.isArray(data) || data.length === 0) {
      response.status(400).send("Bad Request: 'data' must be a non-empty array.");
      return;
    }
    // Validate optional date-range params
    if (rawFrom && !DATE_RE.test(rawFrom)) {
      response.status(400).json({ ok: false, error: "'from' must be YYYY-MM-DD." });
      return;
    }
    if (rawTo && !DATE_RE.test(rawTo)) {
      response.status(400).json({ ok: false, error: "'to' must be YYYY-MM-DD." });
      return;
    }
    if (rawFrom && rawTo && rawFrom > rawTo) {
      response.status(400).json({ ok: false, error: "'from' must be on or before 'to'." });
      return;
    }
    const fromDate = rawFrom ?? null;
    const toDate = rawTo ?? null;
    // 1. Group and aggregate samples by date + metric type,
    //    skipping anything outside the requested date window.
    const byDate = new Map<string, Map<string, { sum: number; count: number; unit: string }>>();
    // Individual timestamped readings for timeseries types (Steps, etc.)
    const timeseriesByDate = new Map<string, Map<string, TimeSample[]>>();
    let skippedOutOfRange = 0;
    for (const sample of data) {
      const date = parseDate(sample.date);
      if (!date) continue;
      // Apply date-range filter when provided
      if (fromDate && date < fromDate) { skippedOutOfRange++; continue; }
      if (toDate && date > toDate) { skippedOutOfRange++; continue; }
      const value = parseFloat(sample.value);
      if (isNaN(value)) continue;
      // Normalise type name: strip spaces so "Body Mass Index" → "BodyMassIndex"
      const type = sample.type.replace(/\s+/g, "");
      if (!byDate.has(date)) byDate.set(date, new Map());
      // Safe: we just ensured the key exists above.
      const metrics = byDate.get(date) as Map<string, { sum: number; count: number; unit: string }>;
      if (!metrics.has(type)) {
        metrics.set(type, { sum: 0, count: 0, unit: sample.unit });
      }
      // Safe: we just ensured the key exists above.
      const m = metrics.get(type) as { sum: number; count: number; unit: string };
      m.sum += value;
      m.count += 1;

      // Collect individual timestamped samples for timeseries types
      if (TIMESERIES_TYPES.has(type)) {
        if (!timeseriesByDate.has(date)) timeseriesByDate.set(date, new Map());
        const ts = timeseriesByDate.get(date) as Map<string, TimeSample[]>;
        if (!ts.has(type)) ts.set(type, []);
        (ts.get(type) as TimeSample[]).push({ time: sample.date, value });
      }
    }
    if (byDate.size === 0) {
      response.status(400).json({
        ok: false,
        error: "No parseable samples found within the specified date range.",
        skipped_out_of_range: skippedOutOfRange,
        from: fromDate,
        to: toDate,
      });
      return;
    }
    // 2. Read existing docs so we can merge timeseries samples and avoid
    //    losing data from prior uploads that covered overlapping dates.
    const collection = db.collection("apple-health");
    const datesToUpdate = [...byDate.keys()];
    const existingDocs = new Map<string, Record<string, HealthMetric>>();
    // Firestore getAll supports up to 500 refs per call
    if (datesToUpdate.length > 0) {
      const refs = datesToUpdate.map((d) => collection.doc(d));
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) {
          const data = snap.data();
          if (data?.health) {
            existingDocs.set(snap.id, data.health as Record<string, HealthMetric>);
          }
        }
      }
    }

    // 3. Build merged health maps and write into finch-daily/{date}.
    const batch = db.batch();
    const stored: Record<string, Record<string, number>> = {};
    for (const [date, metrics] of byDate) {
      const docRef = collection.doc(date);
      const existingHealth = existingDocs.get(date) ?? {};
      const health: Record<string, HealthMetric> = {};
      stored[date] = {};
      for (const [type, { sum, count, unit }] of metrics) {
        // For timeseries types, merge existing + incoming samples and
        // deduplicate by timestamp so re-uploads don't create duplicates.
        if (TIMESERIES_TYPES.has(type)) {
          const incomingSamples = timeseriesByDate.get(date)?.get(type) ?? [];
          const existingSamples: TimeSample[] = existingHealth[type]?.samples ?? [];
          // Deduplicate by timestamp string — incoming wins on conflict
          const sampleMap = new Map<string, TimeSample>();
          for (const s of existingSamples) sampleMap.set(s.time, s);
          for (const s of incomingSamples) sampleMap.set(s.time, s);
          const mergedSamples = [...sampleMap.values()]
            .sort((a, b) => a.time.localeCompare(b.time));
          // Re-aggregate from the deduplicated sample set
          const mergedSum = mergedSamples.reduce((acc, s) => acc + s.value, 0);
          const mergedCount = mergedSamples.length;
          const value = AVERAGE_TYPES.has(type)
            ? Math.round((mergedSum / mergedCount) * 100) / 100
            : COUNT_TYPES.has(type)
              ? Math.round(mergedSum)
              : Math.round(mergedSum * 100) / 100;
          health[type] = { value, unit, count: mergedCount, samples: mergedSamples };
        } else {
          // Non-timeseries: use the incoming aggregated values directly
          // (we don't have individual samples to merge, so latest upload wins)
          const value = AVERAGE_TYPES.has(type)
            ? Math.round((sum / count) * 100) / 100
            : COUNT_TYPES.has(type)
              ? Math.round(sum)
              : Math.round(sum * 100) / 100;
          health[type] = { value, unit, count };
        }
        stored[date][type] = health[type].value;
      }
      // Preserve existing health metrics for types NOT in this upload
      for (const [type, metric] of Object.entries(existingHealth)) {
        if (!health[type]) {
          health[type] = metric;
          stored[date][type] = metric.value;
        }
      }
      // merge: true preserves all other document fields (goals, mood, etc.)
      // Always include `date` so the doc is queryable by getFinchData even if
      // no Finch upload created it first.
      batch.set(docRef, { date, health }, { merge: true });
    }
    await batch.commit();

    // Invalidate GET cache so the next read picks up new health data
    await invalidateGetCache();

    response.json({
      ok: true,
      from: fromDate,
      to: toDate,
      dates_updated: byDate.size,
      total_samples: data.length,
      skipped_out_of_range: skippedOutOfRange,
      // Per-date breakdown so you can verify the computed sums
      stored,
    });
  }
);
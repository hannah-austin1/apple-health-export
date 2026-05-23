export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Validate and normalise a date query parameter.
 */
export function parseQueryDate(
  raw: string | undefined,
  fallback: string
): string | null {
  if (!raw) return fallback;
  return DATE_RE.test(raw) ? raw : null;
}

export function cacheDocId(from: string, to: string): string {
  return `${from}_${to}`;
}

export function isCacheValid(
  cachedAt: number,
  invalidatedAt: number,
  now: number,
  ttlMs: number = CACHE_TTL_MS
): boolean {
  return cachedAt > 0 && now - cachedAt < ttlMs && cachedAt > invalidatedAt;
}

interface TimeSampleLike {
  time: string;
}

interface MetricLike {
  samples?: TimeSampleLike[];
}

/**
 * Deduplicate health timeseries samples by timestamp (in place).
 */
export function deduplicateHealthSamples(
  health: Record<string, MetricLike>
): void {
  for (const key of Object.keys(health)) {
    const metric = health[key];
    if (!metric?.samples || !Array.isArray(metric.samples)) continue;

    const seen = new Set<string>();
    metric.samples = metric.samples.filter((s) => {
      if (seen.has(s.time)) return false;
      seen.add(s.time);
      return true;
    });
  }
}

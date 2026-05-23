/**
 * getFinchData — Firebase Cloud Function
 *
 * Returns finch-daily documents for a given date range.
 *
 * GET /getFinchData?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Both params are optional:
 *   - omit `from` to start from the earliest stored day
 *   - omit `to` to fetch up to and including today
 *
 * Responses are cached in Firestore for up to 24 hours per unique
 * (from, to) pair. The cache is automatically invalidated whenever
 * the uploadFinchExport or appleHealth POST endpoints write new data.
 *
 * Response JSON: { ok, from, to, days, data: DailySummary[], cached }
 */

import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

const db = admin.firestore();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** How long a cached response stays valid (milliseconds). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Firestore doc that POST endpoints bump to signal stale caches. */
const INVALIDATION_DOC = "cache-meta/finch-daily";

/**
 * Validate and normalise a date query parameter.
 * @param {string | undefined} raw - Raw query string value.
 * @param {string} fallback - Default to use if raw is absent.
 * @return {string | null} Valid YYYY-MM-DD string, or null if invalid.
 */
function parseQueryDate(raw: string | undefined, fallback: string): string | null {
  if (!raw) return fallback;
  return DATE_RE.test(raw) ? raw : null;
}

/**
 * Build a deterministic cache key from the date-range params.
 * @param {string} from - Start date (YYYY-MM-DD).
 * @param {string} to - End date (YYYY-MM-DD).
 * @return {string} Cache document ID in the form "from_to".
 */
function cacheDocId(from: string, to: string): string {
  return `${from}_${to}`;
}

/**
 * Fetch finch-daily documents for a date range from Firestore.
 * Query parameters:
 *   from (optional) — YYYY-MM-DD start date, inclusive (default: 30 days ago)
 *   to   (optional) — YYYY-MM-DD end date, inclusive (default: today)
 */
export const getData = onRequest(
  { region: "europe-west1" },
  async (request, response) => {
    if (request.method !== "GET") {
      response.status(405).send("Method Not Allowed");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const fromDate = parseQueryDate(
      request.query.from as string | undefined,
      thirtyDaysAgo
    );
    const toDate = parseQueryDate(
      request.query.to as string | undefined,
      today
    );

    if (!fromDate || !toDate) {
      response.status(400).json({
        ok: false,
        error: "Invalid date format. Use YYYY-MM-DD.",
      });
      return;
    }

    if (fromDate > toDate) {
      response.status(400).json({
        ok: false,
        error: "'from' must be on or before 'to'.",
      });
      return;
    }

    try {
      // ── Check cache ──────────────────────────────────────────────
      const cacheRef = db.collection("cache-responses").doc(cacheDocId(fromDate, toDate));
      const invalidationRef = db.doc(INVALIDATION_DOC);

      const [cacheSnap, invalidationSnap] = await Promise.all([
        cacheRef.get(),
        invalidationRef.get(),
      ]);

      const now = Date.now();
      const cachedData = cacheSnap.exists ? cacheSnap.data() : null;
      const cachedAt: number = cachedData?.cachedAt ?? 0;
      const invalidatedAt: number = invalidationSnap.exists
        ? (invalidationSnap.data()?.invalidatedAt ?? 0)
        : 0;

      const cacheIsValid =
        cachedData &&
        now - cachedAt < CACHE_TTL_MS &&   // younger than 24 h
        cachedAt > invalidatedAt;           // not invalidated since caching

      if (cacheIsValid) {
        response.json({
          ok: true,
          from: fromDate,
          to: toDate,
          days: cachedData.days,
          data: cachedData.data,
          cached: true,
        });
        return;
      }

      // ── Cache miss — fetch fresh data from Firestore ─────────────
      const snap = await db
        .collection("apple-health")
        .where("date", ">=", fromDate)
        .where("date", "<=", toDate)
        .orderBy("date", "asc")
        .get();

      const data = snap.docs.map((doc) => {
        const d = doc.data();

        // Deduplicate health timeseries samples by timestamp
        if (d.health && typeof d.health === "object") {
          for (const key of Object.keys(d.health)) {
            const metric = d.health[key];
            if (metric?.samples && Array.isArray(metric.samples)) {
              const seen = new Set<string>();
              metric.samples = metric.samples.filter((s: { time: string }) => {
                if (seen.has(s.time)) return false;
                seen.add(s.time);
                return true;
              });
            }
          }
        }

        return d;
      });

      // Write to cache (fire-and-forget — don't block the response)
      cacheRef
        .set({ data, days: data.length, cachedAt: now })
        .catch((err) => console.error("Failed to write cache:", err));

      response.json({
        ok: true,
        from: fromDate,
        to: toDate,
        days: data.length,
        data,
        cached: false,
      });
    } catch (err) {
      console.error("Error fetching Finch data:", err);
      response.status(500).send("Internal Server Error.");
    }
  }
);

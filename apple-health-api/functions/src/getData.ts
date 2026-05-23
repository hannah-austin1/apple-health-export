import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  cacheDocId,
  deduplicateHealthSamples,
  isCacheValid,
  parseQueryDate,
} from "./utils/getDataUtils";

const db = admin.firestore();

const INVALIDATION_DOC = "cache-meta/finch-daily";

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

      if (
        cachedData &&
        isCacheValid(cachedAt, invalidatedAt, now)
      ) {
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

      const snap = await db
        .collection("apple-health")
        .where("date", ">=", fromDate)
        .where("date", "<=", toDate)
        .orderBy("date", "asc")
        .get();

      const data = snap.docs.map((doc) => {
        const d = doc.data();
        if (d.health && typeof d.health === "object") {
          deduplicateHealthSamples(d.health);
        }
        return d;
      });

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

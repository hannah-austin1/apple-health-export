import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { HealthMetric } from "./types";
import { invalidateGetCache } from "./utils/cacheUtils";
import {
  aggregateSamples,
  buildHealthForDate,
  Sample,
  validateDateRange,
} from "./utils/healthProcessing";

interface Body {
  data: Sample[];
  from?: string;
  to?: string;
}

const db = admin.firestore();

export const appleHealth = onRequest(
  { region: "europe-west1" },
  async (request, response) => {
    const { data, from: rawFrom, to: rawTo }: Body = request.body;
    if (!Array.isArray(data) || data.length === 0) {
      response.status(400).send("Bad Request: 'data' must be a non-empty array.");
      return;
    }

    const rangeError = validateDateRange(rawFrom, rawTo);
    if (rangeError) {
      response.status(400).json({ ok: false, error: rangeError });
      return;
    }

    const fromDate = rawFrom ?? null;
    const toDate = rawTo ?? null;

    const { byDate, timeseriesByDate, skippedOutOfRange } = aggregateSamples(
      data,
      fromDate,
      toDate
    );

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

    const collection = db.collection("apple-health");
    const datesToUpdate = [...byDate.keys()];
    const existingDocs = new Map<string, Record<string, HealthMetric>>();

    if (datesToUpdate.length > 0) {
      const refs = datesToUpdate.map((d) => collection.doc(d));
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) {
          const docData = snap.data();
          if (docData?.health) {
            existingDocs.set(snap.id, docData.health as Record<string, HealthMetric>);
          }
        }
      }
    }

    const batch = db.batch();
    const stored: Record<string, Record<string, number>> = {};

    for (const [date, metrics] of byDate) {
      const docRef = collection.doc(date);
      const existingHealth = existingDocs.get(date) ?? {};
      const { health, stored: dateStored } = buildHealthForDate(
        metrics,
        timeseriesByDate.get(date),
        existingHealth
      );
      stored[date] = dateStored;
      batch.set(docRef, { date, health }, { merge: true });
    }

    await batch.commit();
    await invalidateGetCache();

    response.json({
      ok: true,
      from: fromDate,
      to: toDate,
      dates_updated: byDate.size,
      total_samples: data.length,
      skipped_out_of_range: skippedOutOfRange,
      stored,
    });
  }
);

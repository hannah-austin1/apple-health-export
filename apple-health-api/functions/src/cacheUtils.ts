/**
 * Shared cache-invalidation helper.
 *
 * POST endpoints call `invalidateCache()` after writing to finch-daily
 * so that subsequent GET requests know to bypass their cached responses.
 */

import * as admin from "firebase-admin";

const db = admin.firestore();

/** Firestore path that stores the last-invalidation timestamp. */
const INVALIDATION_DOC = "cache-meta/finch-daily";

/**
 * Bump the invalidation timestamp so cached GET responses are
 * treated as stale on next read.
 *
 * This is intentionally fire-and-forget in most callers — the
 * POST response shouldn't be delayed by a cache housekeeping write.
 */
export async function invalidateGetCache(): Promise<void> {
  await db.doc(INVALIDATION_DOC).set(
    { invalidatedAt: Date.now() },
    { merge: true }
  );
}

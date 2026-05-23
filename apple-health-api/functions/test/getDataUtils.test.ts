import { describe, expect, it } from "vitest";
import {
  CACHE_TTL_MS,
  cacheDocId,
  deduplicateHealthSamples,
  isCacheValid,
  parseQueryDate,
} from "../src/utils/getDataUtils";

describe("parseQueryDate", () => {
  it("returns fallback when param is absent", () => {
    expect(parseQueryDate(undefined, "2026-01-01")).toBe("2026-01-01");
  });

  it("returns param when valid", () => {
    expect(parseQueryDate("2026-05-17", "2026-01-01")).toBe("2026-05-17");
  });

  it("returns null for invalid format", () => {
    expect(parseQueryDate("17-05-2026", "2026-01-01")).toBeNull();
  });
});

describe("cacheDocId", () => {
  it("joins from and to with underscore", () => {
    expect(cacheDocId("2026-05-01", "2026-05-31")).toBe("2026-05-01_2026-05-31");
  });
});

describe("isCacheValid", () => {
  const now = 1_000_000_000_000;

  it("is valid when fresh and not invalidated", () => {
    expect(isCacheValid(now - 1000, now - 5000, now, CACHE_TTL_MS)).toBe(true);
  });

  it("is invalid when older than TTL", () => {
    expect(isCacheValid(now - CACHE_TTL_MS - 1, 0, now, CACHE_TTL_MS)).toBe(false);
  });

  it("is invalid when invalidated after cache write", () => {
    expect(isCacheValid(now - 1000, now - 500, now, CACHE_TTL_MS)).toBe(false);
  });
});

describe("deduplicateHealthSamples", () => {
  it("removes duplicate sample timestamps per metric", () => {
    const health = {
      Steps: {
        samples: [
          { time: "2026-05-17T10:00:00Z" },
          { time: "2026-05-17T10:00:00Z" },
          { time: "2026-05-17T12:00:00Z" },
        ],
      },
    };
    deduplicateHealthSamples(health);
    expect(health.Steps.samples).toHaveLength(2);
  });
});

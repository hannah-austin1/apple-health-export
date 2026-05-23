import { describe, expect, it } from "vitest";
import {
  aggregateSamples,
  buildHealthForDate,
  computeMetricValue,
  mergeTimeseriesSamples,
  parseDate,
  validateDateRange,
} from "../src/utils/healthProcessing";

describe("parseDate", () => {
  it("parses ISO date prefix", () => {
    expect(parseDate("2026-05-17T14:30:00Z")).toBe("2026-05-17");
  });

  it("parses Apple Health RFC-like format", () => {
    expect(parseDate("Mon, 18 May 2026 14:00:00")).toBe("2026-05-18");
  });

  it("returns null for unparseable strings", () => {
    expect(parseDate("not-a-date")).toBeNull();
  });
});

describe("validateDateRange", () => {
  it("accepts valid range", () => {
    expect(validateDateRange("2026-05-01", "2026-05-10")).toBeNull();
  });

  it("rejects invalid from format", () => {
    expect(validateDateRange("05-01-2026", "2026-05-10")).toBe(
      "'from' must be YYYY-MM-DD."
    );
  });

  it("rejects from after to", () => {
    expect(validateDateRange("2026-05-20", "2026-05-10")).toBe(
      "'from' must be on or before 'to'."
    );
  });
});

describe("aggregateSamples", () => {
  it("groups steps and sums values", () => {
    const { byDate, skippedOutOfRange } = aggregateSamples(
      [
        { type: "Steps", date: "2026-05-17T10:00:00Z", value: "100", unit: "count" },
        { type: "Steps", date: "2026-05-17T12:00:00Z", value: "50", unit: "count" },
      ],
      null,
      null
    );

    expect(skippedOutOfRange).toBe(0);
    const metrics = byDate.get("2026-05-17");
    expect(metrics?.get("Steps")).toEqual({ sum: 150, count: 2, unit: "count" });
  });

  it("normalises type names with spaces", () => {
    const { byDate } = aggregateSamples(
      [
        { type: "Body Mass Index", date: "2026-05-17", value: "22.5", unit: "kg/m2" },
      ],
      null,
      null
    );
    expect(byDate.get("2026-05-17")?.has("BodyMassIndex")).toBe(true);
  });

  it("skips samples outside date window", () => {
    const { byDate, skippedOutOfRange } = aggregateSamples(
      [
        { type: "Steps", date: "2026-05-01", value: "10", unit: "count" },
        { type: "Steps", date: "2026-05-20", value: "20", unit: "count" },
      ],
      "2026-05-10",
      "2026-05-15"
    );
    expect(byDate.size).toBe(0);
    expect(skippedOutOfRange).toBe(2);
  });

  it("averages heart rate samples", () => {
    const { byDate } = aggregateSamples(
      [
        { type: "HeartRate", date: "2026-05-17T08:00:00Z", value: "60", unit: "count/min" },
        { type: "HeartRate", date: "2026-05-17T20:00:00Z", value: "80", unit: "count/min" },
      ],
      null,
      null
    );
    const hr = byDate.get("2026-05-17")?.get("HeartRate");
    expect(hr?.sum).toBe(140);
    expect(hr?.count).toBe(2);
  });
});

describe("computeMetricValue", () => {
  it("rounds count types to integers", () => {
    expect(computeMetricValue("Steps", 1234.7, 3)).toBe(1235);
  });

  it("averages rate types", () => {
    expect(computeMetricValue("HeartRate", 140, 2)).toBe(70);
  });
});

describe("mergeTimeseriesSamples", () => {
  it("deduplicates by time with incoming winning", () => {
    const merged = mergeTimeseriesSamples(
      [{ time: "2026-05-17T10:00:00Z", value: 100 }],
      [{ time: "2026-05-17T10:00:00Z", value: 200 }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe(200);
  });

  it("sorts by time ascending", () => {
    const merged = mergeTimeseriesSamples(
      [{ time: "2026-05-17T12:00:00Z", value: 2 }],
      [{ time: "2026-05-17T08:00:00Z", value: 1 }]
    );
    expect(merged.map((s) => s.time)).toEqual([
      "2026-05-17T08:00:00Z",
      "2026-05-17T12:00:00Z",
    ]);
  });
});

describe("buildHealthForDate", () => {
  it("preserves existing metrics not in upload", () => {
    const metrics = new Map([
      ["Steps", { sum: 500, count: 1, unit: "count" }],
    ]);
    const { health, stored } = buildHealthForDate(
      metrics,
      new Map([["Steps", [{ time: "2026-05-17T10:00:00Z", value: 500 }]]]),
      {
        Weight: { value: 70, unit: "kg", count: 1 },
      }
    );
    expect(stored.Steps).toBe(500);
    expect(stored.Weight).toBe(70);
    expect(health.Weight.value).toBe(70);
    expect(health.Steps.samples).toHaveLength(1);
  });
});

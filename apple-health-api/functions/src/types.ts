/** Shared types for Health daily summary data. */

/** A single timestamped reading within a day. */
export interface TimeSample {
  time: string; // ISO-8601 datetime
  value: number;
}

/** One aggregated Apple Health metric for a day. */
export interface HealthMetric {
  value: number; // sum for cumulative types; average for rate types
  unit: string;
  count: number; // number of samples aggregated
  samples?: TimeSample[]; // individual timestamped readings (Steps, etc.)
}


//
//  HealthDataModels.swift
//  healthexport
//

import Foundation

struct HealthDayData {
    let date: Date
    let steps: Double?
    let activeEnergyKcal: Double?
    let distanceMeters: Double?
    let restingHeartRate: Double?
    let averageHeartRate: Double?
    let weightKg: Double?
    let bloodOxygenPercent: Double?   // HealthKit fraction (0–1); sent as 0–100
    let sleepHours: Double?
    let workouts: [WorkoutRecord]

    var dateString: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    // Produces the Sample[] payload expected by the appleHealth Cloud Function.
    // Type names match the AVERAGE_TYPES / COUNT_TYPES sets defined in appleHealth.ts.
    func toSamples() -> [[String: String]] {
        let d = dateString
        var out: [[String: String]] = []

        func add(_ type: String, _ value: Double, _ unit: String, _ fmt: String = "%.2f") {
            out.append(["type": type, "date": d, "value": String(format: fmt, value), "unit": unit])
        }

        // COUNT_TYPES (summed, stored as whole integer)
        if let v = steps              { add("Steps",                  v, "count",     "%.0f") }
        // Summed metrics
        if let v = activeEnergyKcal   { add("ActiveEnergyBurned",     v, "kcal"           ) }
        if let v = distanceMeters     { add("DistanceWalkingRunning",  v, "m"              ) }
        if let v = sleepHours         { add("SleepAnalysis",           v, "hr"             ) }
        // AVERAGE_TYPES (averaged across all samples for the day)
        if let v = averageHeartRate   { add("HeartRate",               v, "count/min", "%.1f") }
        if let v = restingHeartRate   { add("RestingHeartRate",        v, "count/min", "%.1f") }
        if let v = weightKg           { add("Weight",                  v, "kg"             ) }
        if let v = bloodOxygenPercent { add("OxygenSaturation", v * 100, "%",         "%.1f") }

        // Workouts — one sample per session keyed by activity type
        for workout in workouts {
            add("Workout\(workout.activityType)Minutes", workout.durationMinutes, "min", "%.1f")
            if let e = workout.energyBurnedKcal { add("Workout\(workout.activityType)Kcal", e, "kcal") }
        }

        return out
    }
}

struct WorkoutRecord {
    let activityType: String
    let durationMinutes: Double
    let energyBurnedKcal: Double?
    let distanceMeters: Double?
    let startDate: Date
}

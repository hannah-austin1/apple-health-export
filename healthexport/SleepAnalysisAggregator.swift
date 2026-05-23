//
//  SleepAnalysisAggregator.swift
//  healthexport
//

import Foundation
import HealthKit

enum SleepAnalysisAggregator {
    static let asleepValues: Set<Int> = [
        HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
        HKCategoryValueSleepAnalysis.asleepCore.rawValue,
        HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
        HKCategoryValueSleepAnalysis.asleepREM.rawValue,
    ]

    /// Sum duration of asleep segments in hours.
    static func totalHours(
        samples: [(value: Int, start: Date, end: Date)]
    ) -> Double? {
        let totalSeconds = samples
            .filter { asleepValues.contains($0.value) }
            .reduce(0.0) { $0 + $1.end.timeIntervalSince($1.start) }
        return totalSeconds > 0 ? totalSeconds / 3600.0 : nil
    }
}

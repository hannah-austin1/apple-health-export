//
//  SleepAnalysisAggregatorTests.swift
//  healthexportTests
//

import Foundation
import HealthKit
import Testing
@testable import healthexport

struct SleepAnalysisAggregatorTests {

    @Test func totalHoursSumsAsleepSegmentsOnly() throws {
        let asleep = HKCategoryValueSleepAnalysis.asleepCore.rawValue
        let inBed = HKCategoryValueSleepAnalysis.inBed.rawValue
        let start = Date(timeIntervalSince1970: 0)
        let end1 = Date(timeIntervalSince1970: 3600)   // 1 h asleep
        let end2 = Date(timeIntervalSince1970: 7200)   // 2 h in bed (ignored)

        let hours = SleepAnalysisAggregator.totalHours(samples: [
            (asleep, start, end1),
            (inBed, end1, end2),
        ])

        #expect(hours == 1.0)
    }

    @Test func totalHoursReturnsNilWhenNoAsleepTime() {
        let inBed = HKCategoryValueSleepAnalysis.inBed.rawValue
        let start = Date(timeIntervalSince1970: 0)
        let end = Date(timeIntervalSince1970: 3600)
        #expect(SleepAnalysisAggregator.totalHours(samples: [(inBed, start, end)]) == nil)
    }
}

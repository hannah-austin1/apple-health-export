//
//  ExportSchedulerTests.swift
//  healthexportTests
//

import Foundation
import Testing
@testable import healthexport

struct ExportSchedulerTests {

    @Test func nextExportDateBeforeTwoAMReturnsTodayAtTwo() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = try #require(calendar.date(from: DateComponents(
            year: 2026, month: 5, day: 17, hour: 1, minute: 30
        )))
        let next = ExportScheduler.nextExportDate(calendar: calendar, now: now)
        let hour = calendar.component(.hour, from: next)
        let day = calendar.component(.day, from: next)
        #expect(hour == 2)
        #expect(day == 17)
    }

    @Test func nextExportDateAfterTwoAMReturnsTomorrowAtTwo() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = try #require(calendar.date(from: DateComponents(
            year: 2026, month: 5, day: 17, hour: 10, minute: 0
        )))
        let next = ExportScheduler.nextExportDate(calendar: calendar, now: now)
        let day = calendar.component(.day, from: next)
        #expect(day == 18)
        #expect(calendar.component(.hour, from: next) == 2)
    }
}

//
//  HealthDayDataTests.swift
//  healthexportTests
//

import Foundation
import Testing
@testable import healthexport

struct HealthDayDataTests {

    private func makeDay(
        steps: Double? = nil,
        bloodOxygen: Double? = nil,
        workouts: [WorkoutRecord] = []
    ) -> HealthDayData {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let date = calendar.date(from: DateComponents(year: 2026, month: 5, day: 17))!
        return HealthDayData(
            date: date,
            steps: steps,
            activeEnergyKcal: nil,
            distanceMeters: nil,
            restingHeartRate: nil,
            averageHeartRate: nil,
            weightKg: nil,
            bloodOxygenPercent: bloodOxygen,
            sleepHours: nil,
            workouts: workouts
        )
    }

    @Test func dateStringUsesYYYYMMDD() {
        let day = makeDay(steps: 1)
        #expect(day.dateString == "2026-05-17")
    }

    @Test func toSamplesIncludesStepsAsIntegerCount() {
        let samples = makeDay(steps: 8421).toSamples()
        let steps = samples.first { $0["type"] == "Steps" }
        #expect(steps?["value"] == "8421")
        #expect(steps?["unit"] == "count")
        #expect(steps?["date"] == "2026-05-17")
    }

    @Test func toSamplesConvertsBloodOxygenToPercent() {
        let samples = makeDay(bloodOxygen: 0.97).toSamples()
        let o2 = samples.first { $0["type"] == "OxygenSaturation" }
        #expect(o2?["value"] == "97.0")
        #expect(o2?["unit"] == "%")
    }

    @Test func toSamplesOmitsNilMetrics() {
        let samples = makeDay().toSamples()
        #expect(samples.isEmpty)
    }

    @Test func toSamplesIncludesWorkoutMetrics() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let start = calendar.date(from: DateComponents(year: 2026, month: 5, day: 17, hour: 8))!
        let workout = WorkoutRecord(
            activityType: "Running",
            durationMinutes: 30.5,
            energyBurnedKcal: 250,
            distanceMeters: 5000,
            startDate: start
        )
        let samples = makeDay(workouts: [workout]).toSamples()
        #expect(samples.contains { $0["type"] == "WorkoutRunningMinutes" })
        #expect(samples.contains { $0["type"] == "WorkoutRunningKcal" })
    }
}

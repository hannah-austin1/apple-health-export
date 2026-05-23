//
//  WorkoutActivityTypeTests.swift
//  healthexportTests
//

import HealthKit
import Testing
@testable import healthexport

struct WorkoutActivityTypeTests {

    @Test func knownActivityNames() {
        #expect(HKWorkoutActivityType.running.name == "Running")
        #expect(HKWorkoutActivityType.cycling.name == "Cycling")
        #expect(HKWorkoutActivityType.yoga.name == "Yoga")
    }
}

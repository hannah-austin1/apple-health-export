//
//  HealthKitManager.swift
//  healthexport
//

import Combine
import Foundation
import HealthKit
import UserNotifications

enum HealthKitError: LocalizedError {
    case notAvailable

    var errorDescription: String? {
        "HealthKit is not available on this device."
    }
}

@MainActor
class HealthKitManager: ObservableObject {
    static let shared = HealthKitManager()

    private let healthStore = HKHealthStore()

    @Published var isAuthorized = false
    @Published var lastExportDate: Date? = UserDefaults.standard.object(forKey: "healthexport.lastExportDate") as? Date

    // Guard against registering duplicate HKObserverQuery instances across re-entrant calls.
    private var backgroundDeliveryEnabled = false

    private let readTypes: Set<HKObjectType> = {
        var types = Set<HKObjectType>()
        let quantityIds: [HKQuantityTypeIdentifier] = [
            .stepCount, .activeEnergyBurned, .restingHeartRate,
            .heartRate, .bodyMass, .oxygenSaturation, .distanceWalkingRunning
        ]
        for id in quantityIds {
            if let t = HKQuantityType.quantityType(forIdentifier: id) { types.insert(t) }
        }
        if let t = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(t) }
        types.insert(HKObjectType.workoutType())
        return types
    }()

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitError.notAvailable
        }
        try await healthStore.requestAuthorization(toShare: [], read: readTypes)
        isAuthorized = true
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        enableBackgroundDelivery()
    }

    // MARK: - Background delivery

    // Registers an HKObserverQuery so iOS wakes the app whenever HealthKit gets
    // new data (e.g. Apple Watch sync). Must be called each app launch to
    // re-register, because observer queries don't survive process restarts.
    func enableBackgroundDelivery() {
        guard !backgroundDeliveryEnabled,
              HKHealthStore.isHealthDataAvailable(),
              let stepsType = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return }
        backgroundDeliveryEnabled = true

        let query = HKObserverQuery(sampleType: stepsType, predicate: nil) { [weak self] _, completionHandler, error in
            defer { completionHandler() } // Must always be called or HealthKit stops waking the app
            guard error == nil else { return }
            Task { await self?.exportYesterdayIfNeeded() }
        }
        healthStore.execute(query)

        // This persists in HealthKit across launches; safe to call on every launch.
        healthStore.enableBackgroundDelivery(for: stepsType, frequency: .daily) { _, _ in }
    }

    func exportYesterdayIfNeeded() async {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        guard !alreadyExported(date: yesterday) else { return }
        do {
            let data = try await fetchDailyData(for: yesterday)
            try await CloudFunctionService.shared.export(data)
            markExported(date: yesterday)
        } catch {}
    }

    private func alreadyExported(date: Date) -> Bool {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dayKey = formatter.string(from: date)
        return UserDefaults.standard.string(forKey: "healthexport.lastExportedDay") == dayKey
    }

    func recordManualExport() {
        let now = Date()
        UserDefaults.standard.set(now, forKey: "healthexport.lastExportDate")
        lastExportDate = now
    }

    private func markExported(date: Date) {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        UserDefaults.standard.set(formatter.string(from: date), forKey: "healthexport.lastExportedDay")
        let now = Date()
        UserDefaults.standard.set(now, forKey: "healthexport.lastExportDate")
        lastExportDate = now
        sendExportNotification(for: date)
    }

    private func sendExportNotification(for date: Date) {
        let display = DateFormatter()
        display.dateStyle = .medium

        let content = UNMutableNotificationContent()
        content.title = "Health Export Complete"
        content.body = "\(display.string(from: date)) health data uploaded to Firebase."
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "healthexport.\(date.timeIntervalSince1970)",
            content: content,
            trigger: nil  // nil = deliver immediately
        )
        UNUserNotificationCenter.current().add(request)
    }

    func fetchDailyData(for date: Date) async throws -> HealthDayData {
        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: date)
        let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay)!

        async let steps    = fetchSum(typeId: .stepCount, unit: .count(), start: startOfDay, end: endOfDay)
        async let energy   = fetchSum(typeId: .activeEnergyBurned, unit: .kilocalorie(), start: startOfDay, end: endOfDay)
        async let distance = fetchSum(typeId: .distanceWalkingRunning, unit: .meter(), start: startOfDay, end: endOfDay)
        async let rhr      = fetchLatest(typeId: .restingHeartRate, unit: HKUnit(from: "count/min"), start: startOfDay, end: endOfDay)
        async let hr       = fetchAverage(typeId: .heartRate, unit: HKUnit(from: "count/min"), start: startOfDay, end: endOfDay)
        async let weight   = fetchLatest(typeId: .bodyMass, unit: .gramUnit(with: .kilo), start: startOfDay, end: endOfDay)
        async let bloodO2  = fetchLatest(typeId: .oxygenSaturation, unit: .percent(), start: startOfDay, end: endOfDay)
        async let sleep    = fetchSleepHours(start: startOfDay, end: endOfDay)
        async let workouts = fetchWorkouts(start: startOfDay, end: endOfDay)

        return await HealthDayData(
            date: startOfDay,
            steps: steps,
            activeEnergyKcal: energy,
            distanceMeters: distance,
            restingHeartRate: rhr,
            averageHeartRate: hr,
            weightKg: weight,
            bloodOxygenPercent: bloodO2,
            sleepHours: sleep,
            workouts: workouts
        )
    }

    // MARK: - Private query helpers

    private func fetchSum(typeId: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date) async -> Double? {
        guard let type = HKQuantityType.quantityType(forIdentifier: typeId) else { return nil }
        return await withCheckedContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, stats, _ in
                continuation.resume(returning: stats?.sumQuantity()?.doubleValue(for: unit))
            }
            healthStore.execute(query)
        }
    }

    private func fetchAverage(typeId: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date) async -> Double? {
        guard let type = HKQuantityType.quantityType(forIdentifier: typeId) else { return nil }
        return await withCheckedContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .discreteAverage) { _, stats, _ in
                continuation.resume(returning: stats?.averageQuantity()?.doubleValue(for: unit))
            }
            healthStore.execute(query)
        }
    }

    private func fetchLatest(typeId: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date) async -> Double? {
        guard let type = HKQuantityType.quantityType(forIdentifier: typeId) else { return nil }
        return await withCheckedContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: 1, sortDescriptors: sort) { _, samples, _ in
                let value = (samples?.first as? HKQuantitySample)?.quantity.doubleValue(for: unit)
                continuation.resume(returning: value)
            }
            healthStore.execute(query)
        }
    }

    private func fetchSleepHours(start: Date, end: Date) async -> Double? {
        guard let type = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else { return nil }
        return await withCheckedContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
                guard let samples = samples as? [HKCategorySample] else {
                    continuation.resume(returning: nil)
                    return
                }
                let asleepValues: Set<Int> = [
                    HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                    HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                    HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                    HKCategoryValueSleepAnalysis.asleepREM.rawValue
                ]
                let totalSeconds = samples
                    .filter { asleepValues.contains($0.value) }
                    .reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }
                continuation.resume(returning: totalSeconds > 0 ? totalSeconds / 3600.0 : nil)
            }
            healthStore.execute(query)
        }
    }

    private func fetchWorkouts(start: Date, end: Date) async -> [WorkoutRecord] {
        return await withCheckedContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
                guard let workouts = samples as? [HKWorkout] else {
                    continuation.resume(returning: [])
                    return
                }
                let energyType   = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)
                let distanceType = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)
                let records = workouts.map { workout in
                    WorkoutRecord(
                        activityType: workout.workoutActivityType.name,
                        durationMinutes: workout.duration / 60.0,
                        energyBurnedKcal: energyType.flatMap { workout.statistics(for: $0)?.sumQuantity()?.doubleValue(for: .kilocalorie()) },
                        distanceMeters: distanceType.flatMap { workout.statistics(for: $0)?.sumQuantity()?.doubleValue(for: .meter()) },
                        startDate: workout.startDate
                    )
                }
                continuation.resume(returning: records)
            }
            healthStore.execute(query)
        }
    }
}

extension HKWorkoutActivityType {
    var name: String {
        switch self {
        case .running:                      return "Running"
        case .cycling:                      return "Cycling"
        case .walking:                      return "Walking"
        case .swimming:                     return "Swimming"
        case .yoga:                         return "Yoga"
        case .hiking:                       return "Hiking"
        case .functionalStrengthTraining:   return "Strength Training"
        case .highIntensityIntervalTraining: return "HIIT"
        default:                            return "Workout (\(rawValue))"
        }
    }
}

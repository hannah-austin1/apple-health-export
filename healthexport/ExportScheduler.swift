//
//  ExportScheduler.swift
//  healthexport
//

import Foundation
import BackgroundTasks

class ExportScheduler {
    static let shared = ExportScheduler()
    static let taskIdentifier = "com.healthexport.dailyHealthExport"

    private init() {}

    func registerBackgroundTask() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.taskIdentifier, using: nil) { task in
            guard let processingTask = task as? BGProcessingTask else { return }
            self.handleExport(task: processingTask)
        }
    }

    func scheduleNextExport() {
        let request = BGProcessingTaskRequest(identifier: Self.taskIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Self.nextExportDate()
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("BGTaskScheduler submit failed: \(error)")
        }
    }

    /// Next 2:00 AM local time (today if still in the future, otherwise tomorrow).
    static func nextExportDate(calendar: Calendar = .current, now: Date = Date()) -> Date {
        var components = calendar.dateComponents([.year, .month, .day], from: now)
        components.hour = 2
        components.minute = 0
        components.second = 0
        guard let today2AM = calendar.date(from: components) else { return now }
        if today2AM > now { return today2AM }
        return calendar.date(byAdding: .day, value: 1, to: today2AM) ?? now
    }

    private func handleExport(task: BGProcessingTask) {
        scheduleNextExport()

        let exportTask = Task {
            await HealthKitManager.shared.exportYesterdayIfNeeded()
            task.setTaskCompleted(success: true)
        }

        task.expirationHandler = {
            exportTask.cancel()
        }
    }
}

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
        request.earliestBeginDate = nextExportDate()
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("BGTaskScheduler submit failed: \(error)")
        }
    }

    private func nextExportDate() -> Date {
        let calendar = Calendar.current
        var components = calendar.dateComponents([.year, .month, .day], from: Date())
        components.hour = 2
        components.minute = 0
        components.second = 0
        guard let today2AM = calendar.date(from: components) else { return Date() }
        if today2AM > Date() { return today2AM }
        return calendar.date(byAdding: .day, value: 1, to: today2AM) ?? Date()
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

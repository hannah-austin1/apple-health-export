//
//  CloudFunctionService.swift
//  healthexport
//

import Foundation
import FirebaseCore

class CloudFunctionService {
    static let shared = CloudFunctionService()

    private let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private init() {}

    // Export a single day.
    func export(_ data: HealthDayData) async throws {
        let dateStr = data.dateString
        try await post(samples: data.toSamples(), from: dateStr, to: dateStr)
    }

    // Fetch and export every day in [startDate, endDate] in one API call.
    // Returns the number of days exported.
    func exportRange(from startDate: Date, to endDate: Date) async throws -> Int {
        let calendar = Calendar.current
        var allSamples: [[String: String]] = []
        var current = calendar.startOfDay(for: startDate)
        let end = calendar.startOfDay(for: endDate)

        while current <= end {
            let dayData = try await HealthKitManager.shared.fetchDailyData(for: current)
            allSamples.append(contentsOf: dayData.toSamples())
            current = calendar.date(byAdding: .day, value: 1, to: current)!
        }

        guard !allSamples.isEmpty else { return 0 }

        try await post(
            samples: allSamples,
            from: dayFormatter.string(from: startDate),
            to: dayFormatter.string(from: endDate)
        )

        return calendar.dateComponents([.day], from: calendar.startOfDay(for: startDate), to: end).day! + 1
    }

    // MARK: - Private

    private func post(samples: [[String: String]], from: String, to: String) async throws {
        var request = URLRequest(url: try functionURL())
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try CloudFunctionExport.exportPayload(
            samples: samples,
            from: from,
            to: to
        )

        let (responseData, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else { throw ExportError.invalidResponse }
        guard (200...299).contains(http.statusCode) else {
            let message = String(data: responseData, encoding: .utf8) ?? "Unknown error"
            throw ExportError.functionError(http.statusCode, message)
        }
    }

    private func functionURL() throws -> URL {
        guard let projectID = FirebaseApp.app()?.options.projectID else {
            throw ExportError.firebaseNotConfigured
        }
        guard let url = CloudFunctionExport.functionURL(projectID: projectID) else {
            throw ExportError.invalidURL(projectID)
        }
        return url
    }

    enum ExportError: LocalizedError {
        case firebaseNotConfigured
        case invalidURL(String)
        case invalidResponse
        case functionError(Int, String)

        var errorDescription: String? {
            switch self {
            case .firebaseNotConfigured:       return "Firebase is not configured. Make sure GoogleService-Info.plist is added."
            case .invalidURL(let s):           return "Invalid function URL: \(s)"
            case .invalidResponse:             return "Invalid response from server."
            case .functionError(let c, let m): return "Server error \(c): \(m)"
            }
        }
    }
}

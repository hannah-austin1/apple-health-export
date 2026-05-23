//
//  ContentView.swift
//  healthexport
//

import SwiftUI

struct ContentView: View {
    @ObservedObject private var healthKit = HealthKitManager.shared

    @State private var isExporting = false
    @State private var exportError: String?
    @State private var exportSuccess = false

    @State private var rangeStart = Calendar.current.date(byAdding: .day, value: -7, to: Date())!
    @State private var rangeEnd = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
    @State private var isRangeExporting = false
    @State private var rangeExportResult: String?
    @State private var rangeExportError: String?

    var body: some View {
        NavigationStack {
            List {
                authorizationSection
                exportSection
                dateRangeSection
                metricsSection
            }
            .navigationTitle("Health Export")
        }
        .task {
            if !healthKit.isAuthorized {
                try? await healthKit.requestAuthorization()
            }
            // Re-register the observer query every launch — it doesn't survive process restarts.
            healthKit.enableBackgroundDelivery()
        }
    }

    // MARK: - Sections

    private var authorizationSection: some View {
        Section("HealthKit") {
            HStack {
                Image(systemName: healthKit.isAuthorized ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .foregroundStyle(healthKit.isAuthorized ? .green : .red)
                Text(healthKit.isAuthorized ? "Authorized" : "Not authorized")
            }
            if !healthKit.isAuthorized {
                Button("Grant HealthKit Access") {
                    Task { try? await healthKit.requestAuthorization() }
                }
            }
        }
    }

    private var exportSection: some View {
        Section("Export") {
            if let date = healthKit.lastExportDate {
                LabeledContent("Last export") {
                    Text(date, style: .relative)
                        .foregroundStyle(.secondary)
                }
            }

            Button {
                Task { await runExport() }
            } label: {
                HStack(spacing: 8) {
                    if isExporting { ProgressView().scaleEffect(0.8) }
                    Text(isExporting ? "Exporting…" : "Export Today's Data")
                }
            }
            .disabled(isExporting || !healthKit.isAuthorized)

            if exportSuccess {
                Label("Exported successfully", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.caption)
            }

            if let error = exportError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .font(.caption)
            }
        }
    }

    private var metricsSection: some View {
        Section("Exported metrics") {
            ForEach(metrics, id: \.label) { metric in
                Label(metric.label, systemImage: metric.icon)
                    .font(.subheadline)
            }
        }
    }

    private var dateRangeSection: some View {
        Section("Export Date Range") {
            DatePicker("From", selection: $rangeStart, in: ...rangeEnd, displayedComponents: .date)
            DatePicker("To", selection: $rangeEnd, in: rangeStart...Date(), displayedComponents: .date)

            Button {
                Task { await runRangeExport() }
            } label: {
                HStack(spacing: 8) {
                    if isRangeExporting { ProgressView().scaleEffect(0.8) }
                    Text(isRangeExporting ? "Exporting…" : "Export Range")
                }
            }
            .disabled(isRangeExporting || !healthKit.isAuthorized)

            if let result = rangeExportResult {
                Label(result, systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.caption)
            }
            if let error = rangeExportError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .font(.caption)
            }
        }
    }

    // MARK: - Export

    private func runExport() async {
        isExporting = true
        exportError = nil
        exportSuccess = false
        do {
            let data = try await HealthKitManager.shared.fetchDailyData(for: Date())
            try await CloudFunctionService.shared.export(data)
            healthKit.recordManualExport()
            exportSuccess = true
        } catch {
            exportError = error.localizedDescription
        }
        isExporting = false
    }

    private func runRangeExport() async {
        isRangeExporting = true
        rangeExportError = nil
        rangeExportResult = nil
        do {
            let days = try await CloudFunctionService.shared.exportRange(from: rangeStart, to: rangeEnd)
            healthKit.recordManualExport()
            rangeExportResult = "\(days) day\(days == 1 ? "" : "s") exported successfully"
        } catch {
            rangeExportError = error.localizedDescription
        }
        isRangeExporting = false
    }

    // MARK: - Metric list

    private struct Metric { let label: String; let icon: String }

    private let metrics: [Metric] = [
        Metric(label: "Step count",              icon: "figure.walk"),
        Metric(label: "Active energy",           icon: "flame"),
        Metric(label: "Walking / running distance", icon: "map"),
        Metric(label: "Resting heart rate",      icon: "heart"),
        Metric(label: "Average heart rate",      icon: "waveform.path.ecg"),
        Metric(label: "Body weight",             icon: "scalemass"),
        Metric(label: "Blood oxygen",            icon: "lungs"),
        Metric(label: "Sleep hours",             icon: "moon.zzz"),
        Metric(label: "Workouts",                icon: "dumbbell")
    ]
}

#Preview {
    ContentView()
}

//
//  healthexportApp.swift
//  healthexport
//

import SwiftUI
import FirebaseCore

@main
struct healthexportApp: App {

    init() {
        // Skip setup entirely when running inside Xcode Previews.
        guard ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] != "1" else { return }

        // FirebaseApp.configure() calls fatalError if the plist is missing from the bundle.
        // Guard here so a missing/misconfigured plist degrades gracefully instead of crashing.
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
        }

        ExportScheduler.shared.registerBackgroundTask()
        ExportScheduler.shared.scheduleNextExport()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

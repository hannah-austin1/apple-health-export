# Health Export

iOS app that reads selected metrics from Apple HealthKit and POSTs them to a Firebase Cloud Function for storage or downstream processing.

## Features

- Manual export for today or a custom date range
- Background export scheduled around 2:00 AM (via `BGTaskScheduler`)
- HealthKit background delivery for observer-based updates
- Metrics: steps, active energy, distance, resting/average heart rate, weight, blood oxygen, sleep, workouts

## Requirements

- Xcode 16+ (project targets recent iOS / macOS SDKs)
- Apple Developer account with **HealthKit** capability enabled
- A Firebase project with an iOS app registered
- A deployed HTTPS Cloud Function named `appleHealth` in region `europe-west1` (see `CloudFunctionService` in `healthexport/FirestoreService.swift`)

## Setup

1. **Clone and open**

   ```bash
   git clone <your-repo-url>
   cd healthexport
   open healthexport.xcodeproj
   ```

2. **Bundle identifier**

   In Xcode, set **Signing & Capabilities** → **Bundle Identifier** to your own value (the template uses `com.example.healthexport`). Match this in the Firebase iOS app registration.

3. **Firebase config**

   ```bash
   cp GoogleService-Info.example.plist GoogleService-Info.plist
   ```

   Replace placeholders in `GoogleService-Info.plist` with values from [Firebase Console](https://console.firebase.google.com/) → Project settings → Your apps → iOS app → download config, or copy fields from the downloaded file.

   `GoogleService-Info.plist` is gitignored and must be present in the project root for builds.

4. **Signing**

   Select your **Team** in Xcode for the app and test targets. No team ID is committed in the project file.

5. **Cloud Function**

   Deploy a function that accepts JSON:

   ```json
   { "data": [ { "metric": "...", "value": "...", "date": "yyyy-MM-dd" } ], "from": "yyyy-MM-dd", "to": "yyyy-MM-dd" }
   ```

   The app calls:

   `https://europe-west1-<PROJECT_ID>.cloudfunctions.net/appleHealth`

   Change region or function name in `FirestoreService.swift` if your backend differs.

6. **Background tasks**

   Register the background task identifier `com.healthexport.dailyHealthExport` in your Apple Developer portal and enable **Background processing** for the app.

## Project layout

| Path | Purpose |
|------|---------|
| `healthexport/` | SwiftUI app source |
| `healthexport/Info.plist` | Health usage strings, BG task identifiers |
| `healthexport/healthexport.entitlements` | HealthKit capabilities |
| `GoogleService-Info.example.plist` | Template Firebase config (safe to commit) |
| `GoogleService-Info.plist` | Your real Firebase config (local only) |

## Privacy

Do not commit `GoogleService-Info.plist`, API keys, or Apple Developer team IDs. If a key was ever committed or shared, rotate it in the Firebase Console.

## License

Add your license here if you publish the repo.

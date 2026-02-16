# Baby Tracker - Track A Publish Runbook (iOS + Android)

This runbook gets the current web app published to both stores using Capacitor wrappers.

## 1) Prerequisites

- macOS with Xcode (latest stable)
- Android Studio (latest stable)
- Node.js 20+
- Apple Developer account
- Google Play Console account

## 2) Install dependencies

```bash
npm install
```

## 3) Initialize native shells

Run once in project root:

```bash
npm run build:web
npx cap add ios
npx cap add android
```

Then sync any web changes:

```bash
npm run build:web
npx cap sync
```

## 4) Open native projects

```bash
npx cap open ios
npx cap open android
```

## 5) iOS setup (Xcode)

If you see `CocoaPods is not installed`, install first:

```bash
brew install cocoapods
pod --version
```

Then run:

```bash
npm run build:web
npx cap add ios
npx cap sync ios
```

1. Set Signing Team + Bundle ID (must match app id policy).
2. Deployment target iOS 16.1+ if planning future Live Activities.
3. Add `Push Notifications` capability.
4. Add `Background Modes` > `Remote notifications`.
5. Add permission copy in `Info.plist` if needed for notifications UX.
6. Archive and upload to TestFlight.

## 6) Android setup (Android Studio)

After each web update, run:

```bash
npm run build:web
npx cap sync android
```

1. Configure app id / version code / version name.
2. Configure signing (upload key + Play App Signing).
3. Verify notification permission flow on Android 13+.
4. Build AAB and upload to Internal Testing track.

## 7) Functional test matrix

Use short thresholds (1-2 min) before production defaults.

- Awake alert fires after threshold.
- Nap alert fires after threshold.
- Night sleep alert fires after threshold.
- Notification actions: pause/stop on active feeding timer.
- Notification actions: pause/wake on active sleep timer.
- App reopened from notification still applies action intent.

## 8) Current behavior notes

- iOS now includes a native Capacitor bridge scaffold for Live Activity start/update/stop calls and native settings launch.
- True lock-screen Live Activity UI still requires adding an iOS Widget Extension + `ActivityConfiguration` + App Intents in Xcode.
- Android notification action fallback is implemented via service worker -> app message bridge.
- Closed-app action fallback uses URL handoff (`notificationAction`) and in-app action queue.

## 9) Required before production launch

- Add Privacy Policy URL in both stores.
- Complete Data Safety (Google) and Privacy Nutrition Labels (Apple).
- Add crash analytics and release monitoring.
- Add backend push scheduler for guaranteed closed-app threshold alerts (current setup is app-driven best effort).

## 10) Suggested next phase (Track B)

For true iOS Live Activities:

- Add Widget Extension target in Xcode and implement `ActivityConfiguration` UI.
- Add App Intents for Pause/Resume/Stop actions.
- Keep the current native bridge + web notifications as fallbacks.
- Ensure `NSSupportsLiveActivities` is present in `Info.plist` and deployment target is iOS 16.1+.

## 11) Xcode hookup for new Live Activity scaffold

The repo now includes scaffold files in `ios/App/BabyTimerLiveActivityExtension/` and bridge support in `ios/App/App/AppDelegate.swift`.

Manual Xcode steps:

1. Open `ios/App/App.xcworkspace`.
2. Add target: `File` -> `New` -> `Target...` -> `Widget Extension`.
3. Name target `BabyTimerLiveActivityExtension`.
4. Replace generated files with:
   - `BabyTimerLiveActivityBundle.swift`
   - `BabyTimerLiveActivityWidget.swift`
   - `BabyTimerLiveActivityAttributes.swift`
   - `TimerControlsIntents.swift`
5. In both `App` target and extension target:
   - Add `App Groups` capability.
   - Add group id: `group.com.trueinspo.babytracker`.
6. In `App` target:
   - Add `Push Notifications` capability.
   - Add `Background Modes` -> `Remote notifications`.
7. Set deployment targets:
   - App target iOS 16.1+
   - Extension target iOS 16.1+
8. Build and run app target, then start a timer and verify Live Activity appears.

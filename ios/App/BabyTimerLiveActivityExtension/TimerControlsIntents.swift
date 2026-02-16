import AppIntents
import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

private enum BabyTimerIntentBridge {
    static let appGroupId = "group.com.trueinspo.babytracker"
    static let pendingActionKey = "liveActivity.pendingAction"
    // Timer state stored by the main app plugin for intent access
    static let stateStartDate = "liveActivity.state.startDate"
    static let stateTotalPausedSec = "liveActivity.state.totalPausedSeconds"
    static let statePaused = "liveActivity.state.paused"
    static let statePausedElapsedSec = "liveActivity.state.pausedElapsedSeconds"
    static let statePausedAt = "liveActivity.state.pausedAt"
    static let stateTitle = "liveActivity.state.title"
}

private func sharedDefaults() -> UserDefaults? {
    return UserDefaults(suiteName: BabyTimerIntentBridge.appGroupId)
}

struct PauseResumeTimerIntent: AppIntent {
    static var title: LocalizedStringResource = "Pause/Resume Timer"

    func perform() async throws -> some IntentResult {
        guard let defaults = sharedDefaults() else { return .result() }

        // Write the command for JS to pick up
        defaults.set("toggle-live-pause", forKey: BabyTimerIntentBridge.pendingActionKey)

        // Also directly update the Live Activity for immediate visual feedback
        #if canImport(ActivityKit)
        if #available(iOS 16.1, *) {
            guard let activity = Activity<BabyTimerLiveAttributes>.activities.first else {
                return .result()
            }

            let wasPaused = defaults.bool(forKey: BabyTimerIntentBridge.statePaused)
            let startDate = Date(timeIntervalSince1970: defaults.double(forKey: BabyTimerIntentBridge.stateStartDate))
            var totalPausedSec = defaults.integer(forKey: BabyTimerIntentBridge.stateTotalPausedSec)
            let title = defaults.string(forKey: BabyTimerIntentBridge.stateTitle) ?? "Timer"

            var newPaused: Bool
            var newPausedElapsedSec: Int

            if wasPaused {
                // Resume: add pause duration to totalPausedSeconds
                let pausedAt = defaults.double(forKey: BabyTimerIntentBridge.statePausedAt)
                if pausedAt > 0 {
                    let pauseDuration = Int(Date().timeIntervalSince1970 - pausedAt)
                    totalPausedSec += pauseDuration
                }
                newPaused = false
                newPausedElapsedSec = 0
            } else {
                // Pause: calculate elapsed for snapshot
                let elapsed = Int(Date().timeIntervalSince(startDate)) - totalPausedSec
                newPaused = true
                newPausedElapsedSec = max(0, elapsed)
                defaults.set(Date().timeIntervalSince1970, forKey: BabyTimerIntentBridge.statePausedAt)
            }

            // Store updated state back
            defaults.set(newPaused, forKey: BabyTimerIntentBridge.statePaused)
            defaults.set(totalPausedSec, forKey: BabyTimerIntentBridge.stateTotalPausedSec)
            defaults.set(newPausedElapsedSec, forKey: BabyTimerIntentBridge.statePausedElapsedSec)

            let newState = BabyTimerLiveAttributes.ContentState(
                title: title,
                startDate: startDate,
                totalPausedSeconds: totalPausedSec,
                paused: newPaused,
                pausedElapsedSeconds: newPausedElapsedSec
            )

            if #available(iOS 16.2, *) {
                await activity.update(ActivityContent(state: newState, staleDate: nil))
            } else {
                await activity.update(using: newState)
            }
        }
        #endif

        return .result()
    }
}

struct StopTimerIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Timer"

    func perform() async throws -> some IntentResult {
        guard let defaults = sharedDefaults() else { return .result() }

        // Write the command for JS to pick up
        defaults.set("stop-live-timer", forKey: BabyTimerIntentBridge.pendingActionKey)

        // Directly end the Live Activity for immediate visual feedback
        #if canImport(ActivityKit)
        if #available(iOS 16.1, *) {
            let endState = BabyTimerLiveAttributes.ContentState(
                title: "Timer complete",
                startDate: Date(),
                totalPausedSeconds: 0,
                paused: true,
                pausedElapsedSeconds: 0
            )

            for activity in Activity<BabyTimerLiveAttributes>.activities {
                if #available(iOS 16.2, *) {
                    await activity.end(ActivityContent(state: endState, staleDate: nil), dismissalPolicy: .immediate)
                } else {
                    await activity.end(using: endState, dismissalPolicy: .immediate)
                }
            }

            // Clear stored state
            defaults.removeObject(forKey: BabyTimerIntentBridge.stateStartDate)
            defaults.removeObject(forKey: BabyTimerIntentBridge.stateTotalPausedSec)
            defaults.removeObject(forKey: BabyTimerIntentBridge.statePaused)
            defaults.removeObject(forKey: BabyTimerIntentBridge.statePausedElapsedSec)
            defaults.removeObject(forKey: BabyTimerIntentBridge.statePausedAt)
            defaults.removeObject(forKey: BabyTimerIntentBridge.stateTitle)
        }
        #endif

        return .result()
    }
}

import ActivityKit
import AppIntents
import Foundation

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
    let defaults = UserDefaults(suiteName: BabyTimerIntentBridge.appGroupId)
    defaults?.synchronize() // Ensure we read the latest cross-process data
    return defaults
}

@available(iOS 17.0, *)
struct PauseResumeTimerIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Pause/Resume Timer"

    func perform() async throws -> some IntentResult {
        guard let defaults = sharedDefaults() else { return .result() }

        let wasPaused = defaults.bool(forKey: BabyTimerIntentBridge.statePaused)
        let startDateEpoch = defaults.double(forKey: BabyTimerIntentBridge.stateStartDate)
        let startDate = Date(timeIntervalSince1970: startDateEpoch)
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

        // Store updated state for next button press
        defaults.set(newPaused, forKey: BabyTimerIntentBridge.statePaused)
        defaults.set(totalPausedSec, forKey: BabyTimerIntentBridge.stateTotalPausedSec)
        defaults.set(newPausedElapsedSec, forKey: BabyTimerIntentBridge.statePausedElapsedSec)

        // Write the command for JS to pick up
        defaults.set("toggle-live-pause", forKey: BabyTimerIntentBridge.pendingActionKey)
        defaults.synchronize() // Flush to disk for main app to see

        // Directly update the Live Activity for immediate visual feedback
        let newState = BabyTimerLiveAttributes.ContentState(
            title: title,
            startDate: startDate,
            totalPausedSeconds: totalPausedSec,
            paused: newPaused,
            pausedElapsedSeconds: newPausedElapsedSec
        )

        if let activity = Activity<BabyTimerLiveAttributes>.activities.first {
            await activity.update(ActivityContent(state: newState, staleDate: nil))
        }

        return .result()
    }
}

@available(iOS 17.0, *)
struct StopTimerIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop Timer"

    func perform() async throws -> some IntentResult {
        guard let defaults = sharedDefaults() else { return .result() }

        // Write the command for JS to pick up
        defaults.set("stop-live-timer", forKey: BabyTimerIntentBridge.pendingActionKey)

        // Clear stored state
        defaults.removeObject(forKey: BabyTimerIntentBridge.stateStartDate)
        defaults.removeObject(forKey: BabyTimerIntentBridge.stateTotalPausedSec)
        defaults.removeObject(forKey: BabyTimerIntentBridge.statePaused)
        defaults.removeObject(forKey: BabyTimerIntentBridge.statePausedElapsedSec)
        defaults.removeObject(forKey: BabyTimerIntentBridge.statePausedAt)
        defaults.removeObject(forKey: BabyTimerIntentBridge.stateTitle)
        defaults.synchronize() // Flush to disk for main app to see

        // Directly end the Live Activity for immediate visual feedback
        let endState = BabyTimerLiveAttributes.ContentState(
            title: "Timer complete",
            startDate: Date(),
            totalPausedSeconds: 0,
            paused: true,
            pausedElapsedSeconds: 0
        )

        for activity in Activity<BabyTimerLiveAttributes>.activities {
            await activity.end(ActivityContent(state: endState, staleDate: nil), dismissalPolicy: .immediate)
        }

        return .result()
    }
}


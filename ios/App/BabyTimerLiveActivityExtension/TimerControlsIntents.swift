import ActivityKit
import AppIntents
import Foundation

private let kAppGroupId = "group.com.trueinspo.babytracker"
private let kPendingActionKey = "liveActivity.pendingAction"

// State keys (best-effort backup, written by intents for main app)
private let kStatePaused = "liveActivity.state.paused"
private let kStateTotalPausedSec = "liveActivity.state.totalPausedSeconds"
private let kStatePausedElapsedSec = "liveActivity.state.pausedElapsedSeconds"
private let kStatePausedAt = "liveActivity.state.pausedAt"

@available(iOS 17.0, *)
struct PauseResumeTimerIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Pause/Resume Timer"

    func perform() async throws -> some IntentResult {
        // 1. Find the active Live Activity and read its CURRENT state directly
        guard let activity = Activity<BabyTimerLiveAttributes>.activities.first else {
            return .result()
        }

        let current = activity.content.state
        let now = Date()
        let newState: BabyTimerLiveAttributes.ContentState

        if current.paused {
            // RESUME: Calculate how long this pause lasted
            // When paused, the wall clock time of the pause start was:
            //   startDate + totalPausedSeconds + pausedElapsedSeconds
            let pauseStartDate = current.startDate.addingTimeInterval(
                TimeInterval(current.totalPausedSeconds + current.pausedElapsedSeconds)
            )
            let thisPauseDuration = max(0, Int(now.timeIntervalSince(pauseStartDate)))
            let newTotalPaused = current.totalPausedSeconds + thisPauseDuration

            newState = BabyTimerLiveAttributes.ContentState(
                title: current.title,
                startDate: current.startDate,
                totalPausedSeconds: newTotalPaused,
                paused: false,
                pausedElapsedSeconds: 0
            )
        } else {
            // PAUSE: Calculate elapsed time for static snapshot
            let adjustedStart = current.startDate.addingTimeInterval(
                TimeInterval(current.totalPausedSeconds)
            )
            let elapsed = max(0, Int(now.timeIntervalSince(adjustedStart)))

            newState = BabyTimerLiveAttributes.ContentState(
                title: current.title,
                startDate: current.startDate,
                totalPausedSeconds: current.totalPausedSeconds,
                paused: true,
                pausedElapsedSeconds: elapsed
            )
        }

        // 2. Update the Activity immediately (instant visual feedback)
        await activity.update(ActivityContent(state: newState, staleDate: nil))

        // 3. Best-effort: signal the main app via UserDefaults
        if let defaults = UserDefaults(suiteName: kAppGroupId) {
            defaults.set("toggle-live-pause", forKey: kPendingActionKey)
            defaults.synchronize()
        }

        return .result()
    }
}

@available(iOS 17.0, *)
struct StopTimerIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop Timer"

    func perform() async throws -> some IntentResult {
        // 1. End ALL Live Activities immediately
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

        // 2. Best-effort: signal the main app via UserDefaults
        if let defaults = UserDefaults(suiteName: kAppGroupId) {
            defaults.set("stop-live-timer", forKey: kPendingActionKey)
            defaults.synchronize()
        }

        return .result()
    }
}



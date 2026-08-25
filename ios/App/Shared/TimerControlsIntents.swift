import ActivityKit
import AppIntents
import Foundation

/// Compiled into BOTH the app and the widget extension.
///
/// Apple: "If you adopt the LiveActivityIntent or AudioPlaybackIntent protocol, the
/// system runs the app intent in the app's process. Make sure to add your custom app
/// intent to your app target." Previously this file was only a member of the extension
/// target, so the type the system tried to run in the app process did not exist there.

@available(iOS 17.0, *)
enum BabyTimerActivityLocator {
    /// Picks the activity the buttons belong to. Prefers the session the shared
    /// snapshot names; otherwise falls back to the most recently updated one, so the
    /// choice is deterministic instead of `activities.first`.
    static func current() -> Activity<BabyTimerLiveAttributes>? {
        let all = Activity<BabyTimerLiveAttributes>.activities
        if let sessionId = LiveActivityStore.load()?.sessionId,
           let match = all.first(where: { $0.attributes.sessionId == sessionId }) {
            return match
        }
        return all.max { $0.content.state.updatedAt < $1.content.state.updatedAt }
    }
}

@available(iOS 17.0, *)
struct PauseResumeTimerIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Pause or Resume Timer"
    static var isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        guard let activity = BabyTimerActivityLocator.current() else { return .result() }

        let now = Date()
        let current = activity.content.state
        var next = current

        if let pausedAt = current.pausedAt {
            // Resume. Folding the pause into `totalPaused` moves the counter's anchor
            // forward by exactly the pause length, so the count picks up on the same
            // number it froze on — no drift, no matter how many cycles.
            next.totalPaused = current.totalPaused + now.timeIntervalSince(pausedAt)
            next.pausedAt = nil
        } else {
            next.pausedAt = now
        }
        next.updatedAt = now

        await activity.update(ActivityContent(state: next, staleDate: nil))

        LiveActivityStore.save(BabyTimerSnapshot(
            state: next,
            sessionId: activity.attributes.sessionId,
            timerKind: activity.attributes.timerKind,
            source: "intent"
        ))

        return .result()
    }
}

@available(iOS 17.0, *)
struct StopTimerIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop Timer"
    static var isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        let now = Date()

        // Record where the timer actually stood before tearing the activity down, so
        // the session the app saves matches the number that was on screen.
        if let activity = BabyTimerActivityLocator.current() {
            var snapshot = BabyTimerSnapshot(
                state: activity.content.state,
                sessionId: activity.attributes.sessionId,
                timerKind: activity.attributes.timerKind,
                source: "intent"
            )
            snapshot.stopped = true
            snapshot.stoppedAtMs = BabyTimerSnapshot.ms(now)
            snapshot.updatedAtMs = BabyTimerSnapshot.ms(now)
            LiveActivityStore.save(snapshot)
        }

        for activity in Activity<BabyTimerLiveAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }

        return .result()
    }
}

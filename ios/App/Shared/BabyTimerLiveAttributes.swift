import ActivityKit
import Foundation

/// Shared by the app and the widget extension — compiled into BOTH targets so the
/// two processes can never drift out of sync on the encoding of the timer state.
///
/// Everything here is expressed as absolute `Date`s and `TimeInterval`s. Nothing is
/// rounded to whole seconds: the previous `Int`-seconds representation threw away up
/// to a second on every pause/resume, and the error accumulated across cycles.
@available(iOS 16.1, *)
struct BabyTimerLiveAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var title: String

        /// Wall-clock instant the session began.
        var startDate: Date

        /// Total time spent paused, *excluding* any pause currently in progress.
        var totalPaused: TimeInterval

        /// Instant the current pause began, or nil while the timer is running.
        var pausedAt: Date?

        /// When this state was written. Whoever holds the newer value wins — this is
        /// the single arbiter between the app process and the Live Activity buttons.
        var updatedAt: Date

        var isPaused: Bool { pausedAt != nil }

        /// The instant the on-screen counter measures from. Shifting the anchor forward
        /// by `totalPaused` is what lets the system render the count itself.
        var effectiveStart: Date {
            startDate.addingTimeInterval(totalPaused)
        }

        func elapsed(at now: Date = Date()) -> TimeInterval {
            max(0, (pausedAt ?? now).timeIntervalSince(effectiveStart))
        }
    }

    var sessionId: String
    var timerKind: String
}

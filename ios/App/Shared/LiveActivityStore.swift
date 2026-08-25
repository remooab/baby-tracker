import Foundation

enum BabyTimerBridgeKeys {
    static let appGroupId = "group.com.trueinspo.babytracker"
    /// One record holding the whole timer state. Replaces the old single-slot
    /// `pendingAction` mailbox, which lost a command whenever two button taps
    /// landed before the web layer had drained it.
    static let snapshot = "liveActivity.snapshot.v2"
}

/// An absolute description of the timer, written by whichever process changed it last.
///
/// Times are milliseconds since the epoch so the JavaScript layer can consume them
/// without any conversion. `updatedAtMs` is the arbiter: a reader applies a snapshot
/// only when it is strictly newer than what the reader already has, which makes
/// applying one twice a no-op.
struct BabyTimerSnapshot: Codable {
    var sessionId: String
    var timerKind: String
    var title: String
    var startMs: Double
    var totalPausedMs: Double
    /// Non-nil while paused.
    var pausedAtMs: Double?
    var updatedAtMs: Double
    var stopped: Bool
    var stoppedAtMs: Double?
    /// "intent" (a Live Activity button) or "app".
    var source: String

    static func ms(_ date: Date) -> Double { date.timeIntervalSince1970 * 1000 }
    static func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }
}

@available(iOS 16.1, *)
extension BabyTimerSnapshot {
    init(state: BabyTimerLiveAttributes.ContentState,
         sessionId: String,
         timerKind: String,
         source: String) {
        self.sessionId = sessionId
        self.timerKind = timerKind
        self.title = state.title
        self.startMs = Self.ms(state.startDate)
        self.totalPausedMs = state.totalPaused * 1000
        self.pausedAtMs = state.pausedAt.map(Self.ms)
        self.updatedAtMs = Self.ms(state.updatedAt)
        self.stopped = false
        self.stoppedAtMs = nil
        self.source = source
    }

    var contentState: BabyTimerLiveAttributes.ContentState {
        BabyTimerLiveAttributes.ContentState(
            title: title,
            startDate: Self.date(startMs),
            totalPaused: totalPausedMs / 1000,
            pausedAt: pausedAtMs.map(Self.date),
            updatedAt: Self.date(updatedAtMs)
        )
    }
}

enum LiveActivityStore {
    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: BabyTimerBridgeKeys.appGroupId)
    }

    static func load() -> BabyTimerSnapshot? {
        guard let data = defaults?.data(forKey: BabyTimerBridgeKeys.snapshot) else { return nil }
        return try? JSONDecoder().decode(BabyTimerSnapshot.self, from: data)
    }

    static func save(_ snapshot: BabyTimerSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults?.set(data, forKey: BabyTimerBridgeKeys.snapshot)
    }

    static func clear() {
        defaults?.removeObject(forKey: BabyTimerBridgeKeys.snapshot)
    }

    /// Drops keys written by the pre-snapshot build. Nothing reads them any more,
    /// but they linger in the shared container until something removes them.
    static func purgeLegacyKeys() {
        guard let defaults else { return }
        for key in ["liveActivity.sessionId", "liveActivity.timerKind", "liveActivity.pendingAction",
                    "liveActivity.state.paused", "liveActivity.state.totalPausedSeconds",
                    "liveActivity.state.pausedElapsedSeconds", "liveActivity.state.pausedAt"] {
            defaults.removeObject(forKey: key)
        }
    }
}

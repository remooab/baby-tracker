import Foundation
import ActivityKit

struct BabyTimerLiveAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var title: String
        var startDate: Date
        var totalPausedSeconds: Int
        var paused: Bool
        var pausedElapsedSeconds: Int   // snapshot when paused
    }

    var sessionId: String
    var timerKind: String
}

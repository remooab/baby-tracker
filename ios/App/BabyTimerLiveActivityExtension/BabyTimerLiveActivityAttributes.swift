import Foundation
import ActivityKit

struct BabyTimerLiveAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var title: String
        var elapsedSeconds: Int
        var paused: Bool
    }

    var sessionId: String
    var timerKind: String
}

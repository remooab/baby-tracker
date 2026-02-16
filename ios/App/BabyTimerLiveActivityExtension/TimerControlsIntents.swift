import AppIntents
import Foundation

private enum BabyTimerIntentBridge {
    static let appGroupId = "group.com.trueinspo.babytracker"
    static let pendingActionKey = "liveActivity.pendingAction"
}

private func writeIntentAction(_ action: String) {
    let defaults = UserDefaults(suiteName: BabyTimerIntentBridge.appGroupId)
    defaults?.set(action, forKey: BabyTimerIntentBridge.pendingActionKey)
}

struct PauseResumeTimerIntent: AppIntent {
    static var title: LocalizedStringResource = "Pause/Resume Timer"

    func perform() async throws -> some IntentResult {
        writeIntentAction("toggle-live-pause")
        return .result()
    }
}

struct StopTimerIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Timer"

    func perform() async throws -> some IntentResult {
        writeIntentAction("stop-live-timer")
        return .result()
    }
}

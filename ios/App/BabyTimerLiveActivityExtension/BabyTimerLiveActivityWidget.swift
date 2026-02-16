import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@available(iOSApplicationExtension 16.1, *)
struct BabyTimerLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BabyTimerLiveAttributes.self) { context in
            VStack(alignment: .leading, spacing: 8) {
                Text(context.state.title)
                    .font(.headline)
                Text(elapsedText(context.state.elapsedSeconds))
                    .font(.title3.monospacedDigit())
                if #available(iOSApplicationExtension 17.0, *) {
                    HStack(spacing: 12) {
                        Button(intent: PauseResumeTimerIntent()) {
                            Text(context.state.paused ? "Resume" : "Pause")
                        }
                        .buttonStyle(.bordered)

                        Button(intent: StopTimerIntent()) {
                            Text("Stop")
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
            }
            .padding()
            .activityBackgroundTint(.black.opacity(0.08))
            .activitySystemActionForegroundColor(.primary)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text("Baby")
                        .font(.caption)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.paused ? "Paused" : "Running")
                        .font(.caption)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 10) {
                        Text(elapsedText(context.state.elapsedSeconds))
                            .font(.headline.monospacedDigit())
                        if #available(iOSApplicationExtension 17.0, *) {
                            Button(intent: PauseResumeTimerIntent()) {
                                Image(systemName: context.state.paused ? "play.fill" : "pause.fill")
                            }
                            Button(intent: StopTimerIntent()) {
                                Image(systemName: "stop.fill")
                            }
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: "timer")
            } compactTrailing: {
                Text(elapsedTextShort(context.state.elapsedSeconds))
                    .font(.caption2.monospacedDigit())
            } minimal: {
                Image(systemName: "timer")
            }
        }
    }

    private func elapsedText(_ seconds: Int) -> String {
        let s = max(0, seconds)
        let h = s / 3600
        let m = (s % 3600) / 60
        let sec = s % 60
        return String(format: "%02d:%02d:%02d", h, m, sec)
    }

    private func elapsedTextShort(_ seconds: Int) -> String {
        let s = max(0, seconds)
        let h = s / 3600
        let m = (s % 3600) / 60
        return h > 0 ? String(format: "%dh%02dm", h, m) : String(format: "%dm", m)
    }
}

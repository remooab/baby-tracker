import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@available(iOSApplicationExtension 16.1, *)
struct BabyTimerLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BabyTimerLiveAttributes.self) { context in
            // Lock Screen / Banner presentation
            lockScreenView(context: context)
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
                .activityBackgroundTint(Color.black)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded Dynamic Island
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image(systemName: iconName(for: context.attributes.timerKind))
                            .foregroundColor(accentColor(for: context.attributes.timerKind))
                        Text(context.state.title)
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.white)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.paused ? "PAUSED" : "")
                        .font(.caption2.weight(.bold))
                        .foregroundColor(.orange)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 16) {
                        timerView(context: context)
                            .font(.system(size: 32, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundColor(accentColor(for: context.attributes.timerKind))

                        Spacer()

                        if #available(iOSApplicationExtension 17.0, *) {
                            Button(intent: PauseResumeTimerIntent()) {
                                Image(systemName: context.state.paused ? "play.fill" : "pause.fill")
                                    .font(.title3)
                                    .foregroundColor(.white)
                                    .frame(width: 44, height: 44)
                                    .background(accentColor(for: context.attributes.timerKind))
                                    .clipShape(Circle())
                            }
                            .buttonStyle(.plain)

                            Button(intent: StopTimerIntent()) {
                                Image(systemName: "xmark")
                                    .font(.title3.weight(.semibold))
                                    .foregroundColor(.white)
                                    .frame(width: 44, height: 44)
                                    .background(Color.gray.opacity(0.5))
                                    .clipShape(Circle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 4)
                }
            } compactLeading: {
                HStack(spacing: 4) {
                    Image(systemName: iconName(for: context.attributes.timerKind))
                        .foregroundColor(accentColor(for: context.attributes.timerKind))
                }
            } compactTrailing: {
                timerView(context: context)
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundColor(accentColor(for: context.attributes.timerKind))
            } minimal: {
                Image(systemName: iconName(for: context.attributes.timerKind))
                    .foregroundColor(accentColor(for: context.attributes.timerKind))
            }
        }
    }

    // MARK: - Lock Screen View
    @ViewBuilder
    private func lockScreenView(context: ActivityViewContext<BabyTimerLiveAttributes>) -> some View {
        HStack(spacing: 16) {
            // Left: Controls
            if #available(iOSApplicationExtension 17.0, *) {
                HStack(spacing: 8) {
                    Button(intent: PauseResumeTimerIntent()) {
                        Image(systemName: context.state.paused ? "play.fill" : "pause.fill")
                            .font(.title2.weight(.bold))
                            .foregroundColor(.white)
                            .frame(width: 52, height: 52)
                            .background(accentColor(for: context.attributes.timerKind))
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)

                    Button(intent: StopTimerIntent()) {
                        Image(systemName: "xmark")
                            .font(.title2.weight(.bold))
                            .foregroundColor(.white)
                            .frame(width: 52, height: 52)
                            .background(Color.gray.opacity(0.5))
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                }
            }

            Spacer()

            // Right: Timer info
            VStack(alignment: .trailing, spacing: 2) {
                Text(context.state.title)
                    .font(.caption.weight(.medium))
                    .foregroundColor(.gray)

                timerView(context: context)
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(accentColor(for: context.attributes.timerKind))
            }
        }
    }

    // MARK: - Timer View (auto-counting or paused snapshot)
    @ViewBuilder
    private func timerView(context: ActivityViewContext<BabyTimerLiveAttributes>) -> some View {
        if context.state.paused {
            // When paused, show a static snapshot
            Text(elapsedText(context.state.pausedElapsedSeconds))
        } else {
            // When running, use system timer that counts in real-time
            // startDate adjusted for paused time so the counter is accurate
            let adjustedStart = context.state.startDate.addingTimeInterval(
                TimeInterval(context.state.totalPausedSeconds)
            )
            Text(adjustedStart, style: .timer)
        }
    }

    // MARK: - Helpers
    private func iconName(for timerKind: String) -> String {
        switch timerKind {
        case "nap": return "moon.zzz.fill"
        case "night": return "moon.stars.fill"
        case "breast": return "heart.fill"
        default: return "timer"
        }
    }

    private func accentColor(for timerKind: String) -> Color {
        switch timerKind {
        case "nap": return .cyan
        case "night": return .indigo
        case "breast": return .orange
        default: return .orange
        }
    }

    private func elapsedText(_ seconds: Int) -> String {
        let s = max(0, seconds)
        let h = s / 3600
        let m = (s % 3600) / 60
        let sec = s % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, sec)
        }
        return String(format: "%d:%02d", m, sec)
    }
}

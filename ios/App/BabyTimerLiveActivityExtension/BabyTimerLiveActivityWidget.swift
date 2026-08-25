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
                    Text(context.state.isPaused ? "PAUSED" : "")
                        .font(.caption2.weight(.bold))
                        .foregroundColor(.orange)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 16) {
                        timerView(context: context)
                            .font(.system(size: 32, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundColor(accentColor(for: context.attributes.timerKind))
                            .frame(maxWidth: 110, alignment: .leading)

                        Spacer(minLength: 0)

                        controls(context: context, diameter: 44)
                    }
                    .padding(.top, 4)
                }
            } compactLeading: {
                Image(systemName: iconName(for: context.attributes.timerKind))
                    .foregroundColor(accentColor(for: context.attributes.timerKind))
            } compactTrailing: {
                timerView(context: context)
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundColor(accentColor(for: context.attributes.timerKind))
                    .frame(maxWidth: 52)
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
            controls(context: context, diameter: 52)

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                Text(context.state.title)
                    .font(.caption.weight(.medium))
                    .foregroundColor(.gray)
                    .lineLimit(1)

                timerView(context: context)
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(accentColor(for: context.attributes.timerKind))
                    // `Text(timerInterval:)` reserves room for its widest possible
                    // value, so it is pinned rather than left to take the whole row.
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 150, alignment: .trailing)
            }
        }
    }

    @ViewBuilder
    private func controls(context: ActivityViewContext<BabyTimerLiveAttributes>, diameter: CGFloat) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            HStack(spacing: 8) {
                Button(intent: PauseResumeTimerIntent()) {
                    Image(systemName: context.state.isPaused ? "play.fill" : "pause.fill")
                        .font(.title2.weight(.bold))
                        .foregroundColor(.white)
                        .frame(width: diameter, height: diameter)
                        .background(accentColor(for: context.attributes.timerKind))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)

                Button(intent: StopTimerIntent()) {
                    Text(stopLabel(for: context.attributes.timerKind))
                        .font(.subheadline.weight(.bold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, 16)
                        .frame(height: diameter)
                        .background(Color.gray.opacity(0.5))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Timer View
    /// One system-rendered timer for both states. `pauseTime` freezes the count on the
    /// exact value it was showing, which a hand-formatted snapshot could never match —
    /// the old code floored the paused value while the running value was rendered by
    /// `Text(_:style:.timer)`, so the number visibly jumped on every press.
    private func timerView(context: ActivityViewContext<BabyTimerLiveAttributes>) -> some View {
        let start = context.state.effectiveStart
        return Text(
            timerInterval: start...start.addingTimeInterval(60 * 60 * 24),
            pauseTime: context.state.pausedAt,
            countsDown: false
        )
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

    /// The stop control ends a feed as readily as it ends a sleep, so the word has to
    /// follow the timer rather than always saying "Wake up".
    private func stopLabel(for timerKind: String) -> String {
        switch timerKind {
        case "nap", "night": return "Wake up"
        default: return "Done"
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
}

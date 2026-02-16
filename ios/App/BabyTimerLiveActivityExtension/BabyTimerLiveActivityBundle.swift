import WidgetKit
import SwiftUI

@main
struct BabyTimerLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOSApplicationExtension 16.1, *) {
            BabyTimerLiveActivityWidget()
        }
    }
}

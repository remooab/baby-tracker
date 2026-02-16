import UIKit
import Capacitor
import UserNotifications

class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TimerLiveActivityPlugin())
        // Re-assert notification delegate AFTER Capacitor bridge loads,
        // so our willPresent handler (show banners in foreground) isn't overridden.
        if let appDelegate = UIApplication.shared.delegate as? UNUserNotificationCenterDelegate {
            UNUserNotificationCenter.current().delegate = appDelegate
        }
    }
}

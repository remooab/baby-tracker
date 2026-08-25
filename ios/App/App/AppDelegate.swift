import UIKit
import Capacitor
import UserNotifications

#if canImport(ActivityKit)
import ActivityKit
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        LiveActivityStore.purgeLegacyKeys()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

extension AppDelegate: UNUserNotificationCenterDelegate {}

extension AppDelegate {
    public func userNotificationCenter(_ center: UNUserNotificationCenter,
                                       willPresent notification: UNNotification,
                                       withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge, .list])
    }
}

#if canImport(ActivityKit)
@available(iOS 16.2, *)
final class BabyTimerLiveActivityManager {
    static let shared = BabyTimerLiveActivityManager()

    private init() {}

    /// The activity for a session, ending any duplicates left over from a previous run.
    private func activity(for sessionId: String) -> Activity<BabyTimerLiveAttributes>? {
        let matching = Activity<BabyTimerLiveAttributes>.activities
            .filter { $0.attributes.sessionId == sessionId }
        guard let keep = matching.max(by: { $0.content.state.updatedAt < $1.content.state.updatedAt })
        else { return nil }

        for extra in matching where extra.id != keep.id {
            Task { await extra.end(nil, dismissalPolicy: .immediate) }
        }
        return keep
    }

    func startOrUpdate(sessionId: String, timerKind: String, title: String,
                       startDate: Date, totalPaused: TimeInterval,
                       pausedAt: Date?, updatedAt: Date) async -> Bool {
        let state = BabyTimerLiveAttributes.ContentState(
            title: title,
            startDate: startDate,
            totalPaused: totalPaused,
            pausedAt: pausedAt,
            updatedAt: updatedAt
        )

        if let existing = activity(for: sessionId) {
            // Last writer wins. This one check replaces the three guard layers that
            // used to try to stop the web layer from stomping on a button press:
            // a press always carries a newer `updatedAt` than the state the web
            // layer is still holding, so a stale push simply loses.
            guard existing.content.state.updatedAt <= updatedAt else { return true }

            await existing.update(ActivityContent(state: state, staleDate: nil))
            LiveActivityStore.save(BabyTimerSnapshot(
                state: state, sessionId: sessionId, timerKind: timerKind, source: "app"
            ))
            return true
        }

        // Switching sessions — retire anything still on screen first.
        for stale in Activity<BabyTimerLiveAttributes>.activities {
            await stale.end(nil, dismissalPolicy: .immediate)
        }

        do {
            _ = try Activity<BabyTimerLiveAttributes>.request(
                attributes: BabyTimerLiveAttributes(sessionId: sessionId, timerKind: timerKind),
                content: ActivityContent(state: state, staleDate: nil),
                pushType: nil
            )
            LiveActivityStore.save(BabyTimerSnapshot(
                state: state, sessionId: sessionId, timerKind: timerKind, source: "app"
            ))
            return true
        } catch {
            print("[LiveActivity] request failed:", error.localizedDescription)
            return false
        }
    }

    func stop() async {
        for act in Activity<BabyTimerLiveAttributes>.activities {
            await act.end(nil, dismissalPolicy: .immediate)
        }
        LiveActivityStore.clear()
    }
}
#endif

@objc(TimerLiveActivityPlugin)
public class TimerLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TimerLiveActivityPlugin"
    public let jsName = "TimerLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startOrUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareCsv", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPlatformCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchLiveState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getNotificationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotificationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendLocalNotification", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleLocalNotification", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearLocalNotification", returnType: CAPPluginReturnPromise)
    ]

    @objc func startOrUpdate(_ call: CAPPluginCall) {
        let sessionId = call.getString("sessionId") ?? "session"
        let timerKind = call.getString("timerKind") ?? "timer"
        let title = call.getString("title") ?? "Baby Timer"
        let nowMs = Date().timeIntervalSince1970 * 1000
        // Doubles throughout: `call.getInt` plus `ms / 1000` integer division used to
        // discard the sub-second part of every value crossing this bridge.
        let startMs = call.getDouble("startTimestamp") ?? nowMs
        let totalPausedMs = call.getDouble("totalPausedMs") ?? 0
        let pausedAtMs = call.getDouble("pausedAtMs")
        let updatedAtMs = call.getDouble("updatedAtMs") ?? nowMs

        guard #available(iOS 16.2, *) else {
            call.resolve(["ok": false, "reason": "ios-version-too-low"])
            return
        }

        Task {
            let success = await BabyTimerLiveActivityManager.shared.startOrUpdate(
                sessionId: sessionId,
                timerKind: timerKind,
                title: title,
                startDate: BabyTimerSnapshot.date(startMs),
                totalPaused: totalPausedMs / 1000,
                pausedAt: pausedAtMs.map(BabyTimerSnapshot.date),
                updatedAt: BabyTimerSnapshot.date(updatedAtMs)
            )
            call.resolve(["ok": success])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["ok": false, "reason": "ios-version-too-low"])
            return
        }

        Task {
            await BabyTimerLiveActivityManager.shared.stop()
            call.resolve(["ok": true])
        }
    }

    /// WKWebView ignores `<a download>`, so an export triggered in the web layer
    /// silently did nothing in the native app. Hand the file to the share sheet.
    @objc func shareCsv(_ call: CAPPluginCall) {
        let filename = call.getString("filename") ?? "baby-tracker.csv"
        guard let contents = call.getString("contents") else {
            call.reject("missing-contents")
            return
        }

        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        do {
            try contents.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            call.reject("write-failed", nil, error)
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let presenter = self?.bridge?.viewController else {
                call.reject("no-presenter")
                return
            }

            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            // Required on iPad, harmless on iPhone.
            sheet.popoverPresentationController?.sourceView = presenter.view
            sheet.popoverPresentationController?.sourceRect = CGRect(
                x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY, width: 0, height: 0
            )
            presenter.present(sheet, animated: true) { call.resolve(["ok": true]) }
        }
    }

    @objc func getPlatformCapabilities(_ call: CAPPluginCall) {
        var supportsLiveActivities = false
        if #available(iOS 16.2, *) {
            supportsLiveActivities = true
        }

        call.resolve([
            "isNativeIOS": true,
            "supportsLiveActivities": supportsLiveActivities,
            "supportsNativeNotifications": true,
            "supportsCsvShare": true,
            "supportsScheduledAlerts": true
        ])
    }

    /// Hands the web layer the absolute state, not a command to replay.
    ///
    /// The old `fetchPendingCommand` popped a single "toggle" string off a one-slot
    /// mailbox: two taps before the app drained it lost one, and the web layer's idea
    /// of paused then permanently disagreed with the Live Activity. An absolute
    /// snapshot is idempotent — reading it twice changes nothing.
    @objc func fetchLiveState(_ call: CAPPluginCall) {
        guard let snapshot = LiveActivityStore.load() else {
            call.resolve(["hasState": false])
            return
        }

        var result: [String: Any] = [
            "hasState": true,
            "sessionId": snapshot.sessionId,
            "timerKind": snapshot.timerKind,
            "startMs": snapshot.startMs,
            "totalPausedMs": snapshot.totalPausedMs,
            "updatedAtMs": snapshot.updatedAtMs,
            "stopped": snapshot.stopped,
            "source": snapshot.source
        ]
        if let pausedAtMs = snapshot.pausedAtMs { result["pausedAtMs"] = pausedAtMs }
        if let stoppedAtMs = snapshot.stoppedAtMs { result["stoppedAtMs"] = stoppedAtMs }

        call.resolve(result)
    }

    @objc func getNotificationPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["status": Self.mapNotificationStatus(settings.authorizationStatus)])
        }
    }

    @objc func requestNotificationPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, error in
            if let error = error {
                call.reject("notification-permission-error", nil, error)
                return
            }

            UNUserNotificationCenter.current().getNotificationSettings { settings in
                call.resolve(["status": Self.mapNotificationStatus(settings.authorizationStatus)])
            }
        }
    }

    @objc func sendLocalNotification(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "Baby Tracker"
        let body = call.getString("body") ?? ""
        let tag = call.getString("tag") ?? UUID().uuidString
        let userInfo = call.getObject("data") ?? [:]

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = userInfo

        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [tag])
        center.removeDeliveredNotifications(withIdentifiers: [tag])

        // Use short delay trigger — nil trigger can silently drop in some iOS versions
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
        let request = UNNotificationRequest(identifier: tag, content: content, trigger: trigger)
        center.add(request) { error in
            if let error = error {
                call.reject("send-local-notification-failed", nil, error)
                return
            }
            call.resolve(["ok": true])
        }
    }

    /// Hand the alert to iOS ahead of time so it fires whether or not the app is
    /// running. The web layer's 5s interval only ticks while the app is alive, so a
    /// nap alert would arrive late or not at all once the app was backgrounded.
    @objc func scheduleLocalNotification(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "Baby Tracker"
        let body = call.getString("body") ?? ""
        let tag = call.getString("tag") ?? UUID().uuidString
        let userInfo = call.getObject("data") ?? [:]

        guard let fireAtMs = call.getDouble("fireAtMs") else {
            call.reject("missing-fireAtMs")
            return
        }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = userInfo

        // A moment that has already passed still deserves delivery, just immediately.
        let secondsAway = (fireAtMs - Date().timeIntervalSince1970 * 1000) / 1000
        let delay = max(1, secondsAway)
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)

        let center = UNUserNotificationCenter.current()
        // Replacing by identifier keeps rescheduling idempotent.
        center.removePendingNotificationRequests(withIdentifiers: [tag])
        center.add(UNNotificationRequest(identifier: tag, content: content, trigger: trigger)) { error in
            if let error = error {
                call.reject("schedule-local-notification-failed", nil, error)
                return
            }
            call.resolve(["ok": true, "delaySeconds": delay])
        }
    }

    @objc func clearLocalNotification(_ call: CAPPluginCall) {
        let tag = call.getString("tag") ?? ""
        guard !tag.isEmpty else {
            call.resolve(["ok": true])
            return
        }

        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [tag])
        center.removeDeliveredNotifications(withIdentifiers: [tag])
        call.resolve(["ok": true])
    }

    private static func mapNotificationStatus(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized:
            return "granted"
        case .provisional:
            return "granted"
        case .ephemeral:
            return "granted"
        case .denied:
            return "denied"
        case .notDetermined:
            return "default"
        @unknown default:
            return "default"
        }
    }
}

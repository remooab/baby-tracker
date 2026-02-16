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

enum BabyTimerBridgeKeys {
    static let appGroupId = "group.com.trueinspo.babytracker"
    static let activeSessionId = "liveActivity.sessionId"
    static let activeTimerKind = "liveActivity.timerKind"
    static let pendingAction = "liveActivity.pendingAction"
}

#if canImport(ActivityKit)
@available(iOS 16.1, *)
struct BabyTimerLiveAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var title: String
        var startDate: Date
        var totalPausedSeconds: Int
        var paused: Bool
        var pausedElapsedSeconds: Int
    }

    var sessionId: String
    var timerKind: String
}

@available(iOS 16.1, *)
final class BabyTimerLiveActivityManager {
    static let shared = BabyTimerLiveActivityManager()
    private var activity: Activity<BabyTimerLiveAttributes>?

    private init() {}

    func startOrUpdate(sessionId: String, timerKind: String, title: String,
                       startDate: Date, totalPausedSeconds: Int, paused: Bool,
                       pausedElapsedSeconds: Int) async -> Bool {
        let attributes = BabyTimerLiveAttributes(sessionId: sessionId, timerKind: timerKind)
        let state = BabyTimerLiveAttributes.ContentState(
            title: title,
            startDate: startDate,
            totalPausedSeconds: totalPausedSeconds,
            paused: paused,
            pausedElapsedSeconds: pausedElapsedSeconds
        )

        if let existing = activity, existing.attributes.sessionId == sessionId {
            if #available(iOS 16.2, *) {
                await existing.update(ActivityContent(state: state, staleDate: nil))
            } else {
                await existing.update(using: state)
            }
            return true
        }

        if let existing = activity {
            if #available(iOS 16.2, *) {
                await existing.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .immediate)
            } else {
                await existing.end(using: state, dismissalPolicy: .immediate)
            }
            activity = nil
        }

        do {
            activity = try Activity<BabyTimerLiveAttributes>.request(
                attributes: attributes,
                contentState: state,
                pushType: nil
            )
            return true
        } catch {
            print("Live Activity request failed:", error.localizedDescription)
            return false
        }
    }

    func stop() async {
        guard let existing = activity else { return }
        let endState = BabyTimerLiveAttributes.ContentState(
            title: "Timer complete",
            startDate: Date(),
            totalPausedSeconds: 0,
            paused: true,
            pausedElapsedSeconds: 0
        )

        if #available(iOS 16.2, *) {
            await existing.end(ActivityContent(state: endState, staleDate: nil), dismissalPolicy: .immediate)
        } else {
            await existing.end(using: endState, dismissalPolicy: .immediate)
        }
        activity = nil
    }
}
#endif

final class NativeSettingsViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground
        title = "Settings"

        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done,
            target: self,
            action: #selector(close)
        )

        let container = UIStackView()
        container.axis = .vertical
        container.spacing = 14
        container.translatesAutoresizingMaskIntoConstraints = false

        let titleLabel = UILabel()
        titleLabel.text = "Native iOS Settings"
        titleLabel.font = .preferredFont(forTextStyle: .title3)

        let subtitleLabel = UILabel()
        subtitleLabel.text = "This native screen is ready for final Apple-style controls."
        subtitleLabel.font = .preferredFont(forTextStyle: .body)
        subtitleLabel.textColor = .secondaryLabel
        subtitleLabel.numberOfLines = 0

        let openSystemSettings = UIButton(type: .system)
        openSystemSettings.setTitle("Open iOS App Settings", for: .normal)
        openSystemSettings.addTarget(self, action: #selector(openAppSettings), for: .touchUpInside)

        container.addArrangedSubview(titleLabel)
        container.addArrangedSubview(subtitleLabel)
        container.addArrangedSubview(openSystemSettings)

        view.addSubview(container)

        NSLayoutConstraint.activate([
            container.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            container.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            container.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20)
        ])
    }

    @objc private func close() {
        dismiss(animated: true)
    }

    @objc private func openAppSettings() {
        guard let settingsUrl = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(settingsUrl)
    }
}

@objc(TimerLiveActivityPlugin)
public class TimerLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TimerLiveActivityPlugin"
    public let jsName = "TimerLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startOrUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openNativeSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPlatformCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchPendingCommand", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getNotificationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotificationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendLocalNotification", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearLocalNotification", returnType: CAPPluginReturnPromise)
    ]

    private var bridgeDefaults: UserDefaults? {
        return UserDefaults(suiteName: BabyTimerBridgeKeys.appGroupId)
    }

    @objc func startOrUpdate(_ call: CAPPluginCall) {
        let sessionId = call.getString("sessionId") ?? "session"
        let timerKind = call.getString("timerKind") ?? "timer"
        let title = call.getString("title") ?? "Baby Timer"
        let startTimestamp = call.getDouble("startTimestamp") ?? (Date().timeIntervalSince1970 * 1000)
        let totalPausedMs = call.getInt("totalPausedMs") ?? 0
        let paused = call.getBool("paused") ?? false
        let pausedElapsedMs = call.getInt("pausedElapsedMs") ?? 0

        let startDate = Date(timeIntervalSince1970: startTimestamp / 1000.0)

        guard #available(iOS 16.1, *) else {
            call.resolve(["ok": false, "reason": "ios-version-too-low"])
            return
        }

        Task {
            let success = await BabyTimerLiveActivityManager.shared.startOrUpdate(
                sessionId: sessionId,
                timerKind: timerKind,
                title: title,
                startDate: startDate,
                totalPausedSeconds: totalPausedMs / 1000,
                paused: paused,
                pausedElapsedSeconds: pausedElapsedMs / 1000
            )

            if success {
                bridgeDefaults?.set(sessionId, forKey: BabyTimerBridgeKeys.activeSessionId)
                bridgeDefaults?.set(timerKind, forKey: BabyTimerBridgeKeys.activeTimerKind)
            }

            call.resolve(["ok": success])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.resolve(["ok": false, "reason": "ios-version-too-low"])
            return
        }

        Task {
            await BabyTimerLiveActivityManager.shared.stop()
            bridgeDefaults?.removeObject(forKey: BabyTimerBridgeKeys.activeSessionId)
            bridgeDefaults?.removeObject(forKey: BabyTimerBridgeKeys.activeTimerKind)
            call.resolve(["ok": true])
        }
    }

    @objc func openNativeSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let viewController = NativeSettingsViewController()
            let navController = UINavigationController(rootViewController: viewController)
            self.bridge?.viewController?.present(navController, animated: true)
            call.resolve(["ok": true])
        }
    }

    @objc func getPlatformCapabilities(_ call: CAPPluginCall) {
        var supportsLiveActivities = false
        if #available(iOS 16.1, *) {
            supportsLiveActivities = true
        }

        call.resolve([
            "isNativeIOS": true,
            "supportsLiveActivities": supportsLiveActivities,
            "supportsNativeNotifications": true,
            "nativeSettingsAvailable": true
        ])
    }

    @objc func fetchPendingCommand(_ call: CAPPluginCall) {
        guard let defaults = bridgeDefaults else {
            call.resolve(["hasCommand": false])
            return
        }

        guard let action = defaults.string(forKey: BabyTimerBridgeKeys.pendingAction) else {
            call.resolve(["hasCommand": false])
            return
        }

        defaults.removeObject(forKey: BabyTimerBridgeKeys.pendingAction)

        call.resolve([
            "hasCommand": true,
            "action": action,
            "sessionId": defaults.string(forKey: BabyTimerBridgeKeys.activeSessionId) ?? "",
            "timerKind": defaults.string(forKey: BabyTimerBridgeKeys.activeTimerKind) ?? ""
        ])
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

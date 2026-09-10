package com.trueinspo.babytracker;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * The Android half of the bridge the web layer has always assumed was there.
 *
 * It answers to the same plugin name as the iOS one, so `Capacitor.registerPlugin`
 * resolves on both platforms — but it implements only the parts Android can honour.
 * Live Activities have no Android equivalent, and `getPlatformCapabilities` says so,
 * which is what keeps the web layer from calling startOrUpdate / fetchLiveState here.
 */
@CapacitorPlugin(
    name = "TimerLiveActivity",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class TimerLiveActivityPlugin extends Plugin {

    private static final String NOTIFICATIONS = "notifications";

    @Override
    public void load() {
        BabyAlertNotifier.ensureChannel(getContext());
    }

    @PluginMethod
    public void getPlatformCapabilities(PluginCall call) {
        JSObject result = new JSObject();
        result.put("isNativeIOS", false);
        result.put("supportsLiveActivities", false);
        result.put("supportsNativeNotifications", true);
        result.put("supportsCsvShare", true);
        result.put("supportsScheduledAlerts", true);
        call.resolve(result);
    }

    // ===== Notification permission =====

    @PluginMethod
    public void getNotificationPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("status", currentNotificationStatus());
        call.resolve(result);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        // Before API 33 there is no runtime permission to ask for — the only switch
        // is the one in system settings, which areNotificationsEnabled() already reads.
        boolean nothingToAsk = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED;

        if (nothingToAsk) {
            JSObject result = new JSObject();
            result.put("status", currentNotificationStatus());
            call.resolve(result);
            return;
        }

        requestPermissionForAlias(NOTIFICATIONS, call, "notificationPermissionResult");
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("status", currentNotificationStatus());
        call.resolve(result);
    }

    /**
     * Maps Android's two separate switches onto the three states the web layer knows.
     *
     * areNotificationsEnabled() is the ground truth — it covers both the API 33 runtime
     * permission and the settings toggle that exists on every version. "default" is
     * reserved for the case where nobody has been asked yet, because that is the only
     * one where showing an "Enable notifications" button will actually do something.
     */
    private String currentNotificationStatus() {
        if (NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {
            return "granted";
        }

        boolean neverAsked = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState(NOTIFICATIONS) == PermissionState.PROMPT;

        return neverAsked ? "default" : "denied";
    }

    // ===== Alerts =====

    @PluginMethod
    public void sendLocalNotification(PluginCall call) {
        String tag = call.getString("tag");
        if (tag == null || tag.isEmpty()) tag = UUID.randomUUID().toString();

        JSObject result = new JSObject();
        if (!"granted".equals(currentNotificationStatus())) {
            // Resolving rather than rejecting: the web layer checks permission before
            // calling, so this is a race, not an error worth unwinding a caller for.
            result.put("ok", false);
            result.put("reason", "not-permitted");
            call.resolve(result);
            return;
        }

        // A tag that fires now has no business also firing later.
        cancelAlarm(tag);

        BabyAlertNotifier.show(
            getContext(),
            tag,
            call.getString("title", "Baby Tracker"),
            call.getString("body", ""),
            dataJson(call)
        );

        result.put("ok", true);
        call.resolve(result);
    }

    /**
     * Hands the alert to AlarmManager ahead of time so it fires whether or not the app
     * is running — the same reason iOS schedules its own copy. The web layer's 5s
     * interval stops ticking the moment Android freezes the WebView.
     *
     * Alarms do not survive a reboot. The web layer re-syncs every alert on launch, so
     * the gap is the window between a restart and the next time the app is opened.
     */
    @PluginMethod
    public void scheduleLocalNotification(PluginCall call) {
        String tag = call.getString("tag");
        if (tag == null || tag.isEmpty()) {
            call.reject("missing-tag");
            return;
        }

        // Not call.getDouble: an epoch in milliseconds arrives as a 13-digit JSON
        // number, which Android's JSON layer boxes as a Long — and getDouble hands
        // back null for anything that isn't already a Double. optDouble reads the
        // Number whatever its box. (iOS never sees this: Swift gets every JS number
        // as a Double, which is why the same call works there.)
        double fireAtMs = call.getData().optDouble("fireAtMs", Double.NaN);
        if (Double.isNaN(fireAtMs)) {
            call.reject("missing-fireAtMs");
            return;
        }

        AlarmManager alarms = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) {
            call.reject("alarm-manager-unavailable");
            return;
        }

        // A moment that has already passed still deserves delivery, just immediately.
        long triggerAtMs = Math.max(System.currentTimeMillis() + 1000L, (long) fireAtMs);

        PendingIntent pending = alarmIntent(
            tag,
            call.getString("title", "Baby Tracker"),
            call.getString("body", ""),
            dataJson(call)
        );

        // Exact alarms need a permission Play reserves for clock and calendar apps.
        // Without it Android may hold an alert back a few minutes in deep Doze, which
        // for "this nap has run long" is a better trade than a rejected release. If the
        // user grants exact alarms in settings, this picks it up on the next schedule.
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms();
        if (exact) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pending);
        } else {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pending);
        }

        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("delaySeconds", (triggerAtMs - System.currentTimeMillis()) / 1000d);
        result.put("exact", exact);
        call.resolve(result);
    }

    @PluginMethod
    public void clearLocalNotification(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", true);

        String tag = call.getString("tag");
        if (tag == null || tag.isEmpty()) {
            call.resolve(result);
            return;
        }

        cancelAlarm(tag);
        BabyAlertNotifier.cancel(getContext(), tag);
        call.resolve(result);
    }

    private void cancelAlarm(String tag) {
        AlarmManager alarms = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        alarms.cancel(alarmIntent(tag, "", "", null));
    }

    /**
     * Android matches PendingIntents on action, data, type, class and category — never
     * on extras. So the tag has to live in the data URI, or cancelling one alert would
     * cancel every other one scheduled.
     */
    private PendingIntent alarmIntent(String tag, String title, String body, String dataJson) {
        Intent intent = new Intent(getContext(), AlertAlarmReceiver.class);
        intent.setAction(AlertAlarmReceiver.ACTION_FIRE);
        intent.setData(Uri.parse("babytracker://alert/" + Uri.encode(tag)));
        intent.putExtra(BabyAlertNotifier.EXTRA_TAG, tag);
        intent.putExtra(BabyAlertNotifier.EXTRA_TITLE, title);
        intent.putExtra(BabyAlertNotifier.EXTRA_BODY, body);
        if (dataJson != null) intent.putExtra(BabyAlertNotifier.EXTRA_DATA, dataJson);

        return PendingIntent.getBroadcast(
            getContext(),
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private String dataJson(PluginCall call) {
        JSObject data = call.getObject("data");
        return data != null ? data.toString() : null;
    }

    // ===== CSV export =====

    /**
     * The WebView ignores `<a download>` here just as WKWebView does on iOS, so the
     * file has to go out through the system share sheet instead.
     */
    @PluginMethod
    public void shareCsv(PluginCall call) {
        String filename = call.getString("filename", "baby-tracker.csv");
        String contents = call.getString("contents", "");

        try {
            File exports = new File(getContext().getCacheDir(), "exports");
            if (!exports.exists() && !exports.mkdirs()) {
                call.reject("export-directory-unavailable");
                return;
            }

            File file = new File(exports, filename);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(contents.getBytes(StandardCharsets.UTF_8));
            }

            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );

            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("text/csv");
            share.putExtra(Intent.EXTRA_STREAM, uri);
            share.putExtra(Intent.EXTRA_SUBJECT, filename);
            share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(share, "Export data");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);

            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("share-csv-failed", error);
        }
    }
}

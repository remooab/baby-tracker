package com.trueinspo.babytracker;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * The one place that turns a baby alert into an Android notification.
 *
 * Both entry points land here — the plugin, when the web layer fires an alert while
 * the app is open, and the alarm receiver, when one comes due with the app closed —
 * so the two can't drift into looking or behaving differently.
 */
final class BabyAlertNotifier {

    static final String CHANNEL_ID = "baby-alerts";

    static final String EXTRA_TAG = "alert.tag";
    static final String EXTRA_TITLE = "alert.title";
    static final String EXTRA_BODY = "alert.body";
    static final String EXTRA_DATA = "alert.data";

    /**
     * Android identifies a notification by the pair (tag, id). The tag already varies
     * per alert, so a single id keeps replacement working: posting the same tag twice
     * updates one notification instead of stacking two.
     */
    private static final int NOTIFICATION_ID = 1;

    private BabyAlertNotifier() {
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Baby alerts",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Awake, nap and night sleep alerts");
        manager.createNotificationChannel(channel);
    }

    static void show(Context context, String tag, String title, String body, String dataJson) {
        ensureChannel(context);

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(EXTRA_TAG, tag);
        if (dataJson != null) open.putExtra(EXTRA_DATA, dataJson);

        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            tag.hashCode(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_baby_alert)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .setContentIntent(contentIntent);

        try {
            NotificationManagerCompat.from(context).notify(tag, NOTIFICATION_ID, builder.build());
        } catch (SecurityException error) {
            // POST_NOTIFICATIONS was revoked between the permission check and here.
            // Nothing to recover: the alert is simply not shown.
        }
    }

    static void cancel(Context context, String tag) {
        NotificationManagerCompat.from(context).cancel(tag, NOTIFICATION_ID);
    }
}

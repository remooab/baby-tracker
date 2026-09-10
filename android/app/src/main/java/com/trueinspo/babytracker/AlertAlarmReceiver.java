package com.trueinspo.babytracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Delivers an alert that came due while the app was closed.
 *
 * AlarmManager wakes this up directly. Nothing here reaches into the web layer,
 * which may not be running — the alert has to arrive whether or not it is.
 */
public class AlertAlarmReceiver extends BroadcastReceiver {

    static final String ACTION_FIRE = "com.trueinspo.babytracker.ALERT";

    @Override
    public void onReceive(Context context, Intent intent) {
        String tag = intent.getStringExtra(BabyAlertNotifier.EXTRA_TAG);
        if (tag == null || tag.isEmpty()) return;

        String title = intent.getStringExtra(BabyAlertNotifier.EXTRA_TITLE);
        String body = intent.getStringExtra(BabyAlertNotifier.EXTRA_BODY);

        BabyAlertNotifier.show(
            context,
            tag,
            title != null ? title : "Baby Tracker",
            body != null ? body : "",
            intent.getStringExtra(BabyAlertNotifier.EXTRA_DATA)
        );
    }
}

package com.trueinspo.babytracker;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must come before super.onCreate: the bridge builds its plugin registry there,
        // and a plugin registered afterwards is invisible to the web layer.
        registerPlugin(TimerLiveActivityPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

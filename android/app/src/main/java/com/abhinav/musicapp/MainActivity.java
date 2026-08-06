package com.abhinav.musicapp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundAudioPlugin.class);
        registerPlugin(AndroidDownloadManager.class);
        super.onCreate(savedInstanceState);
    }
}

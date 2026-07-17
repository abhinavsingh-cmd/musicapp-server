package com.abhinav.musicapp;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin {

    @PluginMethod
    public void startService(PluginCall call) {
        String title = call.getString("title", "MusicApp");
        String artist = call.getString("artist", "Playing music");

        Intent intent = new Intent(getContext(), MusicForegroundService.class);
        intent.putExtra("title", title);
        intent.putExtra("artist", artist);

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Intent intent = new Intent(getContext(), MusicForegroundService.class);
        getContext().stopService(intent);
        call.resolve();
    }
}

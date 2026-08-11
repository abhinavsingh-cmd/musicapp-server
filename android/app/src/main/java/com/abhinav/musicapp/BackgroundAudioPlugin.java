package com.abhinav.musicapp;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "BackgroundAudio",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class BackgroundAudioPlugin extends Plugin {
    private static BackgroundAudioPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) {
            instance = null;
        }
        super.handleOnDestroy();
    }

    public static void notifyMediaAction(String action, long position) {
        BackgroundAudioPlugin plugin = instance;
        if (plugin == null) return;

        JSObject payload = new JSObject();
        payload.put("action", action);
        if (position >= 0) {
            payload.put("position", position);
        }
        plugin.notifyListeners("mediaAction", payload, true);
    }

    public static BackgroundAudioPlugin getInstance() {
        return instance;
    }

    @PluginMethod
    public void startService(PluginCall call) {
        // Always start the service immediately — even without POST_NOTIFICATIONS
        // permission, the foreground service keeps the app alive for background audio.
        startForegroundService(call);

        // On Android 13+, also request notification permission (notification won't
        // show without it, which reduces the OS incentive to keep the process alive).
        if (Build.VERSION.SDK_INT >= 33) {
            int permResult = getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS);
            if (permResult != PackageManager.PERMISSION_GRANTED) {
                requestPermissionForAlias("notifications", call, "handlePermissionResult");
            }
        }
    }

    @PermissionCallback
    private void handlePermissionResult(PluginCall call) {
        MusicForegroundService service = getService();
        if (service != null) {
            service.rebuildNotification();
        }
    }

    private void startForegroundService(PluginCall call) {
        String title = call.getString("title", "MusicApp");
        String artist = call.getString("artist", "Playing music");

        Intent intent = new Intent(getContext(), MusicForegroundService.class);
        intent.putExtra("title", title);
        intent.putExtra("artist", artist);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } catch (Exception e) {
            System.err.println("[BackgroundAudio] Failed to start foreground service: " + e.getMessage());
            JSObject result = new JSObject();
            result.put("started", false);
            result.put("error", e.getMessage());
            call.resolve(result);
            return;
        }

        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Intent intent = new Intent(getContext(), MusicForegroundService.class);
        try {
            getContext().stopService(intent);
        } catch (Exception e) {
            // Service may not be running
        }
        call.resolve();
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        String title = call.getString("title", "MusicApp");
        String artist = call.getString("artist", "Playing music");
        String album = call.getString("album", "MusicApp Album");
        String albumArt = call.getString("albumArt", null);

        MusicForegroundService service = getService();
        if (service != null) {
            service.updateNotification(title, artist, album, albumArt);
        }
        call.resolve();
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        boolean isPlaying = call.getBoolean("isPlaying", false);
        double position = call.getDouble("position", 0.0);
        double duration = call.getDouble("duration", 0.0);

        MusicForegroundService service = getService();
        if (service != null) {
            service.updatePlaybackState(isPlaying, (long) position, (long) duration);
        }
        call.resolve();
    }

    @PluginMethod
    public void setShuffle(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), MusicForegroundService.class);
            intent.setAction("shuffle");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.resolve();
        }
    }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), MusicForegroundService.class);
            intent.setAction("repeat");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.resolve();
        }
    }

    @PluginMethod
    public void getPlaybackState(PluginCall call) {
        MusicForegroundService service = getService();
        if (service != null) {
            JSObject result = new JSObject();
            result.put("isPlaying", service.isPlaying);
            result.put("position", 0.0);
            result.put("duration", 0.0);
            call.resolve(result);
        } else {
            JSObject result = new JSObject();
            result.put("isPlaying", false);
            result.put("position", 0.0);
            result.put("duration", 0.0);
            call.resolve(result);
        }
    }

    private MusicForegroundService getService() {
        return MusicForegroundService.instance;
    }
}

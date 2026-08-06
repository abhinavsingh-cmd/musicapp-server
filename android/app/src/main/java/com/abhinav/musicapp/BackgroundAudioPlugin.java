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

    @PluginMethod
    public void startService(PluginCall call) {
        // Check POST_NOTIFICATIONS permission on Android 13+ before starting
        if (Build.VERSION.SDK_INT >= 33) {
            int permResult = getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS);
            if (permResult != PackageManager.PERMISSION_GRANTED) {
                requestPermissionForAlias("notifications", call, "handlePermissionResult");
                return;
            }
        }

        startForegroundService(call);
    }

    @PermissionCallback
    private void handlePermissionResult(PluginCall call) {
        // Permission was requested — start service regardless of result
        // (notification just won't show if denied, but foreground service still works)
        startForegroundService(call);
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
            // Android 12+ throws ForegroundServiceStartNotAllowedException if started from background
            call.reject("Failed to start foreground service: " + e.getMessage());
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
        // Implement shuffle logic via existing mediaActions
        try {
            Intent intent = new Intent(getContext(), MusicForegroundService.class);
            intent.setAction("shuffle");
            getContext().startService(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to set shuffle: " + e.getMessage());
        }
    }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        // Implement repeat logic via existing mediaActions
        try {
            Intent intent = new Intent(getContext(), MusicForegroundService.class);
            intent.setAction("repeat");
            getContext().startService(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to set repeat: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getPlaybackState(PluginCall call) {
        MusicForegroundService service = getService();
        if (service != null) {
            // Get current playback state
            JSObject result = new JSObject();
            result.put("isPlaying", service.isPlaying);
            // TODO: Get actual position and duration from audio player
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
        // The service instance is accessible via the plugin's context
        // We use a static reference pattern
        return MusicForegroundService.instance;
    }
}

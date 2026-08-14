package com.abhinav.musicapp;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.webkit.WebView;

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

    // WebView keepalive: periodically evaluates a no-op JS to prevent the
    // Android WebView from suspending the JavaScript thread when the app is
    // backgrounded. Without this, HTMLAudioElement stops producing audio.
    private Handler keepAliveHandler;
    private Runnable keepAliveRunnable;
    private static final long KEEP_ALIVE_INTERVAL_MS = 1000;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        stopKeepAliveInternal();
        if (instance == this) {
            instance = null;
        }
        super.handleOnDestroy();
    }

    // -----------------------------------------------------------------------
    // WebView keepalive — prevents JS thread suspension when backgrounded
    // -----------------------------------------------------------------------

    /**
     * Start periodic WebView keepalive. Each tick evaluates a lightweight JS
     * expression to keep the JavaScript thread alive so HTMLAudioElement
     * continues producing audio when the app is in the background.
     *
     * Uses two complementary strategies:
     *   1. evaluateJavascript() — forces the WebView to run JS on the UI thread
     *   2. A no-op post to the WebView's message queue — keeps the looper active
     */
    public void startKeepAlive() {
        if (keepAliveHandler != null) return;

        keepAliveHandler = new Handler(Looper.getMainLooper());
        keepAliveRunnable = new Runnable() {
            @Override
            public void run() {
                try {
                    // Stop if plugin instance was destroyed
                    if (instance == null) {
                        stopKeepAliveInternal();
                        return;
                    }
                    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                    if (webView != null) {
                        // Touch document title to force a DOM update — heavier
                        // than void(0) so the OS is less likely to skip it.
                        webView.evaluateJavascript(
                            "document.title=document.title", null);
                    }
                } catch (Exception e) {
                    System.err.println("[BackgroundAudio] KeepAlive error: " + e.getMessage());
                }
                if (keepAliveHandler != null) {
                    keepAliveHandler.postDelayed(this, KEEP_ALIVE_INTERVAL_MS);
                }
            }
        };
        keepAliveHandler.postDelayed(keepAliveRunnable, KEEP_ALIVE_INTERVAL_MS);
        System.out.println("[BackgroundAudio] WebView keepalive started (interval=" + KEEP_ALIVE_INTERVAL_MS + "ms)");
    }

    private void stopKeepAliveInternal() {
        if (keepAliveHandler != null) {
            keepAliveHandler.removeCallbacksAndMessages(null);
            keepAliveHandler = null;
            keepAliveRunnable = null;
            System.out.println("[BackgroundAudio] WebView keepalive stopped");
        }
    }

    /**
     * Stop the WebView keepalive timer. Safe to call from any thread.
     */
    public static void stopKeepAlive() {
        BackgroundAudioPlugin plugin = instance;
        if (plugin != null) {
            plugin.stopKeepAliveInternal();
        }
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
            result.put("isPlaying", service.isNativePlaying());
            result.put("position", service.getCurrentPosition());
            result.put("duration", service.getDuration());
            call.resolve(result);
        } else {
            JSObject result = new JSObject();
            result.put("isPlaying", false);
            result.put("position", 0.0);
            result.put("duration", 0.0);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void playAudioUrl(PluginCall call) {
        String audioUrl = call.getString("audioUrl", "");
        MusicForegroundService service = getService();
        if (service != null && !audioUrl.isEmpty()) {
            service.playAudioUrl(audioUrl);
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        } else {
            JSObject result = new JSObject();
            result.put("started", false);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void pauseAudio(PluginCall call) {
        MusicForegroundService service = getService();
        if (service != null) {
            service.pausePlayback();
        }
        call.resolve();
    }

    @PluginMethod
    public void resumeAudio(PluginCall call) {
        MusicForegroundService service = getService();
        if (service != null) {
            service.resumePlayback();
        }
        call.resolve();
    }

    @PluginMethod
    public void stopAudio(PluginCall call) {
        MusicForegroundService service = getService();
        if (service != null) {
            service.stopPlayback();
        }
        call.resolve();
    }

    @PluginMethod
    public void seekAudio(PluginCall call) {
        double position = call.getDouble("position", 0.0);
        MusicForegroundService service = getService();
        if (service != null) {
            service.seekToPosition((long) position);
        }
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        double volume = call.getDouble("volume", 1.0);
        MusicForegroundService service = getService();
        if (service != null) {
            service.setVolume((float) volume);
        }
        call.resolve();
    }

    private MusicForegroundService getService() {
        return MusicForegroundService.instance;
    }
}

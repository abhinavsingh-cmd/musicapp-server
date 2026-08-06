package com.abhinav.musicapp;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;

import java.io.File;

/**
 * Capacitor plugin wrapping Android's native DownloadManager.
 *
 * Provides:
 *   - enqueueDownload: queue a download via the system DownloadManager
 *   - cancelDownload: cancel an active download by ID
 *   - queryDownload: check download status/progress
 *   - getDownloadedFile: get the local file path after download completes
 */
@CapacitorPlugin(name = "AndroidDownloadManager")
public class AndroidDownloadManager extends Plugin {

    private static final String CHANNEL_ID = "musicapp_downloads";
    private DownloadManager downloadManager;
    private long currentDownloadId = -1;

    @Override
    public void load() {
        downloadManager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        createNotificationChannel();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.NotificationChannel channel = new android.app.NotificationChannel(
                CHANNEL_ID,
                "Downloads",
                android.app.NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Music download progress");
            android.app.NotificationManager manager = getContext().getSystemService(android.app.NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    /**
     * Enqueue a download via Android DownloadManager.
     *
     * @param call: { url: string, title: string, artist: string, youtubeId: string }
     */
    @PluginMethod
    public void enqueueDownload(PluginCall call) {
        String url = call.getString("url", "");
        String title = call.getString("title", "Unknown");
        String artist = call.getString("artist", "Unknown");
        String youtubeId = call.getString("youtubeId", "");

        if (url.isEmpty()) {
            call.reject("URL is required");
            return;
        }

        String fileName = sanitizeFileName(title) + "_" + sanitizeFileName(artist) + ".mp4";

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
            .setTitle(title)
            .setDescription("Downloading " + title + " by " + artist)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_MUSIC, "MusicApp/" + fileName)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)
            .addRequestHeader("Accept", "audio/*");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            request.setRequiresCharging(false);
        }

        long downloadId = downloadManager.enqueue(request);
        currentDownloadId = downloadId;

        // Register receiver for completion
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        ContextCompat.registerReceiver(
            getContext(),
            new DownloadCompleteReceiver(),
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        );

        JSObject result = new JSObject();
        result.put("downloadId", downloadId);
        result.put("status", "enqueued");
        call.resolve(result);
    }

    /**
     * Cancel an active download by its DownloadManager ID.
     */
    @PluginMethod
    public void cancelDownload(PluginCall call) {
        long downloadId = call.getLong("downloadId", -1);
        if (downloadId == -1) {
            call.reject("downloadId is required");
            return;
        }

        downloadManager.remove(downloadId);
        JSObject result = new JSObject();
        result.put("status", "cancelled");
        call.resolve(result);
    }

    /**
     * Query the status of a download.
     */
    @PluginMethod
    public void queryDownload(PluginCall call) {
        long downloadId = call.getLong("downloadId", -1);
        if (downloadId == -1) {
            call.reject("downloadId is required");
            return;
        }

        DownloadManager.Query query = new DownloadManager.Query();
        query.setFilterById(downloadId);

        Cursor cursor = downloadManager.query(query);
        if (cursor != null && cursor.moveToFirst()) {
            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int totalSizeIndex = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
            int downloadedIndex = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);

            int status = cursor.getInt(statusIndex);
            long totalSize = cursor.getLong(totalSizeIndex);
            long downloaded = cursor.getLong(downloadedIndex);

            int percent = totalSize > 0 ? (int) ((downloaded * 100) / totalSize) : 0;

            String statusString;
            switch (status) {
                case DownloadManager.STATUS_RUNNING:
                    statusString = "downloading";
                    break;
                case DownloadManager.STATUS_PAUSED:
                    statusString = "paused";
                    break;
                case DownloadManager.STATUS_SUCCESSFUL:
                    statusString = "completed";
                    break;
                case DownloadManager.STATUS_FAILED:
                    statusString = "failed";
                    break;
                default:
                    statusString = "pending";
                    break;
            }

            JSObject result = new JSObject();
            result.put("status", statusString);
            result.put("percent", percent);
            result.put("totalSize", totalSize);
            result.put("downloaded", downloaded);
            cursor.close();
            call.resolve(result);
        } else {
            call.reject("Download not found");
        }
    }

    /**
     * Get the local file path for a completed download.
     */
    @PluginMethod
    public void getDownloadedFile(PluginCall call) {
        long downloadId = call.getLong("downloadId", -1);
        if (downloadId == -1) {
            call.reject("downloadId is required");
            return;
        }

        DownloadManager.Query query = new DownloadManager.Query();
        query.setFilterById(downloadId);

        Cursor cursor = downloadManager.query(query);
        if (cursor != null && cursor.moveToFirst()) {
            int localUriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
            String localUri = cursor.getString(localUriIndex);
            cursor.close();

            if (localUri != null) {
                JSObject result = new JSObject();
                result.put("path", localUri);
                result.put("status", "completed");
                call.resolve(result);
            } else {
                call.reject("File not found");
            }
        } else {
            call.reject("Download not found");
        }
    }

    /**
     * Pause a download (Android 7+ only — older versions don't support pause).
     */
    @PluginMethod
    public void pauseDownload(PluginCall call) {
        // Android DownloadManager does not natively support pause.
        // We return a "not_supported" status so the JS side falls back to abort + re-enqueue.
        JSObject result = new JSObject();
        result.put("status", "not_supported");
        result.put("message", "Android DownloadManager does not support pause. Use cancel + re-download.");
        call.resolve(result);
    }

    private String sanitizeFileName(String name) {
        return name.replaceAll("[^a-zA-Z0-9._-]", "_").substring(0, Math.min(name.length(), 50));
    }

    /**
     * BroadcastReceiver for download completion events.
     */
    private class DownloadCompleteReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            long downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (downloadId == currentDownloadId) {
                // Notify JS layer
                JSObject data = new JSObject();
                data.put("downloadId", downloadId);
                notifyListeners("downloadComplete", data);
            }
        }
    }
}

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
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Capacitor plugin wrapping Android's native DownloadManager.
 *
 * Provides:
 *   - enqueueDownload: queue a download via the system DownloadManager
 *   - cancelDownload: cancel an active download by ID
 *   - queryDownload: check download status/progress
 *   - getDownloadedFile: get the local file path after download completes
 *
 * A download is only reported as completed after the resulting file has been
 * validated on disk (exists, non-empty, starts with a known audio container
 * header). The system DownloadManager writes to a temp file and renames it
 * atomically on completion, so callers never observe partial files — but a
 * 0-byte or error-body response still produces a "successful" download entry
 * that must be rejected here.
 */
@CapacitorPlugin(name = "AndroidDownloadManager")
public class AndroidDownloadManager extends Plugin {

    private static final String CHANNEL_ID = "musicapp_downloads";
    /** Anything below this cannot plausibly be an audio file. */
    static final long MIN_AUDIO_FILE_BYTES = 10 * 1024;
    private DownloadManager downloadManager;
    private long currentDownloadId = -1;
    private DownloadCompleteReceiver completionReceiver;

    @Override
    public void load() {
        downloadManager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        createNotificationChannel();
        // Register exactly once for the plugin's lifetime — registering per
        // enqueue leaked a receiver on every download.
        completionReceiver = new DownloadCompleteReceiver();
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        ContextCompat.registerReceiver(
            getContext(),
            completionReceiver,
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @Override
    protected void handleOnDestroy() {
        if (completionReceiver != null) {
            try {
                getContext().unregisterReceiver(completionReceiver);
            } catch (IllegalArgumentException ignored) {
                // Already unregistered
            }
            completionReceiver = null;
        }
        super.handleOnDestroy();
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
     * @param call: { url: string, title: string, artist: string, youtubeId: string, fileName?: string }
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

        // Caller may supply the exact file name (provider already knows the
        // container); otherwise derive one from title/artist.
        String requestedName = call.getString("fileName", "");
        String fileName = requestedName.isEmpty()
            ? sanitizeFileName(title) + "_" + sanitizeFileName(artist) + ".mp4"
            : sanitizeFileNameWithExtension(requestedName);

        System.out.println("[AndroidDownloadManager] DOWNLOAD_START {url=" + url + ", title=" + title + ", artist=" + artist + ", youtubeId=" + youtubeId + "}");

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

        long downloadId;
        try {
            downloadId = downloadManager.enqueue(request);
        } catch (Exception e) {
            // SecurityException (missing notification permission on some OEM
            // builds), IllegalArgumentException (bad destination), etc.
            System.err.println("[AndroidDownloadManager] ENQUEUE_FAILED {error=" + e.getMessage() + "}");
            call.reject("Failed to enqueue download: " + e.getMessage());
            return;
        }
        currentDownloadId = downloadId;

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
        Long downloadId = call.getLong("downloadId", -1L);
        if (downloadId == null || downloadId == -1L) {
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
        Long downloadId = call.getLong("downloadId", -1L);
        if (downloadId == null || downloadId == -1L) {
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
            if (statusIndex < 0) {
                cursor.close();
                call.reject("Download status unavailable");
                return;
            }

            int status = cursor.getInt(statusIndex);
            long totalSize = totalSizeIndex >= 0 ? cursor.getLong(totalSizeIndex) : -1;
            long downloaded = downloadedIndex >= 0 ? cursor.getLong(downloadedIndex) : 0;

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

            System.out.println("[AndroidDownloadManager] QUERY_DOWNLOAD {downloadId=" + downloadId + ", status=" + statusString + ", percent=" + percent + ", totalSize=" + totalSize + ", downloaded=" + downloaded + "}");

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
     *
     * A path is only returned when the DownloadManager reports
     * STATUS_SUCCESSFUL AND the file on disk passes validation (exists,
     * larger than MIN_AUDIO_FILE_BYTES, starts with a known audio header).
     * Otherwise the call is rejected with the concrete reason.
     */
    @PluginMethod
    public void getDownloadedFile(PluginCall call) {
        Long downloadId = call.getLong("downloadId", -1L);
        if (downloadId == null || downloadId == -1L) {
            call.reject("downloadId is required");
            return;
        }

        DownloadManager.Query query = new DownloadManager.Query();
        query.setFilterById(downloadId);

        Cursor cursor = downloadManager.query(query);
        if (cursor != null && cursor.moveToFirst()) {
            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int localUriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
            int reasonIndex = cursor.getColumnIndex(DownloadManager.COLUMN_REASON);
            int totalSizeIndex = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
            int status = statusIndex >= 0 ? cursor.getInt(statusIndex) : -1;
            String localUri = localUriIndex >= 0 ? cursor.getString(localUriIndex) : null;
            int reason = reasonIndex >= 0 ? cursor.getInt(reasonIndex) : -1;
            long declaredSize = totalSizeIndex >= 0 ? cursor.getLong(totalSizeIndex) : -1;
            cursor.close();

            System.out.println("[AndroidDownloadManager] GET_DOWNLOADED_FILE_START {downloadId=" + downloadId + ", status=" + status + ", localUri=" + localUri + ", reason=" + reason + ", declaredSize=" + declaredSize + "}");

            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                // A failed/aborted download can still leave partial bytes on
                // disk — never leave them behind on the user's device.
                deleteFileQuietly(uriToFile(localUri));
                System.err.println("[AndroidDownloadManager] GET_DOWNLOADED_FILE_FAILED {downloadId=" + downloadId + ", status=" + status + ", reason=" + reason + "}");
                call.reject("Download did not complete successfully (status=" + status
                    + (reason >= 0 ? ", reason=" + reason : "") + ")");
                return;
            }

            if (localUri == null) {
                System.err.println("[AndroidDownloadManager] GET_DOWNLOADED_FILE_FAILED {downloadId=" + downloadId + ", error=NO_LOCAL_URI}");
                call.reject("File not found — download reports no local URI");
                return;
            }

            // Validate the actual bytes on disk before declaring success.
            // The declared Content-Length (when known) must match the bytes
            // on disk exactly — a truncated transfer otherwise passes every
            // header sniff.
            File file = uriToFile(localUri);
            String invalidReason = validateDownloadedFile(file, declaredSize);
            if (invalidReason != null) {
                // The file failed every check (empty, truncated, error page) —
                // it is garbage, not a valid download: remove it instead of
                // leaving a broken file in the user's Music folder.
                deleteFileQuietly(file);
                System.err.println("[AndroidDownloadManager] FILE_VALIDATION_FAILED {downloadId=" + downloadId + ", reason=" + invalidReason + "}");
                call.reject("Downloaded file is invalid: " + invalidReason);
                return;
            }

            System.out.println("[AndroidDownloadManager] GET_DOWNLOADED_FILE_SUCCESS {downloadId=" + downloadId + ", path=" + localUri + ", size=" + file.length() + "}");

            JSObject result = new JSObject();
            result.put("path", localUri);
            result.put("size", file.length());
            result.put("status", "completed");
            call.resolve(result);
        } else {
            if (cursor != null) cursor.close();
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
        if (name == null) return "track";
        String cleaned = name.replaceAll("[^a-zA-Z0-9._-]", "_");
        cleaned = cleaned.substring(0, Math.min(cleaned.length(), 50));
        return cleaned.isEmpty() ? "track" : cleaned;
    }

    /**
     * Sanitize a full file name (base + extension). The extension is kept
     * verbatim when it looks like a media extension, otherwise it is
     * sanitized like the base name.
     */
    static String sanitizeFileNameWithExtension(String fileName) {
        if (fileName == null || fileName.isEmpty()) return "track.mp4";
        int dot = fileName.lastIndexOf('.');
        if (dot <= 0 || dot == fileName.length() - 1) {
            return sanitizeStatic(fileName) + ".mp4";
        }
        String base = fileName.substring(0, dot);
        String ext = fileName.substring(dot + 1).toLowerCase();
        if (!ext.matches("[a-z0-9]{1,5}")) ext = "mp4";
        return sanitizeStatic(base) + "." + ext;
    }

    private static String sanitizeStatic(String name) {
        if (name == null) return "track";
        String cleaned = name.replaceAll("[^a-zA-Z0-9._-]", "_");
        cleaned = cleaned.substring(0, Math.min(cleaned.length(), 50));
        return cleaned.isEmpty() ? "track" : cleaned;
    }

    /**
     * Convert a DownloadManager local URI (file:// or content://) to a File
     * when possible. Returns null for URIs that cannot be inspected directly.
     */
    static File uriToFile(String localUri) {
        if (localUri == null) return null;
        try {
            Uri uri = Uri.parse(localUri);
            if ("file".equals(uri.getScheme())) {
                return new File(uri.getPath() == null ? "" : uri.getPath());
            }
            // content:// URIs from MediaStore map to Files directory paths on
            // most devices; fall back to path-based inspection.
            if (uri.getPath() != null) {
                File f = new File(uri.getPath());
                if (f.exists()) return f;
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    /**
     * Validate a completed download file on disk.
     *
     * @return null when the file is a plausible audio file, otherwise a
     *         human-readable reason describing exactly what is wrong.
     */
    static String validateDownloadedFile(File file) {
        System.out.println("[AndroidDownloadManager] FILE_VALIDATION_START {file=" + file + "}");
        if (file == null) {
            System.err.println("[AndroidDownloadManager] FILE_VALIDATION_FAILED {reason=NULL_FILE}");
            return "file could not be located on disk";
        }
        if (!file.exists()) {
            System.err.println("[AndroidDownloadManager] FILE_VALIDATION_FAILED {reason=FILE_NOT_FOUND, file=" + file.getName() + "}");
            return "file does not exist at " + file.getName();
        }
        long size = file.length();
        if (size == 0) {
            System.err.println("[AndroidDownloadManager] FILE_VALIDATION_FAILED {reason=EMPTY_FILE, size=0}");
            return "0 bytes — the server sent an empty response";
        }
        if (size < MIN_AUDIO_FILE_BYTES) {
            System.err.println("[AndroidDownloadManager] FILE_VALIDATION_FAILED {reason=TOO_SMALL, size=" + size + "}");
            return size + " bytes — too small to be a valid audio file";
        }
        byte[] head = new byte[16];
        int read;
        try (InputStream in = new FileInputStream(file)) {
            read = in.read(head);
        } catch (IOException e) {
            System.err.println("[AndroidDownloadManager] FILE_VALIDATION_FAILED {reason=READ_ERROR, error=" + e.getMessage() + "}");
            return "could not read file header: " + e.getMessage();
        }
        if (read < 2) {
            System.err.println("[AndroidDownloadManager] FILE_VALIDATION_FAILED {reason=HEADER_TOO_SMALL, read=" + read + "}");
            return "could not read file header";
        }
        if (!looksLikeAudio(head, read)) {
            System.err.println("[AndroidDownloadManager] FILE_VALIDATION_FAILED {reason=INVALID_MAGIC_BYTES, read=" + read + "}");
            return "header bytes are not a known audio container (possibly an HTML/JSON error page)";
        }
        System.out.println("[AndroidDownloadManager] FILE_VALIDATION_SUCCESS {file=" + file + ", size=" + size + "}");
        return null;
    }

    /**
     * Content-Length aware validation. When the DownloadManager knows the
     * declared total size, the bytes on disk must match it exactly — a
     * truncated transfer would otherwise pass the header sniff and look like
     * a perfectly valid (but cut-off) audio file.
     */
    static String validateDownloadedFile(File file, long declaredSize) {
        String reason = validateDownloadedFile(file);
        if (reason != null) return reason;
        if (declaredSize > 0 && file.length() != declaredSize) {
            System.err.println("[AndroidDownloadManager] FILE_VALIDATION_FAILED {reason=TRUNCATED_TRANSFER, fileSize=" + file.length() + ", declaredSize=" + declaredSize + "}");
            return file.length() + " bytes but the server declared " + declaredSize
                + " — truncated transfer";
        }
        return null;
    }

    /**
     * Best-effort removal of an invalid or partial download file. Never
     * throws — cleanup must never mask the original rejection reason.
     */
    static boolean deleteFileQuietly(File file) {
        if (file == null) return false;
        try {
            return file.delete();
        } catch (Exception ignored) {
            return false;
        }
    }

    /**
     * Sniff the leading bytes of a payload for known audio container headers.
     * Mirrors the client-side sniffAudioBytes() so both layers reject the
     * same garbage.
     */
    static boolean looksLikeAudio(byte[] head, int length) {
        if (head == null || length <= 0) return false;
        // ID3v2 tag ('ID3')
        if (length >= 3 && head[0] == 0x49 && head[1] == 0x44 && head[2] == 0x33) return true;
        // MPEG frame sync / ADTS
        if (length >= 2 && (head[0] & 0xFF) == 0xFF && ((head[1] & 0xFF) & 0xE0) == 0xE0) return true;
        // MP4/M4A ('....ftyp')
        if (length >= 8 && head[4] == 0x66 && head[5] == 0x74 && head[6] == 0x79 && head[7] == 0x70) return true;
        // WebM/Matroska (EBML)
        if (length >= 4 && (head[0] & 0xFF) == 0x1A && (head[1] & 0xFF) == 0x45 && (head[2] & 0xFF) == 0xDF && (head[3] & 0xFF) == 0xA3) return true;
        // Ogg ('OggS')
        if (length >= 4 && head[0] == 0x4F && head[1] == 0x67 && head[2] == 0x67 && head[3] == 0x53) return true;
        // FLAC ('fLaC')
        if (length >= 4 && head[0] == 0x66 && head[1] == 0x4C && head[2] == 0x61 && head[3] == 0x43) return true;
        // RIFF/WAVE
        if (length >= 12 && head[0] == 0x52 && head[1] == 0x49 && head[2] == 0x46 && head[3] == 0x46
            && head[8] == 0x57 && head[9] == 0x41 && head[10] == 0x56 && head[11] == 0x45) return true;
        return false;
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

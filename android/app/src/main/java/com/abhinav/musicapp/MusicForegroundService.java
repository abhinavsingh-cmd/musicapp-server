package com.abhinav.musicapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

public class MusicForegroundService extends Service implements MediaPlayer.OnPreparedListener, MediaPlayer.OnCompletionListener, MediaPlayer.OnErrorListener, MediaPlayer.OnSeekCompleteListener, MediaPlayer.OnBufferingUpdateListener, MediaPlayer.OnInfoListener {
    private static final String CHANNEL_ID = "music_playback";
    private static final int NOTIFICATION_ID = 1;
    private static final String ACTION_PLAY = "com.abhinav.musicapp.action.PLAY";
    private static final String ACTION_PAUSE = "com.abhinav.musicapp.action.PAUSE";
    private static final String ACTION_NEXT = "com.abhinav.musicapp.action.NEXT";
    private static final String ACTION_PREVIOUS = "com.abhinav.musicapp.action.PREVIOUS";
    private static final String ACTION_STOP = "com.abhinav.musicapp.action.STOP";
    private static final String ACTION_HEADSET_PLUG = "android.intent.action.HEADSET_PLUG";
    // Bluetooth audio-path disconnect events (A2DP streaming + HFP headset
    // profiles). The adapter-level event alone misses profile disconnects.
    private static final String ACTION_BT_A2DP_STATE = "android.bluetooth.a2dp.action.CONNECTION_STATE_CHANGED";
    private static final String ACTION_BT_HEADSET_STATE = "android.bluetooth.headset.action.CONNECTION_STATE_CHANGED";
    private static final String EXTRA_BT_PROFILE_STATE = "android.bluetooth.profile.extra.STATE";
    /** Starts the service (if needed) AND begins native playback in one intent. */
    public static final String ACTION_PLAY_URL = "com.abhinav.musicapp.action.PLAY_URL";

    public static MusicForegroundService instance;

    // Native MediaPlayer for actual audio playback (survives WebView lifecycle)
    private MediaPlayer mediaPlayer;
    private String pendingAudioUrl;
    private boolean isPrepared = false;
    private boolean isBuffering = false;

    // ── Native engine state machine ──
    // nativeEngineActive: the native MediaPlayer owns playback (vs. a WebView
    //   engine). While true, JS-pushed playback state is ignored.
    private boolean nativeEngineActive = false;
    // playWhenPrepared: distinguishes user-paused from still-buffering so a
    //   pause that arrives during prepareAsync wins the race against onPrepared.
    private boolean playWhenPrepared = false;
    // Generation counter: every play/stop invalidates older async prepares so
    //   a stale onPrepared can never start an abandoned track.
    private int playbackGeneration = 0;
    private int preparedGeneration = -1;
    private long pendingStartPositionMs = 0;
    private String currentUrl = null;
    // Prepare watchdog: a stream whose server never sends bytes (cold Render
    // instance, dead upstream) leaves MediaPlayer in preparing state FOREVER —
    // it retries network reads every ~3s indefinitely. This timer converts the
    // silent hang into an 'error' notification so JS can smart-replace or skip.
    private static final long PREPARE_TIMEOUT_MS = 25_000;
    private Runnable prepareTimeoutRunnable;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    // Audio focus bookkeeping — resume only happens when the pre-interruption
    //   state says playback should resume (never blindly).
    private float userVolume = 1.0f;
    private boolean resumeOnFocusGain = false;
    private boolean isDucking = false;
    private AudioManager.OnAudioFocusChangeListener focusListener;
    // Album artwork (loaded off the UI thread, cached per URL)
    private String currentAlbumArt = null;
    private Bitmap artworkBitmap = null;
    // Track completion that happened while NO listener could consume it (JS
    // disconnected / WebView destroyed). A reconnecting JS layer reads the
    // flag via getPlaybackState and continues the queue deterministically.
    private boolean endedPending = false;

    // ── Media-button debounce ──
    // Bluetooth headsets, lock screens and notification taps can deliver the
    // SAME transport action multiple times (double-tap, session callback AND
    // notification tap racing). Every source funnels through
    // dispatchMediaAction; a short per-action window plus state-based
    // redundancy guards guarantee one physical press = one state transition.
    static final long MEDIA_ACTION_DEBOUNCE_MS = 250;
    private String lastMediaAction = null;
    private long lastMediaActionPosition = -1;
    private long lastMediaActionAt = 0;

    // Last position pushed by JS (seconds→ms). Used for the MediaSession
    // playback state when the WebView engine (not the native MediaPlayer)
    // owns playback — the native player has no position in that case.
    private long lastKnownPositionMs = 0;

    // ── Playback snapshot persistence ──
    // Survives Android service recreation: when the OS kills and restarts
    // this START_STICKY service, onStartCommand(null) re-creates playback
    // from the snapshot instead of showing a dead notification.
    private static final String PREFS_NAME = "music_playback_state";
    private static final String KEY_URL = "url";
    private static final String KEY_TITLE = "title";
    private static final String KEY_ARTIST = "artist";
    private static final String KEY_ALBUM = "album";
    private static final String KEY_ALBUM_ART = "albumArt";
    private static final String KEY_POSITION_MS = "positionMs";
    private static final String KEY_WAS_PLAYING = "wasPlaying";

    private NotificationManager notificationManager;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private PowerManager.WakeLock wakeLock;
    private BroadcastReceiver headsetReceiver;
    private MediaSession mediaSession;
    private String currentTitle = "MusicApp";
    private String currentArtist = "Playing music";
    private String currentAlbum = "MusicApp Album";
    public boolean isPlaying = false;
    private long duration = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        try {
            notificationManager = getSystemService(NotificationManager.class);
            audioManager = getSystemService(AudioManager.class);
            createNotificationChannel();
            requestAudioFocus();
            registerHeadsetReceiver();
            initMediaSession();
            acquireWakeLock();

            // Initialize native MediaPlayer for background playback
            initMediaPlayer();
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] onCreate failed: " + e.getMessage());
        }
    }

    private void initMediaPlayer() {
        try {
            mediaPlayer = new MediaPlayer();
            mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build());
            mediaPlayer.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
            mediaPlayer.setOnPreparedListener(this);
            mediaPlayer.setOnCompletionListener(this);
            mediaPlayer.setOnErrorListener(this);
            mediaPlayer.setOnSeekCompleteListener(this);
            mediaPlayer.setOnBufferingUpdateListener(this);
            mediaPlayer.setOnInfoListener(this);
            Log.i("MusicForegroundService", "Native MediaPlayer initialized");
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] initMediaPlayer failed: " + e.getMessage());
        }
    }

    // ─── Native MediaPlayer playback control ───

    public void playAudioUrl(String audioUrl) {
        playAudioUrl(audioUrl, 0);
    }

    public synchronized void playAudioUrl(String audioUrl, long startPositionMs) {
        if (mediaPlayer == null) return;
        try {
            playbackGeneration++;
            boolean isNetworkUrl = audioUrl != null && (
                audioUrl.startsWith("http:") || 
                audioUrl.startsWith("https:") || 
                audioUrl.startsWith("rtsp:") || 
                audioUrl.startsWith("udp:"));
            
            mediaPlayer.reset();
            
            if (isNetworkUrl) {
                // Network/streaming URL - use setDataSource with URL string directly
                // This bypasses MediaExtractor compatibility issues with streaming URLs
                mediaPlayer.setDataSource(audioUrl);
                Log.i("MusicForegroundService", "Preparing native MediaPlayer for streaming: " + audioUrl);
            } else {
                // Local file path or content URI (file://, content://, or raw path)
                // Use setDataSource with Context and Uri - handles all local sources
                mediaPlayer.setDataSource(this, Uri.parse(audioUrl));
                Log.i("MusicForegroundService", "Preparing native MediaPlayer for local source: " + audioUrl);
            }
            
            preparedGeneration = playbackGeneration;
            persistSnapshot(true, startPositionMs);
            mediaPlayer.prepareAsync();
            armPrepareTimeout(playbackGeneration);
            
            pendingAudioUrl = audioUrl;
            currentUrl = audioUrl;
            playWhenPrepared = true;
            nativeEngineActive = true;
            resumeOnFocusGain = false;
            isPrepared = false;
            isBuffering = true;
            requestAudioFocus();
            updateNativePlaybackState(PlaybackState.STATE_BUFFERING);
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] playAudioUrl failed: " + e.getMessage());
            isBuffering = false;
            updateNativePlaybackState(PlaybackState.STATE_ERROR);
            BackgroundAudioPlugin.notifyMediaAction("error", -1);
        }
    }

    /** Arms the prepare watchdog for this generation. A stale firing (a newer
     *  play/stop already happened) is ignored via generation check. */
    private void armPrepareTimeout(final int generation) {
        cancelPrepareTimeout();
        prepareTimeoutRunnable = () -> {
            if (generation != playbackGeneration) return; // superseded
            if (isPrepared) return;                       // prepared in time
            System.err.println("[MusicForegroundService] PREPARE_TIMEOUT after " + PREPARE_TIMEOUT_MS + "ms — no audio bytes from server");
            isBuffering = false;
            nativeEngineActive = false;
            updateNativePlaybackState(PlaybackState.STATE_ERROR);
            BackgroundAudioPlugin.notifyMediaAction("error", -1);
        };
        mainHandler.postDelayed(prepareTimeoutRunnable, PREPARE_TIMEOUT_MS);
    }

    private void cancelPrepareTimeout() {
        if (prepareTimeoutRunnable != null) {
            mainHandler.removeCallbacks(prepareTimeoutRunnable);
            prepareTimeoutRunnable = null;
        }
    }

    public synchronized void pausePlayback() {
        // Also covers pause-during-buffering: onPrepared will not auto-start.
        playWhenPrepared = false;
        long pos = getCurrentPosition();
        if (mediaPlayer != null && isPrepared && mediaPlayer.isPlaying()) {
            try { mediaPlayer.pause(); } catch (IllegalStateException ignored) {}
        }
        isPlaying = false;
        persistSnapshot(false, pos);
        updateNativePlaybackState(PlaybackState.STATE_PAUSED);
        rebuildNotification();
        Log.i("MusicForegroundService", "Native playback paused");
    }

    public synchronized void resumePlayback() {
        // If still buffering, the flag makes onPrepared start when ready.
        playWhenPrepared = true;
        if (mediaPlayer != null && isPrepared && !mediaPlayer.isPlaying()) {
            requestAudioFocus();
            try { mediaPlayer.start(); } catch (IllegalStateException ignored) {}
            isPlaying = true;
            persistSnapshot(true, getCurrentPosition());
            updateNativePlaybackState(PlaybackState.STATE_PLAYING);
            rebuildNotification();
            Log.i("MusicForegroundService", "Native playback resumed");
        }
    }

    public synchronized void stopPlayback() {
        playbackGeneration++;
        playWhenPrepared = false;
        resumeOnFocusGain = false;
        cancelPrepareTimeout();
        if (mediaPlayer != null) {
            try { mediaPlayer.stop(); } catch (IllegalStateException ignored) {}
            mediaPlayer.reset();
        }
        isPlaying = false;
        isPrepared = false;
        isBuffering = false;
        nativeEngineActive = false;
        pendingAudioUrl = null;
        currentUrl = null;
        clearSnapshot();
        updateNativePlaybackState(PlaybackState.STATE_STOPPED);
        abandonAudioFocus();
        Log.i("MusicForegroundService", "Native playback stopped");
    }

    public void seekToPosition(long position) {
        if (mediaPlayer != null && isPrepared) {
            try {
                mediaPlayer.seekTo((int) position);
                // MediaSession state is refreshed in onSeekComplete once the
                // seek has actually landed (publishing now would report the
                // PRE-seek position).
                Log.i("MusicForegroundService", "Native seek to: " + position);
            } catch (Exception e) {
                System.err.println("[MusicForegroundService] seekToPosition failed: " + e.getMessage());
            }
        }
    }

    public void setVolume(float volume) {
        userVolume = volume;
        applyVolume();
    }

    /** Applies userVolume (or the ducked level during a transient duck). */
    private void applyVolume() {
        if (mediaPlayer == null) return;
        float v = isDucking ? userVolume * 0.2f : userVolume;
        try { mediaPlayer.setVolume(v, v); } catch (Exception ignored) {}
    }

    public boolean isNativeEngineActive() { return nativeEngineActive; }
    public boolean isNativeBuffering() { return isBuffering; }
    public String getCurrentUrl() { return currentUrl; }
    public String getCurrentTitle() { return currentTitle; }
    public String getCurrentArtist() { return currentArtist; }

    /** True if a track completed while no JS listener could consume the event.
     *  Non-destructive read — consumption is an explicit acknowledge. */
    public boolean hasEndedPending() { return endedPending; }

    /** Consume the pending-ended flag (JS has taken over queue continuation). */
    public boolean consumeEndedPending() {
        boolean v = endedPending;
        endedPending = false;
        return v;
    }

    // ─── Playback snapshot (service recreation survival) ───

    private void persistSnapshot(boolean wasPlaying, long positionMs) {
        try {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                .putString(KEY_URL, currentUrl)
                .putString(KEY_TITLE, currentTitle)
                .putString(KEY_ARTIST, currentArtist)
                .putString(KEY_ALBUM, currentAlbum)
                .putString(KEY_ALBUM_ART, currentAlbumArt)
                .putLong(KEY_POSITION_MS, Math.max(0, positionMs))
                .putBoolean(KEY_WAS_PLAYING, wasPlaying)
                .apply();
        } catch (Exception ignored) {}
    }

    /** Clears the resumable state — used on stop/completion/task removal so a
     *  restarted service never resurrects a deliberately-ended session. */
    private void clearSnapshot() {
        try {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                .putString(KEY_URL, null)
                .putBoolean(KEY_WAS_PLAYING, false)
                .apply();
        } catch (Exception ignored) {}
    }

    public long getCurrentPosition() {
        if (mediaPlayer != null && isPrepared) {
            try {
                return mediaPlayer.getCurrentPosition();
            } catch (Exception e) {
                return 0;
            }
        }
        return 0;
    }

    public long getDuration() {
        if (mediaPlayer != null && isPrepared) {
            try {
                return mediaPlayer.getDuration();
            } catch (Exception e) {
                return 0;
            }
        }
        return 0;
    }

    public boolean isNativePlaying() {
        return mediaPlayer != null && mediaPlayer.isPlaying();
    }

    /** Identifies the current playback session. Shipped with lifecycle events
     *  (ended) so the JS layer can drop stale completions deterministically —
     *  a late 'ended' for an old track can never advance the new track. */
    public int getPlaybackGeneration() { return playbackGeneration; }

    // Helper to update playback state for native MediaPlayer (used internally)
    private void updateNativePlaybackState(int state) {
        if (mediaSession != null) {
            try {
                PlaybackState.Builder stateBuilder = new PlaybackState.Builder()
                    .setState(state, getCurrentPosition(), 1.0f)
                    .setActions(
                        PlaybackState.ACTION_PLAY |
                        PlaybackState.ACTION_PAUSE |
                        PlaybackState.ACTION_PLAY_PAUSE |
                        PlaybackState.ACTION_SKIP_TO_NEXT |
                        PlaybackState.ACTION_SKIP_TO_PREVIOUS |
                        PlaybackState.ACTION_STOP |
                        PlaybackState.ACTION_SEEK_TO
                    );
                mediaSession.setPlaybackState(stateBuilder.build());
            } catch (Exception e) {
                System.err.println("[MusicForegroundService] updateNativePlaybackState failed: " + e.getMessage());
            }
        }
    }

    // ─── MediaPlayer callbacks ───

    @Override
    public void onPrepared(MediaPlayer mp) {
        if (mp != mediaPlayer) return;
        // Stale prepare from a replaced/stopped track — never start it.
        if (preparedGeneration != playbackGeneration) return;
        cancelPrepareTimeout();
        isPrepared = true;
        isBuffering = false;
        if (pendingStartPositionMs > 0) {
            try { mp.seekTo((int) pendingStartPositionMs); } catch (Exception ignored) {}
            pendingStartPositionMs = 0;
        }
        // Duration is known now — refresh MediaSession metadata so lock
        // screen / Bluetooth seek bars show the correct track length.
        updateMediaSessionMetadata();
        if (playWhenPrepared && pendingAudioUrl != null) {
            mp.start();
            isPlaying = true;
            persistSnapshot(true, getCurrentPosition());
            updateNativePlaybackState(PlaybackState.STATE_PLAYING);
            rebuildNotification();
            Log.i("MusicForegroundService", "Native MediaPlayer prepared and started");
        } else {
            persistSnapshot(false, getCurrentPosition());
            updateNativePlaybackState(PlaybackState.STATE_PAUSED);
        }
    }

    @Override
    public void onCompletion(MediaPlayer mp) {
        isPlaying = false;
        isPrepared = false;
        pendingAudioUrl = null;
        // Session over — a reconnecting WebView must not adopt a dead track.
        nativeEngineActive = false;
        endedPending = true;
        clearSnapshot(); // never resurrect a completed track
        updateNativePlaybackState(PlaybackState.STATE_STOPPED);
        // Notify JS layer to handle next song — tagged with THIS session's
        // generation. If JS is disconnected right now the event is lost, but
        // endedPending keeps the continuation request alive until reconnect.
        BackgroundAudioPlugin.notifyMediaAction("ended", -1, playbackGeneration);
        Log.i("MusicForegroundService", "Native MediaPlayer completed");
    }

    @Override
    public boolean onError(MediaPlayer mp, int what, int extra) {
        System.err.println("[MusicForegroundService] Native MediaPlayer error: what=" + what + ", extra=" + extra);
        cancelPrepareTimeout();
        isBuffering = false;
        isPrepared = false;
        isPlaying = false;
        updateNativePlaybackState(PlaybackState.STATE_ERROR);
        // Notify JS layer of error
        BackgroundAudioPlugin.notifyMediaAction("error", -1);
        return true; // Handled
    }

    @Override
    public void onSeekComplete(MediaPlayer mp) {
        if (mp != mediaPlayer) return;
        // Refresh the MediaSession position only once the seek has landed —
        // updating before completion would publish the PRE-seek position.
        updateNativePlaybackState(isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED);
        Log.i("MusicForegroundService", "Native seek complete");
    }

    @Override
    public void onBufferingUpdate(MediaPlayer mp, int percent) {
        // Could emit buffering progress to JS if needed
    }

    @Override
    public boolean onInfo(MediaPlayer mp, int what, int extra) {
        if (what == MediaPlayer.MEDIA_INFO_BUFFERING_START) {
            isBuffering = true;
            updateNativePlaybackState(PlaybackState.STATE_BUFFERING);
            Log.i("MusicForegroundService", "Native buffering started");
        } else if (what == MediaPlayer.MEDIA_INFO_BUFFERING_END) {
            isBuffering = false;
            if (isPlaying) {
                updateNativePlaybackState(PlaybackState.STATE_PLAYING);
            }
            Log.i("MusicForegroundService", "Native buffering ended");
        }
        return true;
    }

    // -----------------------------------------------------------------------
    // MediaSession — required for Bluetooth/lock-screen/notification transport
    // controls. Android routes ALL media button events through this session.
    // -----------------------------------------------------------------------
    private void initMediaSession() {
        try {
            mediaSession = new MediaSession(this, "MusicAppPlayback");
            mediaSession.setCallback(new MediaSession.Callback() {
                @Override public void onPlay() {
                    dispatchMediaAction(ACTION_PLAY, -1);
                }
                @Override public void onPause() {
                    dispatchMediaAction(ACTION_PAUSE, -1);
                }
                @Override public void onStop() {
                    dispatchMediaAction(ACTION_STOP, -1);
                }
                @Override public void onSkipToNext() {
                    dispatchMediaAction(ACTION_NEXT, -1);
                }
                @Override public void onSkipToPrevious() {
                    dispatchMediaAction(ACTION_PREVIOUS, -1);
                }
                @Override public void onSeekTo(long pos) {
                    dispatchMediaAction("seek", pos);
                }
            });
            mediaSession.setActive(true);

            // Initial playback state so the system knows we support transport controls
            PlaybackState.Builder stateBuilder = new PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY |
                    PlaybackState.ACTION_PAUSE |
                    PlaybackState.ACTION_PLAY_PAUSE |
                    PlaybackState.ACTION_SKIP_TO_NEXT |
                    PlaybackState.ACTION_SKIP_TO_PREVIOUS |
                    PlaybackState.ACTION_STOP |
                    PlaybackState.ACTION_SEEK_TO
                )
                .setState(PlaybackState.STATE_PAUSED, 0, 1.0f);
            mediaSession.setPlaybackState(stateBuilder.build());
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] initMediaSession failed: " + e.getMessage());
            mediaSession = null;
        }
    }

    private void updateMediaSessionState() {
        if (mediaSession == null) return;
        try {
            int state = isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
            // Native engine: real player position. WebView engine: the last
            // JS-pushed position — a hardcoded 0 would freeze every lock
            // screen / Bluetooth seek bar at the start of the track.
            long pos = nativeEngineActive ? getCurrentPosition() : lastKnownPositionMs;
            PlaybackState.Builder stateBuilder = new PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY |
                    PlaybackState.ACTION_PAUSE |
                    PlaybackState.ACTION_PLAY_PAUSE |
                    PlaybackState.ACTION_SKIP_TO_NEXT |
                    PlaybackState.ACTION_SKIP_TO_PREVIOUS |
                    PlaybackState.ACTION_STOP |
                    PlaybackState.ACTION_SEEK_TO
                )
                .setState(state, pos, 1.0f);
            mediaSession.setPlaybackState(stateBuilder.build());
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] updateMediaSessionState failed: " + e.getMessage());
        }
    }

    private void updateMediaSessionMetadata() {
        if (mediaSession == null) return;
        try {
            android.media.MediaMetadata.Builder metaBuilder = new android.media.MediaMetadata.Builder()
                .putString(android.media.MediaMetadata.METADATA_KEY_TITLE, currentTitle)
                .putString(android.media.MediaMetadata.METADATA_KEY_ARTIST, currentArtist)
                .putString(android.media.MediaMetadata.METADATA_KEY_ALBUM, currentAlbum);
            // Duration: native player once prepared, otherwise the duration
            // pushed by JS (seconds). Lets lock-screen seek bars scale correctly.
            long durationMs = nativeEngineActive ? getDuration() : duration * 1000;
            if (durationMs > 0) {
                metaBuilder.putLong(android.media.MediaMetadata.METADATA_KEY_DURATION, durationMs);
            }
            // Artwork URI — the system fetches it for lock screen / Bluetooth
            // displays (the downloaded bitmap backs the notification itself).
            if (currentAlbumArt != null && currentAlbumArt.startsWith("http")) {
                metaBuilder.putString(android.media.MediaMetadata.METADATA_KEY_ART_URI, currentAlbumArt);
                metaBuilder.putString(android.media.MediaMetadata.METADATA_KEY_ALBUM_ART_URI, currentAlbumArt);
            }
            mediaSession.setMetadata(metaBuilder.build());
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] updateMediaSessionMetadata failed: " + e.getMessage());
        }
    }

    // -----------------------------------------------------------------------
    // Audio focus — one listener, all interruption types. Auto-resume happens
    // ONLY when the pre-interruption state says playback should resume.
    // -----------------------------------------------------------------------
    private AudioManager.OnAudioFocusChangeListener createFocusListener() {
        return focusChange -> {
            switch (focusChange) {
                case AudioManager.AUDIOFOCUS_LOSS:
                    // Permanent loss (another media app took over) — pause, never auto-resume.
                    resumeOnFocusGain = false;
                    pausePlayback();
                    BackgroundAudioPlugin.notifyMediaAction("pause", -1);
                    break;
                case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                    // Transient loss (phone call, navigation prompt) — resume
                    // afterwards only if we were actually playing.
                    resumeOnFocusGain = mediaPlayer != null && mediaPlayer.isPlaying();
                    pausePlayback();
                    BackgroundAudioPlugin.notifyMediaAction("pause", -1);
                    break;
                case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                    isDucking = true;
                    applyVolume();
                    break;
                case AudioManager.AUDIOFOCUS_GAIN:
                    if (isDucking) {
                        isDucking = false;
                        applyVolume();
                    }
                    if (resumeOnFocusGain) {
                        resumeOnFocusGain = false;
                        resumePlayback();
                        BackgroundAudioPlugin.notifyMediaAction("play", -1);
                    }
                    break;
            }
        };
    }

    private void requestAudioFocus() {
        if (audioManager == null) return;
        try {
            if (focusListener == null) {
                focusListener = createFocusListener();
            }
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setOnAudioFocusChangeListener(focusListener)
                    .build();
                audioManager.requestAudioFocus(audioFocusRequest);
            } else {
                audioManager.requestAudioFocus(
                    focusListener,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
                );
            }
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] requestAudioFocus failed: " + e.getMessage());
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        try {
            if (audioFocusRequest != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
            } else {
                audioManager.abandonAudioFocus(focusListener);
            }
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] abandonAudioFocus failed: " + e.getMessage());
        }
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MusicApp::Playback");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire();
            }
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] acquireWakeLock failed: " + e.getMessage());
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
            wakeLock = null;
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] releaseWakeLock failed: " + e.getMessage());
        }
    }
private void registerHeadsetReceiver() {
        try {
            headsetReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    // Route changes only ever PAUSE — never blindly resume when
                    // a headset/Bluetooth device connects.
                    String action = intent.getAction();
                    if (ACTION_HEADSET_PLUG.equals(action)) {
                        int state = intent.getIntExtra("state", -1);
                        if (state == 0) {
                            dispatchMediaAction(ACTION_PAUSE, -1);
                        }
                    } else if (ACTION_BT_A2DP_STATE.equals(action) || ACTION_BT_HEADSET_STATE.equals(action)) {
                        // Bluetooth audio path (streaming / headset profile)
                        // disconnected — pause so audio never jumps to the
                        // phone speaker unexpectedly.
                        int state = intent.getIntExtra(EXTRA_BT_PROFILE_STATE, -1);
                        if (state == 0 /* BluetoothProfile.STATE_DISCONNECTED */) {
                            dispatchMediaAction(ACTION_PAUSE, -1);
                        }
                    } else if ("android.bluetooth.adapter.action.CONNECTION_STATE_CHANGED".equals(action)) {
                        int state = intent.getIntExtra("android.bluetooth.adapter.extra.CONNECTION_STATE", -1);
                        if (state == 0) {
                            dispatchMediaAction(ACTION_PAUSE, -1);
                        }
                    }
                }
            };

            IntentFilter filter = new IntentFilter();
            filter.addAction(ACTION_HEADSET_PLUG);
            filter.addAction(ACTION_BT_A2DP_STATE);
            filter.addAction(ACTION_BT_HEADSET_STATE);
            filter.addAction("android.bluetooth.adapter.action.CONNECTION_STATE_CHANGED");
            // MUST be RECEIVER_EXPORTED: these are system broadcasts and
            // on API 33+ a NOT_EXPORTED receiver never receives them — which
            // would silently disable pause-on-unplug for wired headsets and
            // Bluetooth disconnects.
            androidx.core.content.ContextCompat.registerReceiver(this, headsetReceiver, filter, ContextCompat.RECEIVER_EXPORTED);
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] registerHeadsetReceiver failed: " + e.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            String action = intent != null ? intent.getAction() : null;

            // Play request that may arrive while the service is not running —
            // start foreground AND begin playback from a single intent.
            if (ACTION_PLAY_URL.equals(action)) {
                String url = intent.getStringExtra("audioUrl");
                currentTitle = intent.getStringExtra("title") != null ? intent.getStringExtra("title") : "MusicApp";
                currentArtist = intent.getStringExtra("artist") != null ? intent.getStringExtra("artist") : "Playing music";
                currentAlbum = intent.getStringExtra("album") != null ? intent.getStringExtra("album") : "MusicApp Album";
                String art = intent.getStringExtra("albumArt");
                if (art != null && !art.equals(currentAlbumArt)) {
                    currentAlbumArt = art;
                    artworkBitmap = null;
                    loadArtworkAsync(art);
                }
                long startPos = intent.getLongExtra("startPositionMs", 0);
                userVolume = intent.getFloatExtra("volume", 1.0f);
                updateMediaSessionMetadata();
                acquireWakeLock();
                startKeepAlive();
                startForeground(NOTIFICATION_ID, buildNotification(currentTitle, currentArtist, currentAlbum));
                if (url != null && !url.isEmpty()) {
                    playAudioUrl(url, startPos);
                }
                return START_STICKY;
            }

            if (action != null) {
                // Transport action from the notification / headset / session.
                // Ensure foreground even when cold-started by this intent, so
                // the control works while the Activity is not running.
                acquireWakeLock();
                startKeepAlive();
                startForeground(NOTIFICATION_ID, buildNotification(currentTitle, currentArtist, currentAlbum));
                dispatchMediaAction(action, intent.getLongExtra("position", -1));
                rebuildNotification();
                return START_STICKY;
            }

            // Always ensure wake lock and keepalive are running — even on
            // service restart with null intent (system killed + restarted us).
            acquireWakeLock();
            startKeepAlive();

            if (intent == null) {
                // Service was recreated by the OS after being killed (START_STICKY).
                // The MediaPlayer is gone — rebuild the session from the persisted
                // snapshot so playback survives service recreation, otherwise the
                // user gets a dead notification and silence.
                SharedPreferences p = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                String savedUrl = p.getString(KEY_URL, null);
                boolean wasPlaying = p.getBoolean(KEY_WAS_PLAYING, false);
                if (wasPlaying && savedUrl != null && !savedUrl.isEmpty()) {
                    currentTitle = p.getString(KEY_TITLE, currentTitle);
                    currentArtist = p.getString(KEY_ARTIST, currentArtist);
                    currentAlbum = p.getString(KEY_ALBUM, currentAlbum);
                    String savedArt = p.getString(KEY_ALBUM_ART, null);
                    if (savedArt != null && !savedArt.equals(currentAlbumArt)) {
                        currentAlbumArt = savedArt;
                        artworkBitmap = null;
                        loadArtworkAsync(savedArt);
                    }
                    long savedPos = p.getLong(KEY_POSITION_MS, 0);
                    updateMediaSessionMetadata();
                    startForeground(NOTIFICATION_ID, buildNotification(currentTitle, currentArtist, currentAlbum));
                    Log.i("MusicForegroundService", "Service recreated by OS — resuming from snapshot");
                    playAudioUrl(savedUrl, savedPos);
                } else {
                    rebuildNotification();
                }
                return START_STICKY;
            }

            String title = "MusicApp";
            String artist = "Playing music";
            String album = "MusicApp Album";
            if (intent != null) {
                // Missing extras must KEEP the current metadata — a bare
                // startService call must never reset album/art to defaults.
                title = intent.getStringExtra("title") != null ? intent.getStringExtra("title") : title;
                artist = intent.getStringExtra("artist") != null ? intent.getStringExtra("artist") : artist;
                album = intent.getStringExtra("album") != null ? intent.getStringExtra("album") : currentAlbum;
            }

            currentTitle = title;
            currentArtist = artist;
            currentAlbum = album;

            updateMediaSessionMetadata();
            Notification notification = buildNotification(title, artist, album);
            startForeground(NOTIFICATION_ID, notification);
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] onStartCommand failed: " + e.getMessage());
        }
        return START_STICKY;
    }

    private void startKeepAlive() {
        try {
            BackgroundAudioPlugin plugin = BackgroundAudioPlugin.getInstance();
            if (plugin != null) {
                plugin.startKeepAlive();
            }
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] Failed to start keepalive: " + e.getMessage());
        }
    }

    private Notification buildNotification(String title, String artist, String album) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        notificationIntent.putExtra("navigate_to", "player");
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_CANCEL_CURRENT);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        // Previous button — getService delivers the action to onStartCommand
        // (an explicit getBroadcast to a Service class is never delivered).
        PendingIntent prevPI = PendingIntent.getService(this, 1,
            new Intent(this, MusicForegroundService.class).setAction(ACTION_PREVIOUS),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        builder.addAction(android.R.drawable.ic_media_previous, "Previous", prevPI);

        // Play/Pause toggle button
        if (isPlaying) {
            PendingIntent pausePI = PendingIntent.getService(this, 2,
                new Intent(this, MusicForegroundService.class).setAction(ACTION_PAUSE),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            builder.addAction(android.R.drawable.ic_media_pause, "Pause", pausePI);
        } else {
            PendingIntent playPI = PendingIntent.getService(this, 2,
                new Intent(this, MusicForegroundService.class).setAction(ACTION_PLAY),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            builder.addAction(android.R.drawable.ic_media_play, "Play", playPI);
        }

        // Next button
        PendingIntent nextPI = PendingIntent.getService(this, 3,
            new Intent(this, MusicForegroundService.class).setAction(ACTION_NEXT),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        builder.addAction(android.R.drawable.ic_media_next, "Next", nextPI);

        builder
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText(album)
            .setSmallIcon(android.R.drawable.ic_media_play);
        if (artworkBitmap != null) {
            builder.setLargeIcon(artworkBitmap);
        }

        builder
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setPriority(Notification.PRIORITY_LOW)
            .setCategory(Notification.CATEGORY_TRANSPORT);

        // Attach MediaSession token via MediaStyle so the system shows proper
        // transport controls on the lock screen and notification shade
        if (mediaSession != null) {
            try {
                builder.setStyle(new Notification.MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2));
            } catch (Exception e) {
                System.err.println("[MusicForegroundService] setMediaStyle failed: " + e.getMessage());
            }
        }

        return builder.build();
    }

    /**
     * Duplicate/rapid-repeat media-button guard. Pure logic (clock injected)
     * so it is unit-testable without an Android context.
     *
     * Returns true when the SAME action+position arrives again inside the
     * debounce window — e.g. a Bluetooth double-tap, or a notification tap
     * racing the MediaSession callback for the same physical press. The
     * window also resets on duplicates, so a held-down/stuck button cannot
     * machine-gun the queue.
     */
    boolean isDuplicateMediaAction(String action, long position, long nowMs) {
        if (action == null) return true;
        boolean dup = action.equals(lastMediaAction)
                && position == lastMediaActionPosition
                && (nowMs - lastMediaActionAt) < MEDIA_ACTION_DEBOUNCE_MS;
        lastMediaAction = action;
        lastMediaActionPosition = position;
        lastMediaActionAt = nowMs;
        return dup;
    }

    private void dispatchMediaAction(String action, long position) {
        if (instance == null) return;

        // Single serialized command path: every transport source (MediaSession,
        // notification, headset receiver, focus listener) funnels through here.
        // 1) Duplicate / rapid-repeat suppression.
        if (isDuplicateMediaAction(action, position, android.os.SystemClock.uptimeMillis())) {
            Log.i("MusicForegroundService", "Duplicate media action dropped: " + action);
            return;
        }
        // 2) State-based redundancy guards — only when the native engine owns
        //    playback. A play that is already playing (or a pause that is
        //    already paused) is a no-op; dropping it keeps a duplicated button
        //    event from re-notifying JS / rebuilding the notification.
        //    (While buffering a pause is still meaningful: it cancels the
        //    auto-start — hence the !isBuffering condition.)
        if (nativeEngineActive && isPrepared && !isBuffering) {
            if (ACTION_PLAY.equals(action) && isPlaying) return;
            if (ACTION_PAUSE.equals(action) && !isPlaying) return;
        }

        if (ACTION_PLAY.equals(action)) {
            resumePlayback();
            BackgroundAudioPlugin.notifyMediaAction("play", position);
            return;
        } else if (ACTION_PAUSE.equals(action)) {
            pausePlayback();
            BackgroundAudioPlugin.notifyMediaAction("pause", position);
            return;
        } else if (ACTION_STOP.equals(action)) {
            stopPlayback();
            BackgroundAudioPlugin.notifyMediaAction("stop", position);
            return;
        } else if (ACTION_NEXT.equals(action)) {
            BackgroundAudioPlugin.notifyMediaAction("next", position);
            return;
        } else if (ACTION_PREVIOUS.equals(action)) {
            BackgroundAudioPlugin.notifyMediaAction("previous", position);
            return;
        } else if ("seek".equals(action)) {
            if (position >= 0) {
                seekToPosition(position);
            }
            BackgroundAudioPlugin.notifyMediaAction("seek", position);
            return;
        }
    }

    public void updatePlaybackState(boolean isPlaying, long positionSec, long durationSec) {
        // Harvest the JS-pushed position/duration in EVERY mode — they back
        // the MediaSession state/metadata when the WebView engine owns
        // playback (the native player has no position then).
        this.lastKnownPositionMs = Math.max(0, positionSec * 1000);
        if (durationSec > 0) this.duration = durationSec;
        if (nativeEngineActive) {
            // The native MediaPlayer owns playback state — JS-pushed state is
            // ignored so a stale WebView state can never fight the native
            // state machine (e.g. re-showing PLAYING after a focus pause).
            // The position IS harvested though: JS pushes progress every
            // second, keeping the crash-recovery snapshot near-current.
            if (currentUrl != null && positionSec > 0) {
                persistSnapshot(this.isPlaying, positionSec * 1000);
            }
            return;
        }
        this.isPlaying = isPlaying;
        // Sync native MediaPlayer state if JS is controlling playback
        if (mediaPlayer != null && isPrepared) {
            if (isPlaying && !mediaPlayer.isPlaying()) {
                resumePlayback();
            } else if (!isPlaying && mediaPlayer.isPlaying()) {
                pausePlayback();
            }
        }
        updateMediaSessionState();
        rebuildNotification();
    }

    public void updateNotification(String title, String artist, String album, String albumArt) {
        if (notificationManager == null) return;
        currentTitle = title;
        currentArtist = artist;
        currentAlbum = album;
        if (albumArt != null && !albumArt.equals(currentAlbumArt)) {
            currentAlbumArt = albumArt;
            artworkBitmap = null;
            loadArtworkAsync(albumArt);
        }
        updateMediaSessionMetadata();
        rebuildNotification();
    }

    /** Downloads album artwork off the UI thread; rebuilds the notification
     *  once available. Cached per URL — no-op if the art already changed. */
    private void loadArtworkAsync(final String url) {
        if (url == null || !url.startsWith("http")) return;
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                InputStream in = conn.getInputStream();
                Bitmap bmp = BitmapFactory.decodeStream(in);
                in.close();
                if (bmp != null && url.equals(currentAlbumArt)) {
                    artworkBitmap = bmp;
                    new Handler(Looper.getMainLooper()).post(this::rebuildNotification);
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    public void updateNotification(String title, String artist, String album) {
        updateNotification(title, artist, album, null);
    }

    public void updateNotification(String title, String artist) {
        updateNotification(title, artist, "MusicApp Album", null);
    }

    public void rebuildNotification() {
        if (notificationManager == null) return;
        try {
            Notification notification = buildNotification(currentTitle, currentArtist, currentAlbum);
            notificationManager.notify(NOTIFICATION_ID, notification);
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] rebuildNotification failed: " + e.getMessage());
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The user explicitly dismissed the task — stop playback cleanly so
        // audio never becomes a headless zombie with no controlling UI.
        // (Minimizing / locking / screen-off never triggers this callback.)
        stopPlayback();
        clearSnapshot();
        instance = null;
        BackgroundAudioPlugin.stopKeepAlive();
        if (mediaSession != null) {
            try { mediaSession.setActive(false); } catch (Exception ignored) {}
            try { mediaSession.release(); } catch (Exception ignored) {}
            mediaSession = null;
        }
        if (headsetReceiver != null) {
            try { unregisterReceiver(headsetReceiver); } catch (Exception ignored) {}
            headsetReceiver = null;
        }
        abandonAudioFocus();
        releaseWakeLock();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        BackgroundAudioPlugin.stopKeepAlive();
        cancelPrepareTimeout();
        if (mediaPlayer != null) {
            try {
                mediaPlayer.stop();
                mediaPlayer.release();
            } catch (Exception ignored) {}
            mediaPlayer = null;
        }
        if (mediaSession != null) {
            try { mediaSession.setActive(false); } catch (Exception ignored) {}
            try { mediaSession.release(); } catch (Exception ignored) {}
            mediaSession = null;
        }
        if (headsetReceiver != null) {
            try { unregisterReceiver(headsetReceiver); } catch (Exception ignored) {}
            headsetReceiver = null;
        }
        abandonAudioFocus();
        releaseWakeLock();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        super.onDestroy();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Music Playback",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows currently playing music");
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }
}

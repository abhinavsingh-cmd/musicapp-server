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
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

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

    public static MusicForegroundService instance;

    // Native MediaPlayer for actual audio playback (survives WebView lifecycle)
    private MediaPlayer mediaPlayer;
    private String pendingAudioUrl;
    private boolean isPrepared = false;
    private boolean isBuffering = false;

    private NotificationManager notificationManager;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private PowerManager.WakeLock wakeLock;
    private BroadcastReceiver headsetReceiver;
    private BroadcastReceiver notificationActionReceiver;
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
            registerNotificationActionReceiver();
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
        if (mediaPlayer == null) return;
        try {
            pendingAudioUrl = audioUrl;
            isPrepared = false;
            isBuffering = true;
            updateNativePlaybackState(PlaybackState.STATE_BUFFERING);

            mediaPlayer.reset();
            mediaPlayer.setDataSource(this, Uri.parse(audioUrl));
            mediaPlayer.prepareAsync();
            Log.i("MusicForegroundService", "Preparing native MediaPlayer for: " + audioUrl);
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] playAudioUrl failed: " + e.getMessage());
            isBuffering = false;
            updateNativePlaybackState(PlaybackState.STATE_ERROR);
        }
    }

    public void pausePlayback() {
        if (mediaPlayer != null && mediaPlayer.isPlaying()) {
            mediaPlayer.pause();
            isPlaying = false;
            updateNativePlaybackState(PlaybackState.STATE_PAUSED);
            Log.i("MusicForegroundService", "Native playback paused");
        }
    }

    public void resumePlayback() {
        if (mediaPlayer != null && !mediaPlayer.isPlaying() && isPrepared) {
            mediaPlayer.start();
            isPlaying = true;
            updateNativePlaybackState(PlaybackState.STATE_PLAYING);
            Log.i("MusicForegroundService", "Native playback resumed");
        }
    }

    public void stopPlayback() {
        if (mediaPlayer != null) {
            mediaPlayer.stop();
            mediaPlayer.reset();
            isPlaying = false;
            isPrepared = false;
            isBuffering = false;
            pendingAudioUrl = null;
            updateNativePlaybackState(PlaybackState.STATE_STOPPED);
            Log.i("MusicForegroundService", "Native playback stopped");
        }
        abandonAudioFocus();
    }

    public void seekToPosition(long position) {
        if (mediaPlayer != null && isPrepared) {
            try {
                mediaPlayer.seekTo((int) position);
                Log.i("MusicForegroundService", "Native seek to: " + position);
            } catch (Exception e) {
                System.err.println("[MusicForegroundService] seekToPosition failed: " + e.getMessage());
            }
        }
    }

    public void setVolume(float volume) {
        if (mediaPlayer != null) {
            mediaPlayer.setVolume(volume, volume);
        }
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
        isPrepared = true;
        isBuffering = false;
        if (pendingAudioUrl != null) {
            mp.start();
            isPlaying = true;
            updateNativePlaybackState(PlaybackState.STATE_PLAYING);
            Log.i("MusicForegroundService", "Native MediaPlayer prepared and started");
        }
    }

    @Override
    public void onCompletion(MediaPlayer mp) {
        isPlaying = false;
        isPrepared = false;
        pendingAudioUrl = null;
        updateNativePlaybackState(PlaybackState.STATE_STOPPED);
        // Notify JS layer to handle next song
        BackgroundAudioPlugin.notifyMediaAction("ended", -1);
        Log.i("MusicForegroundService", "Native MediaPlayer completed");
    }

    @Override
    public boolean onError(MediaPlayer mp, int what, int extra) {
        System.err.println("[MusicForegroundService] Native MediaPlayer error: what=" + what + ", extra=" + extra);
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
                .setState(state, 0, 1.0f);
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
            mediaSession.setMetadata(metaBuilder.build());
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] updateMediaSessionMetadata failed: " + e.getMessage());
        }
    }

    // -----------------------------------------------------------------------
    // Notification action button receiver — handles play/pause/next/prev taps
    // from the notification shade and lock screen.
    // -----------------------------------------------------------------------
    private void registerNotificationActionReceiver() {
        try {
            notificationActionReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    String action = intent.getAction();
                    if (action != null) {
                        dispatchMediaAction(action, -1);
                    }
                }
            };
            IntentFilter filter = new IntentFilter();
            filter.addAction(ACTION_PLAY);
            filter.addAction(ACTION_PAUSE);
            filter.addAction(ACTION_NEXT);
            filter.addAction(ACTION_PREVIOUS);
            filter.addAction(ACTION_STOP);
            // Use ContextCompat for proper receiver flag handling on all API levels
            androidx.core.content.ContextCompat.registerReceiver(this, notificationActionReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] registerNotificationActionReceiver failed: " + e.getMessage());
        }
    }

    private void requestAudioFocus() {
        if (audioManager == null) return;
        try {
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .build();
                audioManager.requestAudioFocus(audioFocusRequest);
            } else {
                audioManager.requestAudioFocus(
                    focusChange -> {
                        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                            dispatchMediaAction(ACTION_STOP, -1);
                        }
                    },
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
                audioManager.abandonAudioFocus(null);
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
                    if (ACTION_HEADSET_PLUG.equals(intent.getAction())) {
                        int state = intent.getIntExtra("state", -1);
                        if (state == 1) {
                            dispatchMediaAction(ACTION_PLAY, -1);
                        } else if (state == 0) {
                            dispatchMediaAction(ACTION_PAUSE, -1);
                        }
                    } else if ("android.bluetooth.adapter.action.CONNECTION_STATE_CHANGED".equals(intent.getAction())) {
                        int state = intent.getIntExtra("android.bluetooth.adapter.extra.CONNECTION_STATE", -1);
                        if (state == 2) {
                            dispatchMediaAction(ACTION_PLAY, -1);
                        } else if (state == 0) {
                            dispatchMediaAction(ACTION_PAUSE, -1);
                        }
                    }
                }
            };

            IntentFilter filter = new IntentFilter();
            filter.addAction(ACTION_HEADSET_PLUG);
            filter.addAction("android.bluetooth.adapter.action.CONNECTION_STATE_CHANGED");
            // Use ContextCompat for proper receiver flag handling on all API levels
            androidx.core.content.ContextCompat.registerReceiver(this, headsetReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] registerHeadsetReceiver failed: " + e.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            String action = intent != null ? intent.getAction() : null;
            if (action != null) {
                dispatchMediaAction(action, intent.getLongExtra("position", -1));
                return START_STICKY;
            }

            // Always ensure wake lock and keepalive are running — even on
            // service restart with null intent (system killed + restarted us).
            acquireWakeLock();
            startKeepAlive();

            if (intent == null && instance != null) {
                // Service was restarted by the OS — rebuild notification with
                // the last known metadata and return early.
                rebuildNotification();
                return START_STICKY;
            }

            String title = "MusicApp";
            String artist = "Playing music";
            String album = "MusicApp Album";
            if (intent != null) {
                title = intent.getStringExtra("title") != null ? intent.getStringExtra("title") : "MusicApp";
                artist = intent.getStringExtra("artist") != null ? intent.getStringExtra("artist") : "Playing music";
                album = intent.getStringExtra("album") != null ? intent.getStringExtra("album") : "MusicApp Album";
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

        // Previous button
        PendingIntent prevPI = PendingIntent.getBroadcast(this, 1,
            new Intent(this, MusicForegroundService.class).setAction(ACTION_PREVIOUS),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        builder.addAction(android.R.drawable.ic_media_previous, "Previous", prevPI);

        // Play/Pause toggle button
        if (isPlaying) {
            PendingIntent pausePI = PendingIntent.getBroadcast(this, 2,
                new Intent(this, MusicForegroundService.class).setAction(ACTION_PAUSE),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            builder.addAction(android.R.drawable.ic_media_pause, "Pause", pausePI);
        } else {
            PendingIntent playPI = PendingIntent.getBroadcast(this, 2,
                new Intent(this, MusicForegroundService.class).setAction(ACTION_PLAY),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            builder.addAction(android.R.drawable.ic_media_play, "Play", playPI);
        }

        // Next button
        PendingIntent nextPI = PendingIntent.getBroadcast(this, 3,
            new Intent(this, MusicForegroundService.class).setAction(ACTION_NEXT),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        builder.addAction(android.R.drawable.ic_media_next, "Next", nextPI);

        builder
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText(album)
            .setSmallIcon(android.R.drawable.ic_media_play)
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

    private void dispatchMediaAction(String action, long position) {
        if (instance == null) return;

        // Handle native MediaPlayer playback commands
        if (ACTION_PLAY.equals(action)) {
            if (pendingAudioUrl != null && !isPrepared) {
                // First play - the audio URL was already set via playAudioUrl
                resumePlayback();
            } else if (!isPlaying && isPrepared) {
                resumePlayback();
            }
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

        String eventAction;
        if (ACTION_PLAY.equals(action)) {
            eventAction = "play";
        } else if (ACTION_PAUSE.equals(action)) {
            eventAction = "pause";
        } else if (ACTION_NEXT.equals(action)) {
            eventAction = "next";
        } else if (ACTION_PREVIOUS.equals(action)) {
            eventAction = "previous";
        } else if (ACTION_STOP.equals(action)) {
            eventAction = "stop";
        } else {
            eventAction = "seek";
        }
        BackgroundAudioPlugin.notifyMediaAction(eventAction, position);
    }

    public void updatePlaybackState(boolean isPlaying, long position, long duration) {
        this.isPlaying = isPlaying;
        this.duration = duration;
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
        updateMediaSessionMetadata();
        rebuildNotification();
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
        if (notificationActionReceiver != null) {
            try { unregisterReceiver(notificationActionReceiver); } catch (Exception ignored) {}
            notificationActionReceiver = null;
        }
        abandonAudioFocus();
        releaseWakeLock();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        BackgroundAudioPlugin.stopKeepAlive();
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
        if (notificationActionReceiver != null) {
            try { unregisterReceiver(notificationActionReceiver); } catch (Exception ignored) {}
            notificationActionReceiver = null;
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

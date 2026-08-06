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
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.ResultReceiver;
import android.os.VibrationEffect;
import android.os.Vibrator;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

    public class MusicForegroundService extends Service {
        private static final String CHANNEL_ID = "music_playback";
        private static final int NOTIFICATION_ID = 1;
        private static final String ACTION_PLAY = "com.abhinav.musicapp.action.PLAY";
        private static final String ACTION_PAUSE = "com.abhinav.musicapp.action.PAUSE";
        private static final String ACTION_NEXT = "com.abhinav.musicapp.action.NEXT";
        private static final String ACTION_PREVIOUS = "com.abhinav.musicapp.action.PREVIOUS";
        private static final String ACTION_STOP = "com.abhinav.musicapp.action.STOP";
        private static final String ACTION_HEADSET_PLUG = "android.intent.action.HEADSET_PLUG";
        private static final String ACTION_BATTERY_LOW = "android.intent.action.BATTERY_LOW";
        private static final String ACTION_SCREEN_OFF = "android.intent.action.SCREEN_OFF";
        private static final String ACTION_USER_PRESENT = "android.intent.action.USER_PRESENT";

        public static MusicForegroundService instance;

        private MediaSession mediaSession;
        private NotificationManager notificationManager;
        private PowerManager.WakeLock wakeLock;
        private AudioManager audioManager;
        private AudioFocusRequest audioFocusRequest;
        private BroadcastReceiver headsetPlugReceiver;
        private String currentTitle = "MusicApp";
        private String currentArtist = "Playing music";
        private String currentAlbum = "MusicApp Album";
        private boolean isPlaying = false;
        private boolean hasHeadphonesConnected = false;
        private long duration = 0;
        private Bitmap albumArtBitmap = null;
        private String lastAlbumArtUrl = null;
        private int streamVolume = 0;

        @Override
        public void onCreate() {
            super.onCreate();
            instance = this;
            notificationManager = getSystemService(NotificationManager.class);
            audioManager = getSystemService(AudioManager.class);
            createNotificationChannel();
            initMediaSession();
            registerBroadcastReceivers();
            requestAudioFocus();
        }

        private void initMediaSession() {
            mediaSession = new MediaSession(this, "MusicAppSession");
            mediaSession.setActive(true);
            mediaSession.setFlags(
                MediaSession.FLAG_HANDLES_MEDIA_BUTTONS |
                MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS |
                MediaSession.FLAG_HANDLES_QUEUE_COMMANDS
            );
            mediaSession.setCallback(new MediaSession.Callback() {
                @Override
                public void onPlay() {
                    dispatchMediaAction(ACTION_PLAY, -1);
                }

                @Override
                public void onPause() {
                    dispatchMediaAction(ACTION_PAUSE, -1);
                }

                @Override
                public void onPlayPause() {
                    if (isPlaying) {
                        dispatchMediaAction(ACTION_PAUSE, -1);
                    } else {
                        dispatchMediaAction(ACTION_PLAY, -1);
                    }
                }

                @Override
                public void onSkipToNext() {
                    dispatchMediaAction(ACTION_NEXT, -1);
                }

                @Override
                public void onSkipToPrevious() {
                    dispatchMediaAction(ACTION_PREVIOUS, -1);
                }

                @Override
                public void onSeekTo(long position) {
                    dispatchMediaAction("seek", position);
                }

                @Override
                public void onStop() {
                    dispatchMediaAction(ACTION_STOP, -1);
                }

                @Override
                public void onCommand(String command, Bundle extras, ResultReceiver cb) {
                    if ("android.intent.action.HEADSET_PLUG".equals(command)) {
                        boolean connected = extras != null && extras.getBoolean("state");
                        if (hasHeadphonesConnected != connected) {
                            hasHeadphonesConnected = connected;
                            if (hasHeadphonesConnected) {
                                dispatchMediaAction(ACTION_PLAY, -1);
                            } else {
                                dispatchMediaAction(ACTION_PAUSE, -1);
                            }
                        }
                    }
                    super.onCommand(command, extras, cb);
                }
            });
            
            mediaSession.setSessionActivity(
                PendingIntent.getActivity(
                    this, 
                    0, 
                    new Intent(this, MainActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                )
            );
        }

        private void registerBroadcastReceivers() {
            headsetPlugReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    String action = intent.getAction();
                    if (ACTION_HEADSET_PLUG.equals(action)) {
                        boolean connected = intent.getIntExtra("state", -1) == 1;
                        boolean hasMicrophone = intent.getIntExtra("microphone", 0) == 1;
                        if (hasHeadphonesConnected != connected) {
                            hasHeadphonesConnected = connected;
                            if (hasHeadphonesConnected) {
                                dispatchMediaAction(ACTION_PLAY, -1);
                            } else {
                                dispatchMediaAction(ACTION_PAUSE, -1);
                            }
                        }
                    } else if (ACTION_SCREEN_OFF.equals(action)) {
                        // Screen turned off - keep playback going
                        acquireWakeLock();
                    } else if (ACTION_USER_PRESENT.equals(action)) {
                        // Screen turned on - reduce wake lock usage
                        releaseWakeLock();
                    } else if ("android.bluetooth.adapter.action.CONNECTION_STATE_CHANGED".equals(action)) {
                        // Bluetooth headset connected/disconnected
                        int state = intent.getIntExtra("android.bluetooth.adapter.extra.CONNECTION_STATE", -1);
                        if (state == 2) { // STATE_CONNECTED
                            dispatchMediaAction(ACTION_PLAY, -1);
                        } else if (state == 0) { // STATE_DISCONNECTED
                            dispatchMediaAction(ACTION_PAUSE, -1);
                        }
                    } else if ("android.intent.action.MEDIA_BUTTON".equals(action)) {
                        // Car mode / Bluetooth media button
                        dispatchMediaAction(ACTION_PLAY, -1);
                    }
                }
            };

            IntentFilter filter = new IntentFilter();
            filter.addAction(ACTION_HEADSET_PLUG);
            filter.addAction(ACTION_SCREEN_OFF);
            filter.addAction(ACTION_USER_PRESENT);
            filter.addAction("android.bluetooth.adapter.action.CONNECTION_STATE_CHANGED");
            filter.addAction("android.intent.action.MEDIA_BUTTON");
            
            registerReceiver(headsetPlugReceiver, filter);
        }

        private void requestAudioFocus() {
            if (audioManager == null) return;
            
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();
                
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioFocusRequest.Builder builder = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(audioAttributes)
                    .setReceivers(AudioFocusRequest.RECEIVER_SWITCH)
                    .setWillPauseWhenDucked(true);
                audioFocusRequest = builder.build();
                int result = audioManager.requestAudioFocus(audioFocusRequest);
            } else {
                int result = audioManager.requestAudioFocus(
                    new AudioManager.OnAudioFocusChangeListener() {
                        @Override
                        public void onAudioFocusChange(int focusChange) {
                            if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT || 
                                focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                                // Pause playback
                                dispatchMediaAction(ACTION_PAUSE, -1);
                            } else if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
                                // Resume playback
                                dispatchMediaAction(ACTION_PLAY, -1);
                            } else if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                                // Stop playback
                                dispatchMediaAction(ACTION_STOP, -1);
                            }
                        }
                    }, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN
                );
            }
        }

        private void abandonAudioFocus() {
            if (audioFocusRequest != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
            } else {
                audioManager.abandonAudioFocus(null);
            }
        }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            return;
        }
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MusicApp::PlaybackLock");
            wakeLock.acquire();
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (action != null) {
            dispatchMediaAction(action, intent.getLongExtra("position", -1));
            return START_STICKY;
        }

        // Service recreated by OS (START_STICKY) — re-acquire audio focus,
        // show notification, and notify JS so it can resume playback.
        if (intent == null && instance != null) {
            // Already running — just re-acquire focus and rebuild notification.
            requestAudioFocus();
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

        // Update MediaSession metadata
        updateMediaSessionMetadata(title, artist);

        Notification notification = buildNotification(title, artist, album);
        startForeground(NOTIFICATION_ID, notification);

        // Notify JS that the service started so it can resume if needed.
        BackgroundAudioPlugin.notifyMediaAction("play", -1);

        return START_STICKY;
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

        Notification.Builder nb = builder
                .setContentTitle(title)
                .setContentText(artist)
                .setSubText(album)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setLargeIcon(albumArtBitmap != null ? albumArtBitmap : getAlbumArtIcon(artist))
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setPriority(Notification.PRIORITY_MAX)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setDefaults(Notification.DEFAULT_ALL)
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis());

        // Play/Pause action with proper icon
        int playPauseIcon = isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        String playPauseLabel = isPlaying ? "Pause" : "Play";
        String playPauseAction = isPlaying ? ACTION_PAUSE : ACTION_PLAY;
        
        Notification.Action playPauseActionNotif = new Notification.Action.Builder(
            playPauseIcon, 
            playPauseLabel, 
            mediaActionIntent(playPauseAction, 2)
        ).build();
        nb.addAction(playPauseActionNotif);

        // Previous action
        Notification.Action previousAction = new Notification.Action.Builder(
            android.R.drawable.ic_media_previous, 
            "Previous", 
            mediaActionIntent(ACTION_PREVIOUS, 1)
        ).build();
        nb.addAction(previousAction);

        // Next action
        Notification.Action nextAction = new Notification.Action.Builder(
            android.R.drawable.ic_media_next, 
            "Next", 
            mediaActionIntent(ACTION_NEXT, 3)
        ).build();
        nb.addAction(nextAction);

        // Stop action for lock screen control
        Notification.Action stopAction = new Notification.Action.Builder(
            android.R.drawable.ic_menu_close_clear_cancel, 
            "Stop", 
            mediaActionIntent(ACTION_STOP, 4)
        ).build();
        nb.addAction(stopAction);

        // Add MediaStyle on API 21+ for lock screen controls with full UI
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Notification.MediaStyle mediaStyle = new Notification.MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2);
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                mediaStyle.setShowCustomActions(false);
                mediaStyle.setShowSeekingControls(true);
            }
            
            nb.setStyle(mediaStyle);
        }

        // Add Bluetooth-specific intent
        Intent bluetoothIntent = new Intent(this, MainActivity.class);
        bluetoothIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        bluetoothIntent.putExtra("bluetooth_action", "play");
        PendingIntent bluetoothPendingIntent = PendingIntent.getActivity(this, 1, bluetoothIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        
        nb.setContentIntent(bluetoothPendingIntent);

        return nb.build();
    }

    private android.graphics.Bitmap getAlbumArtIcon(String artist) {
        try {
            // Try to load album art from the artist/album
            return android.graphics.BitmapFactory.decodeResource(getResources(), 
                getResources().getIdentifier("drawable/album_art_" + artist.replaceAll(" ", "_").toLowerCase(), 
                    null, getPackageName()));
        } catch (Exception e) {
            return android.graphics.BitmapFactory.decodeResource(getResources(), android.R.drawable.ic_media_play);
        }
    }

    private PendingIntent mediaActionIntent(String action, int requestCode) {
        Intent intent = new Intent(this, MusicForegroundService.class);
        intent.setAction(action);
        intent.setPackage(getPackageName());
        return PendingIntent.getService(
                this,
                requestCode,
                intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    private void dispatchMediaAction(String action, long position) {
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

    private void updateMediaSessionMetadata(String title, String artist, String album, long duration) {
        if (mediaSession == null) return;
        MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder();
        metaBuilder.putString(MediaMetadata.METADATA_KEY_TITLE, title);
        metaBuilder.putString(MediaMetadata.METADATA_KEY_ARTIST, artist);
        metaBuilder.putString(MediaMetadata.METADATA_KEY_ALBUM, album);
        if (duration > 0) {
            metaBuilder.putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
        }
        mediaSession.setMetadata(metaBuilder.build());
    }

    private void updateMediaSessionMetadata(String title, String artist) {
        updateMediaSessionMetadata(title, artist, currentAlbum, duration);
    }

    public void updatePlaybackState(boolean isPlaying, long position, long duration) {
        if (mediaSession == null) return;
        boolean stateChanged = this.isPlaying != isPlaying;
        this.isPlaying = isPlaying;
        this.duration = duration;
        int state = isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        PlaybackState.Builder stateBuilder = new PlaybackState.Builder()
                .setActions(
                        PlaybackState.ACTION_PLAY |
                        PlaybackState.ACTION_PAUSE |
                        PlaybackState.ACTION_PLAY_PAUSE |
                        PlaybackState.ACTION_SKIP_TO_NEXT |
                        PlaybackState.ACTION_SKIP_TO_PREVIOUS |
                        PlaybackState.ACTION_SEEK_TO
                )
                .setState(state, position, isPlaying ? 1.0f : 0.0f)
                .setExtras(new Bundle());
        mediaSession.setPlaybackState(stateBuilder.build());
        if (isPlaying) {
            acquireWakeLock();
        } else {
            releaseWakeLock();
        }
        // Only rebuild the notification when the play/pause state flips or when
        // album art still needs loading — avoids PendingIntent churn every second.
        if (stateChanged || albumArtBitmap == null) {
            updateMediaSessionMetadata(currentTitle, currentArtist, currentAlbum, duration);
            rebuildNotification();
        }
    }

    public void updateNotification(String title, String artist, String album, String albumArt) {
        if (notificationManager == null) return;
        currentTitle = title;
        currentArtist = artist;
        currentAlbum = album;
        if (albumArt != null && !albumArt.isEmpty()) {
            loadAlbumArtAsync(albumArt);
        }
        updateMediaSessionMetadata(title, artist, album, duration);
        rebuildNotification();
    }

    public void updateNotification(String title, String artist, String album) {
        updateNotification(title, artist, album, null);
    }

    public void updateNotification(String title, String artist) {
        updateNotification(title, artist, "MusicApp Album", null);
    }

    private void rebuildNotification() {
        if (notificationManager == null) return;
        Notification notification = buildNotification(currentTitle, currentArtist, currentAlbum);
        notificationManager.notify(NOTIFICATION_ID, notification);
    }

    private void loadAlbumArtAsync(final String url) {
        if (url == null || url.equals(lastAlbumArtUrl)) return;
        lastAlbumArtUrl = url;
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.setDoInput(true);
                conn.connect();
                InputStream input = conn.getInputStream();
                final Bitmap bmp = BitmapFactory.decodeStream(input);
                input.close();
                if (bmp != null) {
                    final Bitmap scaled = scaleBitmap(bmp, 256);
                    new Handler(Looper.getMainLooper()).post(() -> {
                        albumArtBitmap = scaled;
                        rebuildNotification();
                    });
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private Bitmap scaleBitmap(Bitmap src, int maxSize) {
        int w = src.getWidth();
        int h = src.getHeight();
        if (w <= maxSize && h <= maxSize) return src;
        float ratio = Math.max((float) w / maxSize, (float) h / maxSize);
        int nw = Math.round(w / ratio);
        int nh = Math.round(h / ratio);
        return Bitmap.createScaledBitmap(src, nw, nh, true);
    }

    public MediaSession getMediaSession() {
        return mediaSession;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Keep the service alive when the task leaves recents. The foreground
        // notification remains the user's visible control surface, and Android
        // can restart this START_STICKY service if the process is reclaimed.
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
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
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}

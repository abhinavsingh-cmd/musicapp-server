package com.abhinav.musicapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import android.media.session.MediaSession;
import android.media.MediaMetadata;
import android.media.session.PlaybackState;

public class MusicForegroundService extends Service {
    private static final String CHANNEL_ID = "music_playback";
    private static final int NOTIFICATION_ID = 1;

    public static MusicForegroundService instance;

    private MediaSession mediaSession;
    private NotificationManager notificationManager;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
        notificationManager = getSystemService(NotificationManager.class);
        initMediaSession();
        acquireWakeLock();
    }

    private void initMediaSession() {
        mediaSession = new MediaSession(this, "MusicAppSession");
        mediaSession.setActive(true);
        mediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
    }

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MusicApp::PlaybackLock");
            wakeLock.acquire();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = "MusicApp";
        String artist = "Playing music";
        if (intent != null) {
            title = intent.getStringExtra("title") != null ? intent.getStringExtra("title") : "MusicApp";
            artist = intent.getStringExtra("artist") != null ? intent.getStringExtra("artist") : "Playing music";
        }

        // Update MediaSession metadata
        updateMediaSessionMetadata(title, artist);

        Notification notification = buildNotification(title, artist);
        startForeground(NOTIFICATION_ID, notification);

        return START_STICKY;
    }

    private Notification buildNotification(String title, String artist) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        Notification.Builder nb = builder
                .setContentTitle(title)
                .setContentText(artist)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC);

        // Add MediaStyle on API 21+ for lock screen controls
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            nb.setStyle(new Notification.MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2));
        }

        return nb.build();
    }

    private void updateMediaSessionMetadata(String title, String artist) {
        if (mediaSession == null) return;
        MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder();
        metaBuilder.putString(MediaMetadata.METADATA_KEY_TITLE, title);
        metaBuilder.putString(MediaMetadata.METADATA_KEY_ARTIST, artist);
        metaBuilder.putString(MediaMetadata.METADATA_KEY_ALBUM, "MusicApp");
        mediaSession.setMetadata(metaBuilder.build());
    }

    public void updatePlaybackState(boolean isPlaying, long position) {
        if (mediaSession == null) return;
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
                .setState(state, position, isPlaying ? 1.0f : 0.0f);
        mediaSession.setPlaybackState(stateBuilder.build());
    }

    public void updateNotification(String title, String artist) {
        if (notificationManager == null) return;
        updateMediaSessionMetadata(title, artist);
        Notification notification = buildNotification(title, artist);
        notificationManager.notify(NOTIFICATION_ID, notification);
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
        super.onTaskRemoved(rootIntent);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
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

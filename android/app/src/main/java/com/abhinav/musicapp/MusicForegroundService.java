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
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

public class MusicForegroundService extends Service {
    private static final String CHANNEL_ID = "music_playback";
    private static final int NOTIFICATION_ID = 1;
    private static final String ACTION_PLAY = "com.abhinav.musicapp.action.PLAY";
    private static final String ACTION_PAUSE = "com.abhinav.musicapp.action.PAUSE";
    private static final String ACTION_NEXT = "com.abhinav.musicapp.action.NEXT";
    private static final String ACTION_PREVIOUS = "com.abhinav.musicapp.action.PREVIOUS";
    private static final String ACTION_STOP = "com.abhinav.musicapp.action.STOP";
    private static final String ACTION_HEADSET_PLUG = "android.intent.action.HEADSET_PLUG";

    public static MusicForegroundService instance;

    private NotificationManager notificationManager;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private PowerManager.WakeLock wakeLock;
    private BroadcastReceiver headsetReceiver;
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
            acquireWakeLock();
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] onCreate failed: " + e.getMessage());
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
            if (Build.VERSION.SDK_INT >= 34) {
                registerReceiver(headsetReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(headsetReceiver, filter);
            }
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

            if (intent == null && instance != null) {
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

            Notification notification = buildNotification(title, artist, album);
            startForeground(NOTIFICATION_ID, notification);
            acquireWakeLock();
        } catch (Exception e) {
            System.err.println("[MusicForegroundService] onStartCommand failed: " + e.getMessage());
        }
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

        return builder
                .setContentTitle(title)
                .setContentText(artist)
                .setSubText(album)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setPriority(Notification.PRIORITY_LOW)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .build();
    }

    private void dispatchMediaAction(String action, long position) {
        if (instance == null) return;
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
    }

    public void updateNotification(String title, String artist, String album, String albumArt) {
        if (notificationManager == null) return;
        currentTitle = title;
        currentArtist = artist;
        currentAlbum = album;
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
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        instance = null;
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

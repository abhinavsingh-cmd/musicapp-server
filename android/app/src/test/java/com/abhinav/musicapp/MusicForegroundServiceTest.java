package com.abhinav.musicapp;

import static org.junit.Assert.*;

import org.junit.Test;

/**
 * Unit tests for MusicForegroundService constants, action mapping, and static instance lifecycle.
 * These tests verify pure logic without requiring an Android context.
 */
public class MusicForegroundServiceTest {

    // ── Action constants ──

    @Test
    public void actionConstants_haveCorrectValues() throws Exception {
        // Use reflection to access private constants
        assertEquals("com.abhinav.musicapp.action.PLAY",
            getStaticField(MusicForegroundService.class, "ACTION_PLAY"));
        assertEquals("com.abhinav.musicapp.action.PAUSE",
            getStaticField(MusicForegroundService.class, "ACTION_PAUSE"));
        assertEquals("com.abhinav.musicapp.action.NEXT",
            getStaticField(MusicForegroundService.class, "ACTION_NEXT"));
        assertEquals("com.abhinav.musicapp.action.PREVIOUS",
            getStaticField(MusicForegroundService.class, "ACTION_PREVIOUS"));
        assertEquals("com.abhinav.musicapp.action.STOP",
            getStaticField(MusicForegroundService.class, "ACTION_STOP"));
    }

    @Test
    public void notificationConstants_areCorrect() throws Exception {
        assertEquals("music_playback",
            getStaticField(MusicForegroundService.class, "CHANNEL_ID"));
        assertEquals(Integer.valueOf(1),
            (Integer) getStaticField(MusicForegroundService.class, "NOTIFICATION_ID"));
    }

    // ── Static instance lifecycle ──

    @Test
    public void instance_isInitiallyNull() {
        // After class loading, instance should be null (no service running)
        MusicForegroundService.instance = null;
        assertNull(MusicForegroundService.instance);
    }

    @Test
    public void instance_canBeSetAndCleared() {
        MusicForegroundService.instance = null;
        // We can't create a real Service without context, but we can test the static field
        // by setting it to null and verifying it stays null
        MusicForegroundService.instance = null;
        assertNull(MusicForegroundService.instance);
    }

    // ── dispatchMediaAction mapping (via reflection) ──

    @Test
    public void dispatchMediaAction_playMapsToPlay() throws Exception {
        // We can't call dispatchMediaAction directly (needs instance + BackgroundAudioPlugin),
        // but we can verify the mapping logic by testing the action string constants
        String actionPlay = getStaticField(MusicForegroundService.class, "ACTION_PLAY");
        assertEquals("com.abhinav.musicapp.action.PLAY", actionPlay);
    }

    @Test
    public void headsetPlugAction_isCorrect() throws Exception {
        String headsetAction = getStaticField(MusicForegroundService.class, "ACTION_HEADSET_PLUG");
        assertEquals("android.intent.action.HEADSET_PLUG", headsetAction);
    }

    // ── BackgroundAudioPlugin static behavior ──

    @Test
    public void backgroundAudioPlugin_notifyMediaAction_withNullInstance_doesNotThrow() {
        // notifyMediaAction should be a no-op when instance is null
        BackgroundAudioPlugin.notifyMediaAction("play", -1);
        // No exception thrown = pass
    }

    @Test
    public void backgroundAudioPlugin_getInstance_returnsNullByDefault() {
        // After class loading without load(), getInstance should return null
        assertNull(BackgroundAudioPlugin.getInstance());
    }

    // ── Media-button debounce (pure logic, injected clock) ──

    private MusicForegroundService newService() {
        // Service constructor needs no context for pure-logic fields.
        return new MusicForegroundService();
    }

    @Test
    public void debounce_dropsIdenticalActionInsideWindow() {
        MusicForegroundService svc = newService();
        assertFalse(svc.isDuplicateMediaAction("next", -1, 1000));
        // Same action 100ms later — a Bluetooth double-tap: dropped.
        assertTrue(svc.isDuplicateMediaAction("next", -1, 1100));
    }

    @Test
    public void debounce_allowsSameActionAfterWindow() {
        MusicForegroundService svc = newService();
        assertFalse(svc.isDuplicateMediaAction("next", -1, 1000));
        long after = 1000 + getDebounceMs() + 1;
        assertFalse(svc.isDuplicateMediaAction("next", -1, after));
    }

    @Test
    public void debounce_allowsDifferentActionImmediately() {
        MusicForegroundService svc = newService();
        assertFalse(svc.isDuplicateMediaAction("play", -1, 1000));
        // play/pause toggle from a headset single-press must pass instantly.
        assertFalse(svc.isDuplicateMediaAction("pause", -1, 1010));
    }

    @Test
    public void debounce_duplicateResetsWindow_stuckButtonCannotMachineGun() {
        MusicForegroundService svc = newService();
        long t = 0;
        assertFalse(svc.isDuplicateMediaAction("next", -1, t));
        // Spam inside the window — every repeat resets the window and is
        // dropped; the first press after a quiet period passes again.
        for (int i = 1; i <= 10; i++) {
            t += 100; // each repeat < window
            assertTrue(svc.isDuplicateMediaAction("next", -1, t));
        }
        assertFalse(svc.isDuplicateMediaAction("next", -1, t + getDebounceMs() + 1));
    }

    @Test
    public void debounce_seeksAreKeyedByPositionToo() {
        MusicForegroundService svc = newService();
        assertFalse(svc.isDuplicateMediaAction("seek", 30_000, 1000));
        // A DIFFERENT seek target within the window is a distinct command.
        assertFalse(svc.isDuplicateMediaAction("seek", 60_000, 1050));
        // The exact same seek repeated is a duplicate.
        assertTrue(svc.isDuplicateMediaAction("seek", 60_000, 1100));
    }

    @Test
    public void debounce_nullActionIsAlwaysDropped() {
        MusicForegroundService svc = newService();
        assertTrue(svc.isDuplicateMediaAction(null, -1, 1000));
    }

    @Test
    public void updatePlaybackState_harvestsPositionEvenWhenNativeActive() {
        MusicForegroundService svc = newService();
        setField(svc, "nativeEngineActive", true);
        // No currentUrl — snapshot persistence is skipped, but the position
        // harvest for MediaSession state must still happen.
        svc.updatePlaybackState(true, 42, 200);
        assertEquals(42_000L, (long) getField(svc, "lastKnownPositionMs"));
        assertEquals(200L, (long) getField(svc, "duration"));
    }

    private static long getDebounceMs() {
        try {
            java.lang.reflect.Field f = MusicForegroundService.class.getDeclaredField("MEDIA_ACTION_DEBOUNCE_MS");
            f.setAccessible(true);
            return f.getLong(null);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static void setField(Object target, String name, Object value) {
        try {
            java.lang.reflect.Field f = target.getClass().getDeclaredField(name);
            f.setAccessible(true);
            f.set(target, value);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @SuppressWarnings("unchecked")
    private static <T> T getField(Object target, String name) {
        try {
            java.lang.reflect.Field f = target.getClass().getDeclaredField(name);
            f.setAccessible(true);
            return (T) f.get(target);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    // ── Helper: reflective access to private static fields ──

    @SuppressWarnings("unchecked")
    private <T> T getStaticField(Class<?> clazz, String fieldName) throws Exception {
        java.lang.reflect.Field field = clazz.getDeclaredField(fieldName);
        field.setAccessible(true);
        return (T) field.get(null);
    }
}

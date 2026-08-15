package com.abhinav.musicapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Pure-JVM tests for the download validation logic in AndroidDownloadManager.
 *
 * A download must only be reported completed after the actual file on disk
 * has been validated — these tests pin the exact rejection reasons for
 * 0-byte files, truncated payloads, and non-audio (error page) content.
 */
public class AndroidDownloadManagerTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    // ── File validation ────────────────────────────────────────────────────

    @Test
    public void validate_rejectsMissingFile() {
        File missing = new File(tmp.getRoot(), "does-not-exist.mp3");
        String reason = AndroidDownloadManager.validateDownloadedFile(missing);
        assertNotNull(reason);
        assertTrue(reason.contains("does not exist"));
    }

    @Test
    public void validate_rejectsNullFile() {
        String reason = AndroidDownloadManager.validateDownloadedFile(null);
        assertNotNull(reason);
        assertTrue(reason.contains("could not be located"));
    }

    @Test
    public void validate_rejectsZeroByteFileWithExplicitReason() throws IOException {
        File empty = tmp.newFile("empty.mp3");
        String reason = AndroidDownloadManager.validateDownloadedFile(empty);
        assertNotNull(reason);
        assertTrue("reason must mention the 0-byte size: " + reason, reason.contains("0 bytes"));
    }

    @Test
    public void validate_rejectsTooSmallFile() throws IOException {
        File tiny = writeFile("tiny.mp3", id3Header(512));
        String reason = AndroidDownloadManager.validateDownloadedFile(tiny);
        assertNotNull(reason);
        assertTrue(reason.contains("too small"));
    }

    @Test
    public void validate_rejectsHtmlErrorPageWithAudioExtension() throws IOException {
        // The classic failure mode: server responds 200 with an HTML error
        // body. The file is large enough to pass size checks — only the
        // header sniff can catch it.
        byte[] html = new byte[64 * 1024];
        byte[] head = "<html><body>403 Forbidden</body></html>".getBytes();
        System.arraycopy(head, 0, html, 0, head.length);
        File fake = writeFile("fake.mp3", html);
        String reason = AndroidDownloadManager.validateDownloadedFile(fake);
        assertNotNull(reason);
        assertTrue(reason.contains("not a known audio container"));
    }

    @Test
    public void validate_acceptsValidMp3() throws IOException {
        File mp3 = writeFile("ok.mp3", id3Header(32 * 1024));
        assertNull(AndroidDownloadManager.validateDownloadedFile(mp3));
    }

    @Test
    public void validate_acceptsValidM4a() throws IOException {
        byte[] bytes = new byte[32 * 1024];
        // '....ftyp' box header
        bytes[0] = 0; bytes[1] = 0; bytes[2] = 0; bytes[3] = 0x20;
        bytes[4] = 'f'; bytes[5] = 't'; bytes[6] = 'y'; bytes[7] = 'p';
        File m4a = writeFile("ok.m4a", bytes);
        assertNull(AndroidDownloadManager.validateDownloadedFile(m4a));
    }

    // ── Magic byte sniffing ────────────────────────────────────────────────

    @Test
    public void looksLikeAudio_recognizesKnownContainers() {
        assertTrue(AndroidDownloadManager.looksLikeAudio(new byte[]{0x49, 0x44, 0x33, 0x03}, 4));           // ID3
        assertTrue(AndroidDownloadManager.looksLikeAudio(new byte[]{(byte) 0xFF, (byte) 0xFB, 0, 0}, 4));   // MP3 sync
        assertTrue(AndroidDownloadManager.looksLikeAudio(new byte[]{0, 0, 0, 0x20, 'f', 't', 'y', 'p'}, 8)); // M4A
        assertTrue(AndroidDownloadManager.looksLikeAudio(new byte[]{(byte) 0x1A, 0x45, (byte) 0xDF, (byte) 0xA3}, 4)); // WebM
        assertTrue(AndroidDownloadManager.looksLikeAudio(new byte[]{'O', 'g', 'g', 'S'}, 4));                // Ogg
        assertTrue(AndroidDownloadManager.looksLikeAudio(new byte[]{'f', 'L', 'a', 'C'}, 4));                // FLAC
    }

    @Test
    public void looksLikeAudio_rejectsGarbageAndEmpty() {
        assertFalse(AndroidDownloadManager.looksLikeAudio(new byte[]{'<', 'h', 't', 'm', 'l', '>'}, 6));
        assertFalse(AndroidDownloadManager.looksLikeAudio(new byte[]{'{', '"', 'e', 'r', 'r'}, 5));
        assertFalse(AndroidDownloadManager.looksLikeAudio(new byte[0], 0));
        assertFalse(AndroidDownloadManager.looksLikeAudio(null, 4));
    }

    // ── Filename generation ────────────────────────────────────────────────

    @Test
    public void fileName_sanitizesIllegalCharacters() {
        assertEquals("My_Song_.mp3", AndroidDownloadManager.sanitizeFileNameWithExtension("My Song!.mp3"));
    }

    @Test
    public void fileName_preservesExtension() {
        assertEquals("Track.m4a", AndroidDownloadManager.sanitizeFileNameWithExtension("Track.m4a"));
    }

    @Test
    public void fileName_addsDefaultExtensionWhenMissing() {
        assertEquals("song.mp4", AndroidDownloadManager.sanitizeFileNameWithExtension("song"));
    }

    @Test
    public void fileName_neverEmpty() {
        assertEquals("track.mp4", AndroidDownloadManager.sanitizeFileNameWithExtension(""));
        assertEquals("track.mp4", AndroidDownloadManager.sanitizeFileNameWithExtension(null));
    }

    @Test
    public void fileName_rejectsBogusExtension() {
        // An "extension" containing path separators must never reach the FS
        String result = AndroidDownloadManager.sanitizeFileNameWithExtension("song.../../evil");
        assertFalse(result.contains("/"));
        assertTrue(result.endsWith(".mp4"));
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private static byte[] id3Header(int size) {
        byte[] bytes = new byte[size];
        bytes[0] = 'I';
        bytes[1] = 'D';
        bytes[2] = '3';
        return bytes;
    }

    private File writeFile(String name, byte[] bytes) throws IOException {
        File f = tmp.newFile(name);
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(bytes);
        }
        return f;
    }
}

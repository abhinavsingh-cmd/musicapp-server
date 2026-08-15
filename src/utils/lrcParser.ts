export interface LyricLine {
  time: number; // seconds
  text: string;
}

// Timestamps beyond this are malformed — no real track syncs lyrics past
// 3 hours, and accepting them would corrupt line matching forever.
const MAX_LINE_TIME = 3 * 60 * 60;

/**
 * Parse LRC format lyrics into timed lines.
 * Supports [MM:SS.xx]/[MM:SS.xxx], single-digit minutes ([0:05.00]), and
 * hour-prefixed stamps ([HH:MM:SS.xx]). A line may carry MULTIPLE
 * timestamps ([00:01.00][01:15.00]text) — each one becomes its own line.
 * Malformed lines and insane timestamps are dropped silently: garbage input
 * must degrade to "fewer lines", never to wrong synchronization.
 */
export function parseLRC(lrc: string): LyricLine[] {
  if (typeof lrc !== 'string' || !lrc.trim()) return [];
  const lines: LyricLine[] = [];
  const stamp = /\[(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,3}))?\]/g;

  for (const raw of lrc.split(/\r?\n/)) {
    const text = raw.replace(stamp, '').trim();
    if (!text) continue;
    // Collect every timestamp on the line first, then expand.
    const times: number[] = [];
    let m: RegExpExecArray | null;
    stamp.lastIndex = 0;
    while ((m = stamp.exec(raw)) !== null) {
      let minutes: number;
      let seconds: number;
      let fracMs = 0;
      if (m[3] !== undefined) {
        // [HH:MM:SS.xx]
        minutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        seconds = parseInt(m[3], 10);
      } else {
        minutes = parseInt(m[1], 10);
        seconds = parseInt(m[2], 10);
      }
      if (m[4] !== undefined) {
        fracMs = parseInt(m[4].padEnd(3, '0'), 10);
      }
      // Malformed timestamps (e.g. seconds >= 60) are dropped, not clamped —
      // a clamped line would silently sync to the wrong moment.
      if (seconds >= 60) continue;
      const time = minutes * 60 + seconds + fracMs / 1000;
      if (Number.isFinite(time) && time >= 0 && time <= MAX_LINE_TIME) {
        times.push(time);
      }
    }
    for (const time of times) {
      lines.push({ time, text });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Convert plain (unsynced) lyrics into rough timed lines.
 * Estimates ~4 seconds per line so static lyrics still follow playback.
 */
export function plainToSynced(lyrics: string): LyricLine[] {
  if (typeof lyrics !== 'string') return [];
  return lyrics
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((text, i) => ({
      time: i * 4,
      text: text.trim(),
    }));
}

/**
 * Find the active lyric line index for a given playback time.
 * Returns -1 if before the first line.
 */
export function findActiveLine(lyrics: LyricLine[], currentTime: number): number {
  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (currentTime >= lyrics[i].time) {
      return i;
    }
  }
  return -1;
}

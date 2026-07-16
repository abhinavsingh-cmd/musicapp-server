export interface LyricLine {
  time: number; // seconds
  text: string;
}

/**
 * Parse LRC format lyrics into timed lines.
 * Supports standard LRC timestamps: [MM:SS.xx] or [MM:SS.xxx]
 */
export function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/;

  for (const raw of lrc.split('\n')) {
    const match = raw.match(regex);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const frac = parseInt(match[3].padEnd(3, '0'), 10);
      const time = minutes * 60 + seconds + frac / 1000;
      const text = match[4].trim();
      if (text) {
        lines.push({ time, text });
      }
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Convert plain (unsynced) lyrics into rough timed lines.
 * Estimates ~4 seconds per line.
 */
export function plainToSynced(lyrics: string): LyricLine[] {
  return lyrics
    .split('\n')
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

import { describe, it, expect } from 'vitest';
import { parseLRC, plainToSynced, findActiveLine } from './lrcParser';

// ---------------------------------------------------------------------------
// LRC parsing — timed lyrics, static lyrics, and every flavor of malformed
// input must degrade to "fewer lines", never to wrong synchronization.
// ---------------------------------------------------------------------------

describe('parseLRC — timed lyrics', () => {
  it('parses standard [MM:SS.xx] stamps into sorted timed lines', () => {
    const lines = parseLRC('[00:12.50]Hello\n[00:01.00]First');
    expect(lines).toEqual([
      { time: 1, text: 'First' },
      { time: 12.5, text: 'Hello' },
    ]);
  });

  it('parses 3-digit milliseconds and single-digit minutes', () => {
    const lines = parseLRC('[0:05.123]Line one\n[01:00.5]Line two');
    expect(lines[0]).toEqual({ time: 5.123, text: 'Line one' });
    expect(lines[1]).toEqual({ time: 60.5, text: 'Line two' });
  });

  it('parses hour-prefixed stamps [HH:MM:SS.xx]', () => {
    const lines = parseLRC('[01:02:03.25]Deep cut');
    expect(lines).toEqual([{ time: 3723.25, text: 'Deep cut' }]);
  });

  it('expands a line with MULTIPLE timestamps into one line per stamp', () => {
    const lines = parseLRC('[00:01.00][01:15.00]Chorus returns');
    expect(lines).toEqual([
      { time: 1, text: 'Chorus returns' },
      { time: 75, text: 'Chorus returns' },
    ]);
  });

  it('handles \\r\\n line endings and metadata-free output', () => {
    const lines = parseLRC('[00:01.00]A\r\n[00:02.00]B\r\n');
    expect(lines.map(l => l.text)).toEqual(['A', 'B']);
  });
});

describe('parseLRC — malformed input', () => {
  it('returns [] for empty, blank, and non-string input', () => {
    expect(parseLRC('')).toEqual([]);
    expect(parseLRC('   \n\n  ')).toEqual([]);
    expect(parseLRC(null as unknown as string)).toEqual([]);
    expect(parseLRC(undefined as unknown as string)).toEqual([]);
  });

  it('drops lines without timestamps (plain text inside LRC)', () => {
    const lines = parseLRC('no stamp here\n[00:05.00]valid');
    expect(lines).toEqual([{ time: 5, text: 'valid' }]);
  });

  it('drops timestamps with impossible seconds instead of clamping them', () => {
    // [00:75.00] must NOT silently become 75s — it is malformed.
    const lines = parseLRC('[00:75.00]broken\n[00:10.00]good');
    expect(lines).toEqual([{ time: 10, text: 'good' }]);
  });

  it('drops absurdly large timestamps beyond any real track', () => {
    const lines = parseLRC('[99:99.00]insane\n[00:03.00]ok');
    expect(lines.map(l => l.text)).toEqual(['ok']);
  });

  it('drops timestamp-only lines with no text', () => {
    expect(parseLRC('[00:01.00]   \n[00:02.00]real')).toEqual([
      { time: 2, text: 'real' },
    ]);
  });

  it('keeps valid stamps on a line that also carries a malformed one', () => {
    const lines = parseLRC('[00:75.00][00:30.00]mixed');
    expect(lines).toEqual([{ time: 30, text: 'mixed' }]);
  });

  it('garbage input never throws', () => {
    expect(() => parseLRC('\u0000\u0001[[[[\n\x7f')).not.toThrow();
    expect(parseLRC('[[[[\n{{{')).toEqual([]);
  });
});

describe('plainToSynced — static lyrics', () => {
  it('assigns a rough 4s cadence and filters blank lines', () => {
    const lines = plainToSynced('one\n\ntwo\n   \nthree');
    expect(lines).toEqual([
      { time: 0, text: 'one' },
      { time: 4, text: 'two' },
      { time: 8, text: 'three' },
    ]);
  });

  it('returns [] for empty or non-string input', () => {
    expect(plainToSynced('')).toEqual([]);
    expect(plainToSynced(42 as unknown as string)).toEqual([]);
  });
});

describe('findActiveLine — synchronization and seeking', () => {
  const lines = [
    { time: 1, text: 'a' },
    { time: 5, text: 'b' },
    { time: 10, text: 'c' },
  ];

  it('returns -1 before the first line', () => {
    expect(findActiveLine(lines, 0)).toBe(-1);
    expect(findActiveLine(lines, 0.99)).toBe(-1);
  });

  it('tracks the latest line at or before the playhead', () => {
    expect(findActiveLine(lines, 1)).toBe(0);
    expect(findActiveLine(lines, 4.9)).toBe(0);
    expect(findActiveLine(lines, 5)).toBe(1);
    expect(findActiveLine(lines, 999)).toBe(2);
  });

  it('a backward seek returns to the earlier line deterministically', () => {
    expect(findActiveLine(lines, 12)).toBe(2);
    expect(findActiveLine(lines, 2)).toBe(0); // seek back to the start
  });

  it('returns -1 for an empty lyrics array', () => {
    expect(findActiveLine([], 50)).toBe(-1);
  });
});

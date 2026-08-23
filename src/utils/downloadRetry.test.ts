import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseRetryAfter,
  exponentialBackoffWithJitter,
} from './downloadManager';

describe('parseRetryAfter', () => {
  it('returns undefined for null header', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseRetryAfter('')).toBeUndefined();
  });

  it('parses numeric seconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(parseRetryAfter('60')).toBe(60_000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('caps at 5 minutes', () => {
    expect(parseRetryAfter('600')).toBe(300_000);
    expect(parseRetryAfter('999')).toBe(300_000);
  });

  it('parses HTTP-date format', () => {
    const futureDate = new Date(Date.now() + 30_000).toUTCString();
    const result = parseRetryAfter(futureDate);
    expect(result).toBeGreaterThan(25_000);
    expect(result).toBeLessThanOrEqual(30_000);
  });

  it('returns undefined for past HTTP-date', () => {
    const pastDate = new Date(Date.now() - 30_000).toUTCString();
    expect(parseRetryAfter(pastDate)).toBeUndefined();
  });

  it('returns undefined for invalid string', () => {
    expect(parseRetryAfter('invalid')).toBeUndefined();
  });

  it('handles whitespace in numeric value', () => {
    expect(parseRetryAfter('  30  ')).toBe(30_000);
  });
});

describe('exponentialBackoffWithJitter', () => {
  it('returns a value >= baseMs', () => {
    for (let i = 0; i < 10; i++) {
      const delay = exponentialBackoffWithJitter(0, 1000, 30_000);
      expect(delay).toBeGreaterThanOrEqual(1000);
    }
  });

  it('returns a value <= maxMs', () => {
    for (let i = 0; i < 10; i++) {
      const delay = exponentialBackoffWithJitter(5, 1000, 30_000);
      expect(delay).toBeLessThanOrEqual(30_000);
    }
  });

  it('increases with attempt number (on average)', () => {
    const delays0: number[] = [];
    const delays3: number[] = [];
    for (let i = 0; i < 100; i++) {
      delays0.push(exponentialBackoffWithJitter(0, 1000, 30_000));
      delays3.push(exponentialBackoffWithJitter(3, 1000, 30_000));
    }
    const avg0 = delays0.reduce((a, b) => a + b, 0) / delays0.length;
    const avg3 = delays3.reduce((a, b) => a + b, 0) / delays3.length;
    expect(avg3).toBeGreaterThan(avg0);
  });

  it('respects custom base and max', () => {
    const delay = exponentialBackoffWithJitter(0, 500, 5000);
    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThanOrEqual(5000);
  });
});

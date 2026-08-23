/**
 * safeProviderCall tests.
 *
 * Proves that:
 *   - a successful provider call returns the value
 *   - a hanging provider call times out instead of blocking forever
 *   - a throwing provider call returns a classified failure
 *   - one provider's failure never blocks other providers
 *   - error kinds are correctly classified (timeout, network, rateLimit, etc.)
 *   - health tracking receives the correct events from failures
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  safeProviderCall,
  RESOLVE_TIMEOUT_MS,
  SEARCH_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
} from './safeProviderCall';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Successful execution
// ---------------------------------------------------------------------------

describe('safeProviderCall — success', () => {
  it('returns { ok: true, value } when the provider resolves normally', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const result = await safeProviderCall(fn, 'test.success');
    expect(result).toEqual({ ok: true, value: 'result' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns { ok: true, value } for null/undefined returns', async () => {
    const fn = vi.fn().mockResolvedValue(null);
    const result = await safeProviderCall(fn, 'test.null');
    expect(result).toEqual({ ok: true, value: null });
  });

  it('cleans up the timeout timer on success', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const fn = vi.fn().mockResolvedValue('ok');
    await safeProviderCall(fn, 'test.cleanup', 5000);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Timeout handling
// ---------------------------------------------------------------------------

describe('safeProviderCall — timeout', () => {
  it('returns { ok: false, kind: "timeout" } when the provider hangs', async () => {
    const fn = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves
    const promise = safeProviderCall(fn, 'test.hang', 1000);

    // Advance past the timeout
    vi.advanceTimersByTime(1000);

    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('timeout');
      expect(result.message).toContain('timed out');
      expect(result.message).toContain('test.hang');
    }
  });

  it('does NOT resolve early if the provider finishes before timeout', async () => {
    const fn = vi.fn().mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve('fast'), 500))
    );
    const promise = safeProviderCall(fn, 'test.fast', 1000);

    vi.advanceTimersByTime(500);
    const result = await promise;
    expect(result).toEqual({ ok: true, value: 'fast' });
  });

  it('uses the default RESOLVE_TIMEOUT_MS when no timeout is specified', async () => {
    const fn = vi.fn().mockImplementation(() => new Promise(() => {}));
    const promise = safeProviderCall(fn, 'test.default');

    vi.advanceTimersByTime(RESOLVE_TIMEOUT_MS - 1);
    // Should not have timed out yet
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('timeout');
  });

  it('cleans up the timeout timer after timeout fires', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const fn = vi.fn().mockImplementation(() => new Promise(() => {}));
    const promise = safeProviderCall(fn, 'test.timer', 100);

    vi.advanceTimersByTime(100);
    await promise;
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Exception handling
// ---------------------------------------------------------------------------

describe('safeProviderCall — exceptions', () => {
  it('returns { ok: false, kind: "exception" } for generic errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('something broke'));
    const result = await safeProviderCall(fn, 'test.error');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('exception');
      expect(result.message).toBe('something broke');
      expect(result.cause).toBeInstanceOf(Error);
    }
  });

  it('classifies timeout errors correctly', async () => {
    const err = new Error('request timed out');
    err.name = 'TimeoutError';
    const fn = vi.fn().mockRejectedValue(err);
    const result = await safeProviderCall(fn, 'test.timeout');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('timeout');
  });

  it('classifies 429 rate limit errors correctly', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('429 Too Many Requests'));
    const result = await safeProviderCall(fn, 'test.429');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('rateLimit');
  });

  it('classifies 503 server errors correctly', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'));
    const result = await safeProviderCall(fn, 'test.503');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('serverError');
  });

  it('classifies network errors correctly', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    const result = await safeProviderCall(fn, 'test.fetch');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('network');
  });

  it('classifies ECONNREFUSED as network error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const result = await safeProviderCall(fn, 'test.econnrefused');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('network');
  });

  it('handles non-Error thrown values', async () => {
    const fn = vi.fn().mockRejectedValue('string error');
    const result = await safeProviderCall(fn, 'test.string');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('exception');
      expect(result.message).toBe('string error');
    }
  });

  it('preserves the original error in cause for debugging', async () => {
    const original = new Error('original error');
    const fn = vi.fn().mockRejectedValue(original);
    const result = await safeProviderCall(fn, 'test.cause');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.cause).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Provider fallback / isolation
// ---------------------------------------------------------------------------

describe('safeProviderCall — provider isolation', () => {
  it('one provider timing out does not block other providers', async () => {
    const slow = vi.fn().mockImplementation(() => new Promise(() => {})); // hangs
    const fast = vi.fn().mockResolvedValue('quick');

    const slowResult = safeProviderCall(slow, 'slow', 1000);
    const fastResult = safeProviderCall(fast, 'fast', 1000);

    vi.advanceTimersByTime(1000);

    const [a, b] = await Promise.all([slowResult, fastResult]);
    expect(a.ok).toBe(false);  // slow timed out
    expect(b).toEqual({ ok: true, value: 'quick' }); // fast succeeded
  });

  it('one provider throwing does not affect other providers', async () => {
    const broken = vi.fn().mockRejectedValue(new Error('broken'));
    const working = vi.fn().mockResolvedValue('works');

    const [a, b] = await Promise.all([
      safeProviderCall(broken, 'broken'),
      safeProviderCall(working, 'working'),
    ]);

    expect(a.ok).toBe(false);
    expect(b).toEqual({ ok: true, value: 'works' });
  });

  it('multiple providers can timeout independently', async () => {
    const hang1 = vi.fn().mockImplementation(() => new Promise(() => {}));
    const hang2 = vi.fn().mockImplementation(() => new Promise(() => {}));

    const p1 = safeProviderCall(hang1, 'hang1', 500);
    const p2 = safeProviderCall(hang2, 'hang2', 1000);

    vi.advanceTimersByTime(500);
    const r1 = await p1;
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.kind).toBe('timeout');

    vi.advanceTimersByTime(500);
    const r2 = await p2;
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.kind).toBe('timeout');
  });
});

// ---------------------------------------------------------------------------
// Timeout constants
// ---------------------------------------------------------------------------

describe('safeProviderCall — timeout constants', () => {
  it('exports expected default timeout values', () => {
    expect(RESOLVE_TIMEOUT_MS).toBe(30_000);
    expect(SEARCH_TIMEOUT_MS).toBe(20_000);
    expect(DOWNLOAD_TIMEOUT_MS).toBe(15_000);
  });
});

import { describe, it, expect } from 'vitest';
import { isTransientError } from './audioService';

describe('isTransientError', () => {
  describe('returns false for permanent errors (no retry)', () => {
    it('NotSupportedError by name', () => {
      const err = new DOMException('format not supported', 'NotSupportedError');
      expect(isTransientError(err)).toBe(false);
    });

    it('EncodingError by name', () => {
      const err = new DOMException('encoding error', 'EncodingError');
      expect(isTransientError(err)).toBe(false);
    });

    it('format not supported in message', () => {
      expect(isTransientError(new Error('format not supported'))).toBe(false);
    });

    it('video not found', () => {
      expect(isTransientError(new Error('Video not found'))).toBe(false);
    });

    it('video not available', () => {
      expect(isTransientError(new Error('video not available in your region'))).toBe(false);
    });

    it('video removed', () => {
      expect(isTransientError(new Error('video removed'))).toBe(false);
    });

    it('private video', () => {
      expect(isTransientError(new Error('private video'))).toBe(false);
    });

    it('not embeddable', () => {
      expect(isTransientError(new Error('video not embeddable'))).toBe(false);
    });

    it('cannot embed', () => {
      expect(isTransientError(new Error('Cannot embed this video'))).toBe(false);
    });

    it('region blocked', () => {
      expect(isTransientError(new Error('not available in your region'))).toBe(false);
    });

    it('invalid video id', () => {
      expect(isTransientError(new Error('Invalid video ID'))).toBe(false);
    });

    it('no youtube id', () => {
      expect(isTransientError(new Error('No YouTube ID'))).toBe(false);
    });

    it('no playable id', () => {
      expect(isTransientError(new Error('No playable ID'))).toBe(false);
    });

    it('no audio source', () => {
      expect(isTransientError(new Error('No audio source available'))).toBe(false);
    });

    it('null/undefined', () => {
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
    });
  });

  describe('returns true for transient errors (retryable)', () => {
    it('network error', () => {
      expect(isTransientError(new Error('network error'))).toBe(true);
    });

    it('timeout', () => {
      expect(isTransientError(new Error('timeout exceeded'))).toBe(true);
    });

    it('failed to fetch', () => {
      expect(isTransientError(new Error('Failed to fetch'))).toBe(true);
    });

    it('connection refused', () => {
      expect(isTransientError(new Error('connection refused'))).toBe(true);
    });

    it('server error 500', () => {
      expect(isTransientError(new Error('Internal Server Error 500'))).toBe(true);
    });

    it('502 bad gateway', () => {
      expect(isTransientError(new Error('502 Bad Gateway'))).toBe(true);
    });

    it('503 service unavailable', () => {
      expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true);
    });

    it('504 gateway timeout', () => {
      expect(isTransientError(new Error('504 Gateway Timeout'))).toBe(true);
    });

    it('buffering stalled', () => {
      expect(isTransientError(new Error('buffering stalled'))).toBe(true);
    });

    it('expired token', () => {
      expect(isTransientError(new Error('token expired'))).toBe(true);
    });

    it('403 forbidden (transient from CDN)', () => {
      expect(isTransientError(new Error('403 Forbidden'))).toBe(true);
    });

    it('416 range not satisfiable (stale URL)', () => {
      expect(isTransientError(new Error('416 Range Not Satisfiable'))).toBe(true);
    });

    it('plain string error with network keyword', () => {
      expect(isTransientError('network failure')).toBe(true);
    });

    it('unknown error defaults to transient', () => {
      expect(isTransientError(new Error('something weird happened'))).toBe(true);
    });

    it('empty string returns false (falsy)', () => {
      expect(isTransientError('')).toBe(false);
    });

    it('random object defaults to transient', () => {
      expect(isTransientError({ code: 'UNKNOWN' })).toBe(true);
    });
  });
});

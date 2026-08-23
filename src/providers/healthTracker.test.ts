import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HealthTracker, healthTracker } from './healthTracker';

describe('HealthTracker', () => {
  let tracker: HealthTracker;

  beforeEach(() => {
    tracker = new HealthTracker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('record', () => {
    it('records events for a provider', () => {
      tracker.record('youtube', 'success');
      tracker.record('youtube', 'success');
      expect(tracker.getRecentEventCount('youtube')).toBe(2);
    });

    it('records events for multiple providers', () => {
      tracker.record('youtube', 'success');
      tracker.record('jiosaavn', 'rateLimit');
      expect(tracker.getRecentEventCount('youtube')).toBe(1);
      expect(tracker.getRecentEventCount('jiosaavn')).toBe(1);
    });

    it('trims oldest events when exceeding MAX_EVENTS', () => {
      // Record 60 events (MAX_EVENTS is 50)
      for (let i = 0; i < 60; i++) {
        tracker.record('youtube', 'success');
      }
      expect(tracker.getRecentEventCount('youtube')).toBe(50);
    });
  });

  describe('getScore', () => {
    it('returns 1.0 for unknown providers', () => {
      expect(tracker.getScore('unknown')).toBe(1.0);
    });

    it('returns 1.0 when no recent events', () => {
      tracker.record('youtube', 'success');
      // Move time forward past the window
      vi.advanceTimersByTime(6 * 60 * 1000);
      expect(tracker.getScore('youtube')).toBe(1.0);
    });

    it('returns high score for mostly successful events', () => {
      // 9 successes, 1 rate limit
      for (let i = 0; i < 9; i++) {
        tracker.record('youtube', 'success');
      }
      tracker.record('youtube', 'rateLimit');
      
      const score = tracker.getScore('youtube');
      expect(score).toBeGreaterThan(0.5);
    });

    it('returns low score for mostly failed events', () => {
      // 1 success, 9 rate limits
      tracker.record('youtube', 'success');
      for (let i = 0; i < 9; i++) {
        tracker.record('youtube', 'rateLimit');
      }
      
      const score = tracker.getScore('youtube');
      expect(score).toBeLessThan(0.5);
    });

    it('returns 1.0 for all successes', () => {
      for (let i = 0; i < 10; i++) {
        tracker.record('youtube', 'success');
      }
      expect(tracker.getScore('youtube')).toBe(1.0);
    });

    it('returns 0.0 for all rate limits', () => {
      for (let i = 0; i < 10; i++) {
        tracker.record('youtube', 'rateLimit');
      }
      expect(tracker.getScore('youtube')).toBe(0.0);
    });

    it('excludes events outside the sliding window', () => {
      // Record events
      tracker.record('youtube', 'success');
      tracker.record('youtube', 'rateLimit');
      
      // Move time forward past the window
      vi.advanceTimersByTime(6 * 60 * 1000);
      
      // Record a new success
      tracker.record('youtube', 'success');
      
      // Score should be 1.0 (only the recent success counts)
      expect(tracker.getScore('youtube')).toBe(1.0);
    });
  });

  describe('isHealthy', () => {
    it('returns true for unknown providers', () => {
      expect(tracker.isHealthy('unknown')).toBe(true);
    });

    it('returns true for healthy providers', () => {
      for (let i = 0; i < 5; i++) {
        tracker.record('youtube', 'success');
      }
      expect(tracker.isHealthy('youtube')).toBe(true);
    });

    it('returns false for unhealthy providers', () => {
      // Record many failures
      for (let i = 0; i < 10; i++) {
        tracker.record('youtube', 'rateLimit');
      }
      expect(tracker.isHealthy('youtube')).toBe(false);
    });

    it('recovers after successful requests', () => {
      // Make provider unhealthy
      for (let i = 0; i < 10; i++) {
        tracker.record('youtube', 'rateLimit');
      }
      expect(tracker.isHealthy('youtube')).toBe(false);
      
      // Add many successful requests to recover
      // Need enough successes to outweigh the failures
      // 10 rate limits = -5, need > 0.3 normalized score
      // With N successes: (N * 1.0 + 10 * (-0.5)) / (N + 10) > 0.3
      // N - 5 > 0.3N + 3 => 0.7N > 8 => N > 11.4
      for (let i = 0; i < 15; i++) {
        tracker.record('youtube', 'success');
      }
      expect(tracker.isHealthy('youtube')).toBe(true);
    });
  });

  describe('sortByHealth', () => {
    it('returns empty array for empty input', () => {
      expect(tracker.sortByHealth([])).toEqual([]);
    });

    it('returns all providers when all are healthy', () => {
      const ids = ['youtube', 'jiosaavn', 'library'];
      const sorted = tracker.sortByHealth(ids);
      expect(sorted).toEqual(ids);
    });

    it('sorts unhealthy providers to the end', () => {
      // Make jiosaavn unhealthy
      for (let i = 0; i < 10; i++) {
        tracker.record('jiosaavn', 'rateLimit');
      }
      
      const ids = ['jiosaavn', 'youtube', 'library'];
      const sorted = tracker.sortByHealth(ids);
      
      // jiosaavn should be last
      expect(sorted[sorted.length - 1]).toBe('jiosaavn');
      // youtube and library should be first (order preserved)
      expect(sorted[0]).toBe('youtube');
      expect(sorted[1]).toBe('library');
    });

    it('sorts by score when multiple providers are unhealthy', () => {
      // Make jiosaavn very unhealthy (all rate limits)
      for (let i = 0; i < 10; i++) {
        tracker.record('jiosaavn', 'rateLimit');
      }
      
      // Make youtube somewhat unhealthy (mix)
      for (let i = 0; i < 5; i++) {
        tracker.record('youtube', 'success');
      }
      for (let i = 0; i < 5; i++) {
        tracker.record('youtube', 'timeout');
      }
      
      const ids = ['jiosaavn', 'youtube', 'library'];
      const sorted = tracker.sortByHealth(ids);
      
      // library (no events = healthy) should be first
      expect(sorted[0]).toBe('library');
      // youtube (mixed) should be second
      expect(sorted[1]).toBe('youtube');
      // jiosaavn (all failures) should be last
      expect(sorted[2]).toBe('jiosaavn');
    });
  });

  describe('expireOldEvents', () => {
    it('removes events outside the sliding window', () => {
      tracker.record('youtube', 'success');
      tracker.record('youtube', 'rateLimit');
      
      // Move time forward past the window
      vi.advanceTimersByTime(6 * 60 * 1000);
      
      tracker.expireOldEvents();
      
      expect(tracker.getRecentEventCount('youtube')).toBe(0);
      expect(tracker.getScore('youtube')).toBe(1.0);
    });
  });

  describe('reset', () => {
    it('resets health data for a specific provider', () => {
      tracker.record('youtube', 'success');
      tracker.record('jiosaavn', 'rateLimit');
      
      tracker.reset('youtube');
      
      expect(tracker.getRecentEventCount('youtube')).toBe(0);
      expect(tracker.getRecentEventCount('jiosaavn')).toBe(1);
    });

    it('resets all health data when no provider specified', () => {
      tracker.record('youtube', 'success');
      tracker.record('jiosaavn', 'rateLimit');
      
      tracker.reset();
      
      expect(tracker.getRecentEventCount('youtube')).toBe(0);
      expect(tracker.getRecentEventCount('jiosaavn')).toBe(0);
    });
  });

  describe('singleton instance', () => {
    it('exports a singleton instance', () => {
      expect(healthTracker).toBeInstanceOf(HealthTracker);
    });

    it('singleton instance is functional', () => {
      healthTracker.reset();
      healthTracker.record('test-provider', 'success');
      expect(healthTracker.getScore('test-provider')).toBe(1.0);
      healthTracker.reset();
    });
  });
});

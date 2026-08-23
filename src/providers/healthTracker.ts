/**
 * Lightweight local provider health tracker.
 *
 * Tracks recent network events per provider using a sliding time window
 * to calculate a health score. Unhealthy providers are deprioritized in
 * search fan-out, and health recovers automatically after successful requests.
 *
 * Design goals:
 * - No personal data collection (only event counts, no URLs/queries/IPs)
 * - Small footprint: fixed-size array per provider, O(1) record/expire
 * - Compatible with existing plugin architecture (no provider changes needed)
 * - Existing fallback behavior is preserved (health only influences ordering)
 */

import { ProviderId } from './types';

/**
 * Event types tracked per provider.
 * No sensitive data is stored — only the event type and timestamp.
 */
export type HealthEvent = 'success' | 'rateLimit' | 'serverError' | 'timeout' | 'networkError';

interface TimestampedEvent {
  timestamp: number;
  type: HealthEvent;
}

interface ProviderHealth {
  events: TimestampedEvent[];
}

/** Weight of each event type in the health score calculation. */
const EVENT_WEIGHTS: Record<HealthEvent, number> = {
  success: 1.0,
  rateLimit: -0.5,
  serverError: -0.4,
  timeout: -0.3,
  networkError: -0.3,
};

/** Sliding window duration in milliseconds (5 minutes). */
const WINDOW_MS = 5 * 60 * 1000;

/** Maximum events stored per provider (bounded memory). */
const MAX_EVENTS = 50;

/** Health score threshold below which a provider is considered unhealthy. */
const UNHEALTHY_THRESHOLD = 0.3;

/**
 * Health tracker for music-source providers.
 *
 * Usage:
 *   healthTracker.record('youtube', 'success');
 *   healthTracker.isHealthy('youtube'); // true
 *
 *   healthTracker.record('youtube', 'rateLimit');
 *   healthTracker.record('youtube', 'rateLimit');
 *   healthTracker.isHealthy('youtube'); // false
 *
 *   // After 5 minutes, old events expire and health recovers
 */
class HealthTracker {
  private providers = new Map<ProviderId, ProviderHealth>();

  /**
   * Record an event for a provider.
   *
   * @param providerId - The provider identifier
   * @param event - The event type (success, rateLimit, serverError, timeout, networkError)
   */
  record(providerId: ProviderId, event: HealthEvent): void {
    let health = this.providers.get(providerId);
    if (!health) {
      health = { events: [] };
      this.providers.set(providerId, health);
    }

    health.events.push({ timestamp: Date.now(), type: event });

    // Trim oldest events if we exceed the maximum
    if (health.events.length > MAX_EVENTS) {
      health.events.splice(0, health.events.length - MAX_EVENTS);
    }
  }

  /**
   * Get the health score for a provider (0.0 to 1.0).
   *
   * The score is calculated by summing weighted events in the sliding window
   * and normalizing to [0, 1]. A score of 1.0 means all recent events were
   * successful; 0.0 means all were failures.
   *
   * @param providerId - The provider identifier
   * @returns Health score between 0.0 and 1.0
   */
  getScore(providerId: ProviderId): number {
    const health = this.providers.get(providerId);
    if (!health) return 1.0; // Unknown providers are assumed healthy

    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    // Filter to events within the sliding window
    const recentEvents = health.events.filter(e => e.timestamp > cutoff);

    if (recentEvents.length === 0) return 1.0; // No recent data = healthy

    // Calculate raw score from weighted events
    let rawScore = 0;
    for (const event of recentEvents) {
      rawScore += EVENT_WEIGHTS[event.type];
    }

    // Normalize to [0, 1] by dividing by the number of events
    // (each event contributes between -0.5 and 1.0)
    const normalizedScore = rawScore / recentEvents.length;

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, normalizedScore));
  }

  /**
   * Check if a provider is healthy (health score above threshold).
   *
   * @param providerId - The provider identifier
   * @returns true if the provider is healthy or unknown
   */
  isHealthy(providerId: ProviderId): boolean {
    return this.getScore(providerId) >= UNHEALTHY_THRESHOLD;
  }

  /**
   * Sort providers by health score (highest first).
   * Healthy providers come first; within the same health tier, original order is preserved.
   *
   * @param providerIds - Array of provider IDs to sort
   * @returns Sorted array with healthiest providers first
   */
  sortByHealth(providerIds: ProviderId[]): ProviderId[] {
    return [...providerIds].sort((a, b) => this.getScore(b) - this.getScore(a));
  }

  /**
   * Expire old events from all providers.
   * Called automatically on record/getScore, but can be called explicitly
   * for maintenance.
   */
  expireOldEvents(): void {
    const cutoff = Date.now() - WINDOW_MS;
    for (const health of this.providers.values()) {
      health.events = health.events.filter(e => e.timestamp > cutoff);
    }
  }

  /**
   * Get the number of recent events for a provider (for debugging/testing).
   *
   * @param providerId - The provider identifier
   * @returns Number of events in the sliding window
   */
  getRecentEventCount(providerId: ProviderId): number {
    const health = this.providers.get(providerId);
    if (!health) return 0;

    const cutoff = Date.now() - WINDOW_MS;
    return health.events.filter(e => e.timestamp > cutoff).length;
  }

  /**
   * Reset health data for a specific provider or all providers.
   *
   * @param providerId - Optional provider to reset. If omitted, resets all.
   */
  reset(providerId?: ProviderId): void {
    if (providerId) {
      this.providers.delete(providerId);
    } else {
      this.providers.clear();
    }
  }
}

/** Singleton instance used by the application. */
export const healthTracker = new HealthTracker();

// Export class for testing
export { HealthTracker };

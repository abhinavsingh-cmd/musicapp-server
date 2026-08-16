/**
 * Defer a callback until the browser is idle (or the next macrotask when
 * requestIdleCallback is unavailable — jsdom, some WebViews, SSR).
 *
 * This replaces the identical inline fallback that used to be copy-pasted
 * across stores, pages, and services.
 */
export function deferIdle(cb: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => cb());
    return;
  }
  setTimeout(() => cb(), 0);
}


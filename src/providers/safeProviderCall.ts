/**
 * Safe provider method execution wrapper.
 *
 * Every provider method (search, resolveStream, resolveDownload, etc.) is an
 * async function that belongs to a third-party or optional module. A single
 * broken provider can:
 *
 *   - throw an unexpected exception
 *   - return a malformed value
 *   - hang indefinitely (no timeout)
 *
 * Any of these can crash the app, leave it in a permanent loading state,
 * or block other providers from working. This module wraps provider calls
 * with:
 *
 *   1. A configurable timeout (default 30 s)
 *   2. Exception catching and classification
 *   3. A structured result type so callers never need try/catch boilerplate
 *
 * The wrapper is intentionally thin — it does NOT retry, log, or mutate
 * state. Callers decide what to do with the result.
 */

import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ProviderErrorKind =
  | 'timeout'
  | 'network'
  | 'rateLimit'
  | 'serverError'
  | 'exception';

/**
 * Map a ProviderErrorKind (from safeProviderCall) to a health event type.
 * Returns null for error kinds that shouldn't affect health tracking.
 */
export function kindToHealthEvent(kind: ProviderErrorKind): 'rateLimit' | 'serverError' | 'timeout' | 'networkError' | null {
  switch (kind) {
    case 'rateLimit': return 'rateLimit';
    case 'serverError': return 'serverError';
    case 'timeout': return 'timeout';
    case 'network': return 'networkError';
    default: return null; // 'exception' — generic errors don't degrade health
  }
}

export interface ProviderSuccess<T> {
  ok: true;
  value: T;
}

export interface ProviderFailure {
  ok: false;
  kind: ProviderErrorKind;
  message: string;
  /** Original error for debugging / health tracking. Never exposed to UI. */
  cause?: unknown;
}

export type ProviderResult<T> = ProviderSuccess<T> | ProviderFailure;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Reasonable timeout for stream resolution (cold start can be slow). */
export const RESOLVE_TIMEOUT_MS = 10_000;

/** Search is typically faster — shorter timeout. */
export const SEARCH_TIMEOUT_MS = 20_000;

/** Download resolution is server-side — shorter timeout. */
export const DOWNLOAD_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyError(err: unknown): ProviderErrorKind {
  if (!(err instanceof Error)) return 'exception';
  const msg = err.message.toLowerCase();
  const name = err.name.toLowerCase();

  if (name === 'timeouterror' || msg.includes('timeout') || msg.includes('timed out')) {
    return 'timeout';
  }
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'rateLimit';
  }
  if (msg.includes('503') || msg.includes('service unavailable') || msg.includes('500') ||
      msg.includes('502') || msg.includes('504') || msg.includes('server error')) {
    return 'serverError';
  }
  if (name === 'networkerror' || msg.includes('network') || msg.includes('fetch') ||
      msg.includes('connection') || msg.includes('econnrefused') || msg.includes('econnreset') ||
      msg.includes('failed to fetch') || msg.includes('offline')) {
    return 'network';
  }
  return 'exception';
}

// ---------------------------------------------------------------------------
// Core wrapper
// ---------------------------------------------------------------------------

/**
 * Execute an async provider method with a timeout and structured error
 * handling. The provider method is NEVER called if the timeout is <= 0.
 *
 * @param fn      - The async provider method to call.
 * @param label   - Human-readable label for timeout messages (e.g. "youtube.resolveStream").
 * @param timeoutMs - Maximum time to wait before timing out (default: RESOLVE_TIMEOUT_MS).
 * @returns       - ProviderResult with the value or a classified failure.
 */
export async function safeProviderCall<T>(
  fn: () => Promise<T>,
  label: string,
  timeoutMs: number = RESOLVE_TIMEOUT_MS,
): Promise<ProviderResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race<T>([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Provider call timed out after ${timeoutMs}ms: ${label}`));
        }, timeoutMs);
      }),
    ]);
    return { ok: true, value: result };
  } catch (err) {
    const kind = classifyError(err);
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[Providers] safeCall failed (${kind}): ${label} — ${message}`);
    return { ok: false, kind, message, cause: err };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

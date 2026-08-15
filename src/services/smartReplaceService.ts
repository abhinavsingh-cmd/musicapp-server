/**
 * Smart replacement layer for failed streams.
 *
 * When the engine has exhausted its own bounded recovery and a track still
 * fails, this service makes exactly ONE controlled attempt to replace the
 * failed stream with a verified alternative source:
 *
 *   1. identify the failed track (provider + external id + metadata)
 *   2. search registered providers for the SAME song (`title artist`)
 *   3. filter candidates with a STRICT identity match — a similar title
 *      alone is never enough (title equality + artist match + duration
 *      sanity), and the failed source itself is always excluded
 *   4. resolve + PROBE each candidate (bounded count) and verify it can
 *      actually start playing before it is handed to the engine
 *   5. only then return the replacement, preserving the failed song's
 *      title/artist/album metadata
 *
 * Hard bounds — this layer can never retry forever or stall the queue:
 *   - one call per failed queue slot (enforced by the caller)
 *   - at most MAX_CANDIDATE_ATTEMPTS candidates resolved/probed
 *   - a total time budget; exceeding it reports 'timeout' and the caller
 *     falls through to the bounded auto-skip
 * The service never throws — every failure mode is a status the caller can
 * route to the existing auto-skip path.
 */

import { searchProviders, resolvePlayableSource, toTrack, toSong } from '../providers';
import type { PlayableSource, Track } from '../providers/types';
import type { Song } from '../types/music';
import { logger } from '../utils/logger';

/** Total wall-clock budget for one replacement attempt. */
const TOTAL_BUDGET_MS = 15_000;
/** Max results pulled from the provider fan-out search. */
const SEARCH_LIMIT = 8;
/** Max candidates that get resolved + probed per failed track. */
const MAX_CANDIDATE_ATTEMPTS = 2;
/** Max time a single probe element may take to reach canplay. */
const PROBE_TIMEOUT_MS = 5_000;
/** Max allowed duration difference between the failed song and a candidate. */
const DURATION_TOLERANCE_SEC = 30;

export type ReplacementStatus =
  | 'replaced'    // a verified replacement was found
  | 'unavailable' // no candidate matched / every candidate failed verification
  | 'timeout'     // the total budget elapsed before verification completed
  | 'offline';    // no network — replacement search is pointless

export interface ReplacementResult {
  status: ReplacementStatus;
  /** Verified replacement song — original metadata preserved, new source. */
  replacement?: Song;
  /** The resolved, verified playable source for the replacement. */
  playable?: PlayableSource;
  reason?: string;
}

/** Collapse a string to a canonical comparison form. */
function normalize(s: string | undefined | null): string {
  return (s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * STRICT identity match. A candidate must carry the same normalized title
 * AND a matching artist (equality or containment either way) so a song with
 * a merely similar title is never substituted. A known duration on both
 * sides must also agree within tolerance (catches same-title, different-song
 * uploads).
 */
export function isSameTrackIdentity(failed: Track, candidate: Track): boolean {
  const ft = normalize(failed.title);
  const ct = normalize(candidate.title);
  if (!ft || ft !== ct) return false;

  const fa = normalize(failed.artist);
  const ca = normalize(candidate.artist);
  if (fa && ca) {
    const artistOk = fa === ca || (Math.min(fa.length, ca.length) >= 3 && (fa.includes(ca) || ca.includes(fa)));
    if (!artistOk) return false;
  }

  if (failed.duration > 0 && candidate.duration > 0) {
    if (Math.abs(failed.duration - candidate.duration) > DURATION_TOLERANCE_SEC) return false;
  }
  return true;
}

/**
 * Probe that a stream URL can actually start playing. Uses a throwaway
 * element that is NEVER played — src assignment + canplay only — so the
 * single-engine ownership of the real playback element is untouched.
 */
function probeStream(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let el: HTMLAudioElement | null = null;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (el) {
        try { el.pause(); el.removeAttribute('src'); el.load(); } catch { /* best effort */ }
      }
      el = null;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      el = new Audio();
      el.preload = 'auto';
      el.addEventListener('canplay', () => finish(true), { once: true });
      el.addEventListener('loadeddata', () => finish(true), { once: true });
      el.addEventListener('error', () => finish(false), { once: true });
      el.src = url;
    } catch {
      finish(false);
    }
  });
}

async function findVerifiedReplacementInternal(
  failed: Song,
  signal: AbortSignal,
): Promise<ReplacementResult> {
  const failedTrack = toTrack(failed);

  // 2. Controlled alternative discovery — fan out `title artist`.
  let results;
  try {
    results = await searchProviders(`${failed.title} ${failed.artist}`.trim(), {
      limit: SEARCH_LIMIT,
      signal,
    });
  } catch (err) {
    logger.warn('[SmartReplace] search failed:', err);
    return { status: 'unavailable', reason: 'search failed' };
  }
  if (signal.aborted) return { status: 'timeout', reason: 'aborted after search' };

  // 3. Strict identity filter — never the failed source itself, never a
  //    merely similar title. Deduped by provider-scoped external id.
  const seen = new Set<string>();
  const candidates: Track[] = [];
  for (const r of results) {
    for (const t of r.tracks || []) {
      if (signal.aborted) return { status: 'timeout', reason: 'aborted during filtering' };
      if (t.provider === failedTrack.provider && t.externalId && t.externalId === failedTrack.externalId) continue;
      const key = `${t.provider}::${t.externalId || t.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isSameTrackIdentity(failedTrack, t)) candidates.push(t);
    }
  }
  if (candidates.length === 0) {
    return { status: 'unavailable', reason: 'no matching candidate' };
  }

  // 4. Resolve + verify a bounded number of candidates.
  const tried = candidates.slice(0, MAX_CANDIDATE_ATTEMPTS);
  for (const candidate of tried) {
    if (signal.aborted) return { status: 'timeout', reason: 'aborted during verification' };
    let playable: PlayableSource | null;
    try {
      playable = await resolvePlayableSource(candidate, { force: true });
    } catch (err) {
      logger.warn('[SmartReplace] candidate resolve failed:', err);
      continue;
    }
    if (!playable) continue;

    if (playable.kind === 'stream' && !playable.isLocalFile) {
      // Verify the replacement ACTUALLY plays before it replaces anything.
      const ok = await probeStream(playable.streamUrl, PROBE_TIMEOUT_MS);
      if (!ok) {
        logger.warn('[SmartReplace] candidate failed probe:', candidate.externalId || candidate.id);
        continue;
      }
    }
    // Local files and iframe sources are accepted on successful resolution:
    // blobs are validated by the download system; embeds cannot be probed
    // without playing them, and their failures stay isolated per track.

    // 5. Preserve the failed song's metadata — only the source changes.
    // The VERIFIED stream URL travels with the replacement so the engine
    // never has to re-resolve what was just proven playable.
    const candidateSong = toSong(candidate);
    const replacement: Song = {
      ...candidateSong,
      id: failed.id, // queue slot identity stays stable
      title: failed.title,
      artist: failed.artist,
      album: failed.album,
      genre: failed.genre || candidateSong.genre,
      coverArt: failed.coverArt || candidateSong.coverArt,
      releaseYear: failed.releaseYear || candidateSong.releaseYear,
      audioUrl: playable.kind === 'stream' ? playable.streamUrl : candidateSong.audioUrl,
    };
    logger.debug('[SmartReplace] verified replacement:', {
      failed: failedTrack.externalId || failedTrack.id,
      replacement: candidate.externalId || candidate.id,
      provider: candidate.provider,
    });
    return { status: 'replaced', replacement, playable };
  }

  return { status: 'unavailable', reason: 'all candidates failed verification' };
}

/**
 * Find a verified replacement for a failed song. NEVER throws and NEVER
 * exceeds the total budget — any overrun resolves with status 'timeout' so
 * the caller can fall through to the bounded auto-skip.
 */
export async function findVerifiedReplacement(failed: Song): Promise<ReplacementResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { status: 'offline', reason: 'no network for replacement search' };
  }
  const controller = new AbortController();
  let budgetTimer: ReturnType<typeof setTimeout> | null = null;
  const budget = new Promise<ReplacementResult>((resolve) => {
    budgetTimer = setTimeout(() => {
      controller.abort();
      resolve({ status: 'timeout', reason: 'budget elapsed' });
    }, TOTAL_BUDGET_MS);
  });
  try {
    return await Promise.race([
      findVerifiedReplacementInternal(failed, controller.signal).catch((err) => {
        logger.warn('[SmartReplace] unexpected error:', err);
        return { status: 'unavailable' as const, reason: 'unexpected error' };
      }),
      budget,
    ]);
  } finally {
    // The budget timer must never outlive the attempt.
    if (budgetTimer) clearTimeout(budgetTimer);
  }
}

export const smartReplaceService = {
  findVerifiedReplacement,
  isSameTrackIdentity,
};

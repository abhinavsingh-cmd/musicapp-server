/**
 * Provider-agnostic resolution helpers.
 *
 * These are the only entry points the playback engine and the download
 * system use to obtain audio. They consult the provider registry and never
 * reference a specific provider's internals.
 *
 *   resolvePlayableSource(track)
 *     -> PlayableSource   (stream or embedded iframe source)
 *   resolveDownloadDescriptor(track)
 *     -> DownloadDescriptor | null   (URL + metadata for offline fetch)
 *   playableToEngineParams(playable)
 *     -> EnginePlayParams (pure mapping — the engine switches on `mode`)
 */

import { toTrack } from './adapters';
import { providerRegistry } from './registry';
import { logger } from '../utils/logger';
import {
  DownloadDescriptor,
  PlayableSource,
  ProviderId,
  ResolveStreamOptions,
  StreamPlayableSource,
  Track,
  TrackProvider,
} from './types';

const PROXY_URL_TTL_MS = 25 * 60 * 1000; // matches youtubeAudioExtractor cache TTL

function isLocalUrl(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('file:') || url.startsWith('data:');
}

function isOffline(): boolean {
  try { return typeof navigator !== 'undefined' && navigator.onLine === false; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Local copy fallback (offline playback).
//
// The download system registers a resolver that maps a track to its stored
// blob/file URL. Resolution consults it in exactly two situations so ONLINE
// playback is never altered:
//   1. The device is offline and the track only carries a remote URL.
//   2. The provider produced nothing (e.g. stream extraction failed offline).
// A corrupted/failed local copy is never handed back: recovery from a local
// failure passes `localFallback: false`.
// ---------------------------------------------------------------------------

export type LocalCopyResolver = (track: Track) => string | null;

let localCopyResolver: LocalCopyResolver | null = null;

export function registerLocalCopyResolver(fn: LocalCopyResolver | null): void {
  localCopyResolver = fn;
}

/** Resolve a playable source from the locally downloaded copy, if any. */
export function resolveLocalCopy(track: Track): PlayableSource | null {
  if (!localCopyResolver) return null;
  try {
    const url = localCopyResolver(track);
    if (url && isLocalUrl(url)) return toStreamSource(track, url);
  } catch (err) {
    logger.error('[Providers] local copy resolver failed', err);
  }
  return null;
}

/** Heuristic expiry for known transient URL shapes. */
function expiryForUrl(url: string): number | undefined {
  if (isLocalUrl(url)) return undefined;
  if (url.includes('/proxy-audio')) return PROXY_URL_TTL_MS;
  return undefined;
}

function toStreamSource(
  track: Track,
  streamUrl: string,
  expiresInMs?: number,
  isPreview?: boolean,
): PlayableSource {
  const source: StreamPlayableSource = {
    kind: 'stream',
    track,
    streamUrl,
    isLocalFile: isLocalUrl(streamUrl),
    expiresInMs: expiresInMs ?? expiryForUrl(streamUrl),
  };
  if (isPreview) source.isPreview = true;
  return source;
}

// ---------------------------------------------------------------------------
// Lazy provider loading.
//
// The built-in providers are registered eagerly when the app's barrel
// (`src/providers/index.ts`) is imported. The download path and unit tests
// may reach resolution helpers without the barrel, so known provider ids are
// loaded on demand here. Registrations are idempotent.
// ---------------------------------------------------------------------------

const KNOWN_PROVIDER_LOADERS: Record<string, () => Promise<TrackProvider | undefined>> = {
  youtube: () => import('./youtubeProvider').then(m => m.youtubeProvider),
  library: () => import('./libraryProvider').then(m => m.libraryProvider),
  jiosaavn: () => import('./jiosaavnProvider').then(m => m.jiosaavnProvider),
};

const providerLoads = new Map<ProviderId, Promise<TrackProvider | undefined>>();

async function ensureProvider(id: ProviderId): Promise<TrackProvider | undefined> {
  const existing = providerRegistry.get(id);
  if (existing) return existing;

  const loader = KNOWN_PROVIDER_LOADERS[id];
  if (!loader) return undefined;

  if (!providerLoads.has(id)) {
    providerLoads.set(
      id,
      loader()
        .then(provider => {
          if (provider && !providerRegistry.has(id)) {
            providerRegistry.register(provider);
          }
          return providerRegistry.get(id);
        })
        .catch(err => {
          logger.error('[Providers] Failed to load provider', id, err);
          return undefined;
        })
        .finally(() => {
          providerLoads.delete(id);
        }),
    );
  }

  return providerLoads.get(id);
}

/**
 * Resolve a playable source for a track.
 *
 * 1. A track that already carries a direct `streamUrl` (library files,
 *    server-hosted songs, downloaded blob URLs) is returned immediately —
 *    the provider is not consulted. EXCEPTION: while OFFLINE a remote URL
 *    cannot load, so a downloaded local copy wins without touching the
 *    network at all.
 * 2. Otherwise the track's provider resolves the stream (e.g. YouTube
 *    audio extraction, possibly via an embedded-player fallback).
 * 3. If the provider has nothing, a locally downloaded copy can still play
 *    (unless the caller disabled the local fallback).
 * 4. Returns null when nothing playable exists.
 */
export async function resolvePlayableSource(
  track: Track,
  options?: ResolveStreamOptions,
): Promise<PlayableSource | null> {
  if (track.streamUrl) {
    if (!isLocalUrl(track.streamUrl) && isOffline()) {
      const local = resolveLocalCopy(track);
      if (local) return local;
    }
    return toStreamSource(track, track.streamUrl);
  }

  const provider = await ensureProvider(track.provider);
  if (provider) {
    try {
      const resolved = await provider.resolveStream(track, options);
      if (resolved) {
        if (resolved.kind === 'stream') {
          return toStreamSource(resolved.track ?? track, resolved.streamUrl, resolved.expiresInMs, resolved.isPreview);
        }
        return resolved;
      }
    } catch (err) {
      logger.error('[Providers] resolveStream failed for', track.provider, track.id, err);
    }
  }

  // The provider produced nothing (offline, expired, no extraction) — a
  // downloaded copy can still play. Recovery from a corrupted local file
  // opts out via localFallback:false.
  if (options?.localFallback !== false) {
    const local = resolveLocalCopy(track);
    if (local) return local;
  }
  return null;
}

/**
 * Resolve how to download a track's audio for offline storage.
 * Falls back to the track's direct stream URL when the provider has no
 * download-specific route (e.g. server-hosted library files, blob URLs).
 */
export async function resolveDownloadDescriptor(
  track: Track,
): Promise<DownloadDescriptor | null> {
  const provider = await ensureProvider(track.provider);
  if (provider?.resolveDownload) {
    try {
      const descriptor = await provider.resolveDownload(track);
      if (descriptor) return descriptor;
    } catch (err) {
      logger.error('[Providers] resolveDownload failed for', track.provider, track.id, err);
    }
  }

  if (track.streamUrl) {
    return { url: track.streamUrl };
  }

  return null;
}

/** Parameters the playback engine actually needs — fully provider-agnostic. */
export type EnginePlayParams =
  | {
      mode: 'html';
      src: string;
      /** blob:/file: URL — no expiry, no re-extraction retries. */
      isLocalFile: boolean;
      /** Expected stream URL lifetime in ms (undefined = no expiry). */
      expiresInMs?: number;
    }
  | {
      mode: 'iframe';
      videoId: string;
    };

export function playableToEngineParams(playable: PlayableSource): EnginePlayParams {
  if (playable.kind === 'stream') {
    return {
      mode: 'html',
      src: playable.streamUrl,
      isLocalFile: playable.isLocalFile,
      expiresInMs: playable.expiresInMs,
    };
  }
  return { mode: 'iframe', videoId: playable.videoId };
}

/**
 * Normalize an arbitrary input (Song or Track) and resolve a playable
 * source for it. Convenience for callers that hold legacy Song objects.
 */
export async function resolvePlayableFor(
  input: Parameters<typeof toTrack>[0],
  options?: ResolveStreamOptions,
): Promise<PlayableSource | null> {
  return resolvePlayableSource(toTrack(input), options);
}

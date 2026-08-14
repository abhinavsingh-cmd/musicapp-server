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
          console.error('[Providers] Failed to load provider', id, err);
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
 *    the provider is not consulted.
 * 2. Otherwise the track's provider resolves the stream (e.g. YouTube
 *    audio extraction, possibly via an embedded-player fallback).
 * 3. Returns null when nothing playable exists.
 */
export async function resolvePlayableSource(
  track: Track,
  options?: ResolveStreamOptions,
): Promise<PlayableSource | null> {
  if (track.streamUrl) {
    return toStreamSource(track, track.streamUrl);
  }

  const provider = await ensureProvider(track.provider);
  if (!provider) return null;

  try {
    const resolved = await provider.resolveStream(track, options);
    if (!resolved) return null;
    if (resolved.kind === 'stream') {
      return toStreamSource(resolved.track ?? track, resolved.streamUrl, resolved.expiresInMs, resolved.isPreview);
    }
    return resolved;
  } catch (err) {
    console.error('[Providers] resolveStream failed for', track.provider, track.id, err);
    return null;
  }
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
      console.error('[Providers] resolveDownload failed for', track.provider, track.id, err);
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

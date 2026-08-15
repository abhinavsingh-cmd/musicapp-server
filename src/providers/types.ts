/**
 * Music-source provider architecture.
 *
 * The player, queue, and download system must not care where a track came
 * from (YouTube, the library catalog, local downloads, or a future provider
 * such as JioSaavn). Everything they consume flows through the normalized
 * types defined here:
 *
 *   Track            – provider-scoped, normalized metadata (search results,
 *                      queue entries, UI rows). Contains everything the UI
 *                      layer needs to render a song.
 *   PlayableSource   – a resolved, playable artifact produced by a provider.
 *                      This is the ONLY thing the playback engine may
 *                      consume. The engine never inspects provider-specific
 *                      ids or endpoints.
 *   DownloadDescriptor – the only thing the download system may consume when
 *                      fetching audio for offline storage.
 *
 * A TrackProvider owns every provider-specific concern:
 *   - search          – discover tracks by query
 *   - metadata        – normalized title/artist/album/genre/artwork
 *   - track lookup    – fetch a single track by id
 *   - stream resolution – turn a Track into a PlayableSource
 *   - download resolution – turn a Track into a DownloadDescriptor
 *   - lyrics/charts/related – optional capabilities
 */

export type ProviderId = 'youtube' | 'library' | (string & {});

/** Which capabilities a provider actually implements. */
export interface ProviderCapabilities {
  search: boolean;
  trackLookup: boolean;
  lyrics: boolean;
  charts: boolean;
  relatedTracks: boolean;
  downloads: boolean;
}

/**
 * One normalized track. Provider-scoped: `id` is unique within a provider;
 * `externalId` is the raw provider identifier (e.g. a YouTube video id) and
 * is opaque to the player. `streamUrl` is optional: providers that carry a
 * permanent/direct audio URL (local files, server-hosted library songs,
 * downloaded blob URLs) expose it here; providers that resolve streams
 * on-demand (YouTube) leave it unset and implement `resolveStream()`.
 */
export interface Track {
  id: string;
  provider: ProviderId;
  title: string;
  artist: string;
  album: string;
  genre: string;
  duration: number; // seconds
  artwork: string;
  releaseYear?: number;
  /** Raw provider identifier (e.g. YouTube video id). Opaque to the player. */
  externalId?: string;
  /** Direct/known audio URL. Opaque to the player. */
  streamUrl?: string;
  lyrics?: string;
  isFavorite?: boolean;
  playCount?: number;
  addedAt?: string;
  /**
   * Provider-scoped enrichment (singers, label, language, IDs, ...).
   * Opaque to the player, queue, and download system — they must never
   * branch on these values.
   */
  metadata?: Record<string, unknown>;
}

export interface ResolveStreamOptions {
  /**
   * Force a fresh stream resolution, bypassing any provider-side cache.
   * Used when a previously resolved stream URL is known to be stale/expired.
   */
  force?: boolean;
  /**
   * Allow falling back to a locally downloaded copy when the provider has
   * nothing. Default true. Recovery from a CORRUPTED local file sets this
   * false so the failed copy can never be handed back to the engine.
   */
  localFallback?: boolean;
}

/** A direct URL the HTML audio element / native player can consume. */
export interface StreamPlayableSource {
  kind: 'stream';
  track: Track;
  streamUrl: string;
  /** True for blob:/file: URLs that never expire and need no retry logic. */
  isLocalFile: boolean;
  /** Expected lifetime of the URL in ms (e.g. signed/proxied streams). */
  expiresInMs?: number;
  /**
   * True when the URL is a preview-length stream (e.g. a provider's
   * official 30–40s preview), not the full track. The engine plays it the
   * same way; the flag lets the app surface the difference.
   */
  isPreview?: boolean;
}

/**
 * A provider-rendered embeddable player source (e.g. YouTube IFrame).
 * Used when the provider has no direct stream URL but offers an embedded
 * playback path for the same track.
 */
export interface IframePlayableSource {
  kind: 'iframe';
  track: Track;
  /** Opaque id understood by the embedded player engine. */
  videoId: string;
}

/**
 * The normalized, provider-independent playable artifact. The playback
 * engine switches only on `kind`; it never sees provider ids or endpoints.
 */
export type PlayableSource = StreamPlayableSource | IframePlayableSource;

/** What the download system needs to fetch audio for offline storage. */
export interface DownloadDescriptor {
  url: string;
  fileName?: string;
  headers?: Record<string, string>;
}

export interface SearchOptions {
  signal?: AbortSignal;
  limit?: number;
  page?: number;
}

/**
 * A music-source provider. Every provider must implement search, metadata,
 * and stream resolution. Lyrics / charts / related tracks / downloads are
 * optional and declared via `capabilities`.
 */
export interface TrackProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  /** Search this provider's catalog. Returns normalized tracks. */
  search(query: string, options?: SearchOptions): Promise<Track[]>;

  /**
   * Look up a single track and return its freshest metadata.
   * Falls back to returning the input unchanged when the provider has no
   * richer data available.
   */
  getTrack(track: Track): Promise<Track>;

  /**
   * Resolve a playable source for a track. Returns null when the provider
   * cannot produce anything playable.
   */
  resolveStream(track: Track, options?: ResolveStreamOptions): Promise<PlayableSource | null>;

  /** Optional: how to fetch this track's audio for offline storage. */
  resolveDownload?(track: Track): Promise<DownloadDescriptor | null>;

  /** Optional: provider-level charts/trending list. */
  getCharts?(options?: SearchOptions): Promise<Track[]>;

  /** Optional: lyrics for a track. Returns null when unavailable. */
  getLyrics?(track: Track): Promise<string | null>;

  /** Optional: related tracks for autoplay/recommendations. */
  getRelated?(track: Track, limit?: number): Promise<Track[]>;

  /** Optional: drop any cached stream for a track (e.g. stale proxy URL). */
  invalidateStream?(track: Track): void;

  /**
   * Optional: warm provider-owned network resources (DNS prefetch,
   * preconnect, embed-script prefetch) so first playback is fast.
   * Must be idempotent and must never touch shared/app-level resources —
   * the generic engine calls this without knowing which provider it is.
   */
  preconnect?(): void;
}

export interface ProviderRegistry {
  register(provider: TrackProvider): void;
  unregister(id: ProviderId): void;
  get(id: ProviderId | undefined | null): TrackProvider | undefined;
  list(): TrackProvider[];
  has(id: ProviderId | undefined | null): boolean;
}

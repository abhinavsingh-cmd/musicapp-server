/**
 * Canonical source identifier for a song — the provider-scoped external id
 * (e.g. the YouTube video id) when present, otherwise the local row id.
 * Every cross-list lookup (downloads, favorites, dedupe) MUST derive its
 * key here so YouTube, library, and downloaded songs are all keyed the
 * same way.
 */
export function sourceKey(song: { id: string; youtubeId?: string | null }): string {
  return song.youtubeId || song.id;
}

/**
 * Canonical favorite identifier for a song. Favorites are keyed by the
 * YouTube video ID (not per-list ids like `t-...`/`yt-N`), so the same song
 * is recognizable no matter which page/list it comes from.
 */
export const favoriteKey = sourceKey;
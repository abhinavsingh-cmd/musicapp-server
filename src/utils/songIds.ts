/**
 * Canonical favorite identifier for a song. Favorites are keyed by the
 * YouTube video ID (not per-list ids like `t-...`/`yt-N`), so the same song
 * is recognizable no matter which page/list it comes from.
 */
export function favoriteKey(song: { id: string; youtubeId?: string | null }): string {
  return song.youtubeId || song.id;
}
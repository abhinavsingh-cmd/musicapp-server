import type { TrendingSourceLabel } from '../services/trendingService';

/**
 * Single source of truth for how each trending data source is described to
 * the user. Every caller (HomePage, ChartsPage, ...) must use these labels so
 * the UI never mislabels library/fallback data as live YouTube data.
 */
export const TRENDING_SOURCE_LABELS: Record<TrendingSourceLabel, string> = {
  LIVE: 'Live from YouTube',
  CACHED: 'Cached live data',
  LIBRARY: 'From your library',
  BUILT_IN: 'Built-in catalog',
};

/** Hero-style one-liners that only ever claim "live YouTube" for LIVE data. */
const TRENDING_TAGLINES: Record<TrendingSourceLabel, (songCount: number) => string> = {
  LIVE: (n) => `${n} songs + live YouTube trending`,
  CACHED: (n) => `${n} songs + cached YouTube trending`,
  LIBRARY: (n) => `${n} songs · trending from your library`,
  BUILT_IN: (n) => `${n} songs · offline trending (built-in)`,
};

/** Neutral phrasing used before any source is known. */
export function trendingTagline(songCount: number, source: TrendingSourceLabel | 'none'): string {
  if (source === 'none') return `${songCount} songs + trending`;
  return TRENDING_TAGLINES[source](songCount);
}

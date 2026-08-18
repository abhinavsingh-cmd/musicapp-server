import { describe, it, expect } from 'vitest';
import { TRENDING_SOURCE_LABELS, trendingTagline } from './trendingLabels';

describe('trendingLabels', () => {
  it('describes each source distinctly and honestly', () => {
    expect(TRENDING_SOURCE_LABELS.LIVE).toContain('YouTube');
    expect(TRENDING_SOURCE_LABELS.CACHED).toContain('YouTube');
    expect(TRENDING_SOURCE_LABELS.CACHED).not.toMatch(/live/i);
    expect(TRENDING_SOURCE_LABELS.LIBRARY).toMatch(/fallback/i);
    expect(TRENDING_SOURCE_LABELS.LIBRARY).not.toMatch(/live/i);
    expect(TRENDING_SOURCE_LABELS.BUILT_IN).toMatch(/emergency/i);
    expect(TRENDING_SOURCE_LABELS.BUILT_IN).not.toMatch(/live/i);
  });

  it('never calls cached data "live"', () => {
    expect(TRENDING_SOURCE_LABELS.CACHED).not.toContain('live');
    expect(TRENDING_SOURCE_LABELS.CACHED).toBe('Cached YouTube data');
  });

  it('only claims "live YouTube trending" for LIVE data', () => {
    expect(trendingTagline(525, 'LIVE')).toBe('525 songs + live YouTube trending');
    for (const source of ['CACHED', 'LIBRARY', 'BUILT_IN', 'none'] as const) {
      expect(trendingTagline(525, source)).not.toContain('live YouTube');
    }
    expect(trendingTagline(525, 'none')).toBe('525 songs + trending');
  });

  it('taglines use consistent source terminology', () => {
    expect(trendingTagline(10, 'CACHED')).toContain('cached YouTube data');
    expect(trendingTagline(10, 'LIBRARY')).toContain('library fallback');
    expect(trendingTagline(10, 'BUILT_IN')).toContain('emergency fallback');
  });
});

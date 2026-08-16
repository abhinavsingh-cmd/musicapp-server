import { describe, it, expect } from 'vitest';
import { TRENDING_SOURCE_LABELS, trendingTagline } from './trendingLabels';

describe('trendingLabels', () => {
  it('describes each source distinctly and honestly', () => {
    expect(TRENDING_SOURCE_LABELS.LIVE).toContain('YouTube');
    expect(TRENDING_SOURCE_LABELS.CACHED).toMatch(/cached/i);
    expect(TRENDING_SOURCE_LABELS.LIBRARY).not.toMatch(/live/i);
    expect(TRENDING_SOURCE_LABELS.BUILT_IN).not.toMatch(/live/i);
  });

  it('only claims "live YouTube trending" for LIVE data', () => {
    expect(trendingTagline(525, 'LIVE')).toBe('525 songs + live YouTube trending');
    for (const source of ['CACHED', 'LIBRARY', 'BUILT_IN', 'none'] as const) {
      expect(trendingTagline(525, source)).not.toContain('live YouTube');
    }
    expect(trendingTagline(525, 'none')).toBe('525 songs + trending');
  });
});

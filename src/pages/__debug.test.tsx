import { describe, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ChartsPage } from './ChartsPage';
import { useChartsStore } from '../stores/chartsStore';

vi.mock('../stores/audioStore', () => ({
  useAudioStore: (sel: (s: { loadSong: () => void }) => unknown) => sel({ loadSong: vi.fn() }),
}));
vi.mock('../services/trendingService', () => ({
  trendingService: {
    getTrending: () => Promise.resolve({ songs: [], source: 'LIVE', lastUpdated: Date.now() }),
    getState: () => ({ songs: [], source: 'BUILT_IN', lastUpdated: Date.now() }),
  },
}));
vi.mock('../components/SongContextMenu', () => ({
  default: () => null,
  useSongContextMenu: () => ({ handleContextMenu: vi.fn(), handleLongPress: vi.fn(), ContextMenu: () => null }),
}));
vi.mock('../components/CachedImage', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', props),
}));
vi.mock('../components/DownloadButton', () => ({ DownloadButton: () => null }));

describe('debug', () => {
  it('dumps DOM', async () => {
    useChartsStore.setState({
      topCharts: [], globalCharts: [], bollywoodCharts: [],
      loading: false, refreshing: false, error: null,
      lastUpdated: null, source: 'none', origin: null,
    });
    render(<MemoryRouter><ChartsPage /></MemoryRouter>);
    await new Promise(r => setTimeout(r, 200));
    screen.debug(undefined, 100000);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ChartsPage } from './ChartsPage';
import { useChartsStore, ChartSong } from '../stores/chartsStore';
import { Song } from '../types/music';

// ---------------------------------------------------------------------------
// Playback parity: clicking a chart song must enter the exact same pipeline
// as every other song list — audioStore.loadSong(clickedSong, fullQueue, idx).
// Also pins the error and empty states of the Charts page.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  loadSong: vi.fn(),
  getTrending: vi.fn(),
  getState: vi.fn(),
}));

vi.mock('../stores/audioStore', () => ({
  useAudioStore: (selector: (s: { loadSong: typeof mocks.loadSong }) => unknown) =>
    selector({ loadSong: mocks.loadSong }),
}));

// Keep the trending service inert — the store is seeded directly below.
vi.mock('../services/trendingService', () => ({
  trendingService: {
    getTrending: mocks.getTrending,
    getState: mocks.getState,
  },
}));

vi.mock('../components/SongContextMenu', () => ({
  default: () => null,
  useSongContextMenu: () => ({
    handleContextMenu: vi.fn(),
    handleLongPress: vi.fn(),
    ContextMenu: () => null,
  }),
}));

vi.mock('../components/CachedImage', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', props),
}));

vi.mock('../components/DownloadButton', () => ({
  DownloadButton: () => null,
}));

const makeChartSong = (over: Partial<ChartSong> = {}): ChartSong => ({
  id: 'trending-abc',
  title: 'Song A',
  artist: 'Artist A',
  thumbnail: 'https://img/a.jpg',
  rank: 1,
  trend: 'up',
  youtubeId: 'abc',
  duration: 210,
  viewCount: 0,
  ...over,
});

function seedCharts(rows: ChartSong[], over: Record<string, unknown> = {}): void {
  useChartsStore.setState({
    topCharts: rows,
    globalCharts: rows,
    bollywoodCharts: [],
    loading: false,
    refreshing: false,
    error: null,
    lastUpdated: Date.now(),
    source: 'LIVE',
    origin: 'youtube_music',
    ...over,
  });
}

// The page's background fetch must never settle during most tests so the
// seeded store state stays exactly as configured. It is a deferred (not a
// dead promise) so afterEach can drain it — the store's module-level
// in-flight dedupe flag would otherwise leak into the next test.
let drainTrending: ((v: unknown) => void) | null = null;

beforeEach(() => {
  mocks.loadSong.mockReset();
  mocks.getTrending.mockReset();
  mocks.getState.mockReset();
  mocks.getState.mockReturnValue({ songs: [], source: 'BUILT_IN', lastUpdated: Date.now() });
  drainTrending = null;
  mocks.getTrending.mockImplementation(() => new Promise(r => { drainTrending = r; }));
});

afterEach(async () => {
  drainTrending?.({ songs: [], source: 'BUILT_IN', lastUpdated: Date.now() });
  await new Promise(r => setTimeout(r, 0)); // flush store state transitions
});

function renderPage(): void {
  render(
    <MemoryRouter>
      <ChartsPage />
    </MemoryRouter>,
  );
}

describe('ChartsPage — playback parity', () => {
  it('clicking a chart song uses loadSong with the full chart queue and index', async () => {
    seedCharts([
      makeChartSong(),
      makeChartSong({ id: 'trending-def', youtubeId: 'def', title: 'Song B', artist: 'Artist B', rank: 2 }),
      makeChartSong({ id: 'trending-ghi', youtubeId: 'ghi', title: 'Song C', artist: 'Artist C', rank: 3 }),
    ]);

    renderPage();
    fireEvent.click(await screen.findByText('Song B'));

    expect(mocks.loadSong).toHaveBeenCalledTimes(1);
    const [clicked, queue, index] = mocks.loadSong.mock.calls[0] as [Song, Song[], number];

    // Same pipeline as every other list: clicked song + FULL queue + index.
    expect(clicked.id).toBe('trending-def');
    expect(clicked.youtubeId).toBe('def');
    expect(index).toBe(1);
    expect(queue.map(s => s.id)).toEqual(['trending-abc', 'trending-def', 'trending-ghi']);
    // Every queued song must carry a resolvable source (youtubeId).
    expect(queue.every(s => !!s.youtubeId)).toBe(true);
  });

  it('clicking the first song starts the queue at index 0', async () => {
    seedCharts([
      makeChartSong(),
      makeChartSong({ id: 'trending-def', youtubeId: 'def', title: 'Song B', artist: 'Artist B', rank: 2 }),
    ]);

    renderPage();
    fireEvent.click(await screen.findByText('Song A'));

    const [, queue, index] = mocks.loadSong.mock.calls[0] as [Song, Song[], number];
    expect(index).toBe(0);
    expect(queue).toHaveLength(2);
  });
});

describe('ChartsPage — states', () => {
  it('shows an empty state with a retry action when there is no data', async () => {
    seedCharts([], { source: 'none', origin: null, lastUpdated: null });
    // The initial fetch completes with an empty result → empty state.
    mocks.getTrending.mockReturnValue(
      Promise.resolve({ songs: [], source: 'LIVE', lastUpdated: Date.now() }),
    );

    renderPage();

    // Let the deferred hydrate + fetch settle and commit (act flushes the
    // out-of-band zustand updates triggered by the store's async fetch).
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    expect(screen.getByText('No songs in this chart right now')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows the error banner while keeping chart data visible', async () => {
    seedCharts([makeChartSong()], { error: 'Network down' });

    renderPage();

    expect(await screen.findByText('Network down.')).toBeInTheDocument();
    expect(screen.getByText('Song A')).toBeInTheDocument();
  });

  it('shows a skeleton only during the initial load (no data yet)', async () => {
    seedCharts([], { loading: true });

    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('No songs in this chart right now')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Charts')).toBeInTheDocument();
  });
});

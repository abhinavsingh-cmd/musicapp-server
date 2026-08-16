/**
 * Player bar state tests.
 *
 * Covers the real idle state: when no track is loaded the bar must NOT look
 * like an active player (no progress readout, no active shuffle/repeat, no
 * playable transport, no expand affordance, no playback timer). When a track
 * loads, the full player returns with correct duration, progress and
 * playing/paused state.
 *
 * Scenarios: no track · track loaded but paused · track playing ·
 *            track ended · track removed.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock the playback engine + platform services (same isolation the
// audioStore tests use). The player is a view over store state — we drive
// the REAL stores directly, no audio is ever produced.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  play: vi.fn((): Promise<void> => Promise.resolve()),
  pause: vi.fn(),
  resume: vi.fn((): Promise<void> => Promise.resolve()),
  isLoaded: vi.fn(() => false),
  subscribeHandlers: [] as Array<(event: string, data?: unknown) => void>,
}));

vi.mock('../../services/audioServiceInstance', () => ({
  audioService: {
    play: mocks.play,
    pause: mocks.pause,
    resume: mocks.resume,
    isLoaded: mocks.isLoaded,
    seek: vi.fn(),
    setVolume: vi.fn(),
    getDuration: vi.fn(() => 0),
    getCurrentTime: vi.fn(() => 0),
    isNativeEngineActive: vi.fn(() => false),
    syncExternalPosition: vi.fn(),
    adoptNativePlayback: vi.fn(),
    getCurrentPlaybackId: vi.fn(() => 0),
    getCrossfadePhase: vi.fn(() => 'idle'),
    isCrossfading: vi.fn(() => false),
    isHtmlEngineActive: vi.fn(() => false),
    prepareCrossfadeIn: vi.fn(() => Promise.resolve(false)),
    startCrossfadeIn: vi.fn(() => false),
    cancelCrossfade: vi.fn(),
    finishCrossfadeNow: vi.fn(),
    subscribe: vi.fn((cb: (event: string, data?: unknown) => void) => {
      mocks.subscribeHandlers.push(cb);
      return () => {};
    }),
  },
}));

vi.mock('../../services/mediaSessionService', () => ({
  mediaSessionService: {
    init: vi.fn(),
    updateMetadata: vi.fn(),
    updatePlaybackState: vi.fn(),
    updateActions: vi.fn(),
  },
}));

vi.mock('../../services/playbackPersistenceService', () => ({
  playbackPersistenceService: { load: vi.fn(() => null), save: vi.fn(), clear: vi.fn() },
}));

vi.mock('../../services/backgroundPlaybackService', () => ({
  backgroundPlaybackService: {
    init: vi.fn(),
    registerAudioElement: vi.fn(),
    onInterruption: vi.fn(),
    onReconnect: vi.fn(),
    onBackgroundChange: vi.fn(),
    getIsBackground: vi.fn(() => false),
  },
}));

vi.mock('../../services/backgroundAudio', () => ({
  backgroundAudio: {
    onMediaAction: vi.fn(() => Promise.resolve()),
    startService: vi.fn(() => Promise.resolve()),
    updateMetadata: vi.fn(() => Promise.resolve()),
    updatePlaybackState: vi.fn(() => Promise.resolve()),
    getPlaybackState: vi.fn(() => Promise.resolve({ nativeActive: false })),
    acknowledgeEnded: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../../services/preloadService', () => ({
  preloadNextSongs: vi.fn(() => Promise.resolve()),
  prewarmOnFirstInteraction: vi.fn(),
}));

vi.mock('../../stores/downloadsStore', () => ({
  useDownloadsStore: { getState: () => ({ getBlobUrl: () => null }) },
}));

vi.mock('../../stores/historyStore', () => ({
  useHistoryStore: { getState: () => ({ addSong: vi.fn() }) },
}));

// UI-side mocks: the download state machine, the cached-image component, the
// layout-measuring hook, and the panel content are not under test here.
vi.mock('../../components/DownloadButton', () => ({
  useSongDownloadState: () => ({
    key: '',
    state: 'idle' as const,
    progress: null,
    errorMessage: null,
    toggle: vi.fn(),
  }),
}));

vi.mock('../../components/CachedImage', () => ({
  default: (props: { src?: string; alt?: string; className?: string }) =>
    props.src
      ? <img src={props.src} alt={props.alt || ''} className={props.className} />
      : null,
}));

vi.mock('../../hooks/usePlayerLayout', () => ({ usePlayerLayout: () => {} }));

vi.mock('./controls/EqualizerUI', () => ({ EqualizerUI: () => <div>EQ</div> }));
vi.mock('./QueuePanel', () => ({ QueuePanel: () => <div>QUEUE</div> }));

import { Player } from './Player';
import { useAudioStore } from '../../stores/audioStore';
import { useQueueStore } from '../../stores/queueStore';
import type { Song } from '../../types/music';

// rAF polyfill — jsdom has no frame loop; back it with setTimeout so the
// progress bar's (song-gated) effect can mount without crashing.
(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 16) as unknown as number;
(globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);

function makeSong(id: string, overrides: Partial<Song> = {}): Song {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 200,
    genre: 'Pop',
    coverArt: '',
    audioUrl: '',
    youtubeId: id,
    provider: 'youtube' as const,
    releaseYear: 2020,
    ...overrides,
  };
}

interface PlaybackSlice {
  currentSong: Song | null;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  progress: number;
  duration: number;
}

/** Reset playback + queue state to a known baseline before each scenario. */
function setPlaybackState(partial: Partial<PlaybackSlice>): void {
  useAudioStore.setState({
    currentSong: null,
    isPlaying: false,
    isLoading: false,
    error: null,
    progress: 0,
    duration: 0,
    ...partial,
  });
  useQueueStore.setState({
    queue: [],
    currentIndex: 0,
    isShuffled: true, // prove the UI does NOT show active shuffle when idle
    repeatMode: 'all', // prove the UI does NOT show active repeat when idle
    originalQueue: [],
  } as Partial<ReturnType<typeof useQueueStore.getState>>);
}

/** The button wrapping a lucide icon (e.g. 'lucide-play'). */
const btnFor = (container: HTMLElement, icon: string): HTMLButtonElement | null =>
  container.querySelector(`svg.${icon}`)?.closest('button') ?? null;

/** The two time readouts in the progress row (current / total). */
const timeReadouts = (container: HTMLElement): Element[] =>
  Array.from(container.querySelectorAll('.font-mono'));

beforeEach(() => {
  setPlaybackState({});
});

describe('Player — idle state (no track)', () => {
  it('shows a clean "Nothing playing" state', () => {
    render(<Player />);

    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
  });

  it('hides the progress row entirely (no 0:00 / 0:00 readout)', () => {
    render(<Player />);

    expect(document.querySelector('.font-mono')).toBeNull();
  });

  it('disables every transport control and shows no pause icon', () => {
    const { container } = render(<Player />);

    expect(container.querySelector('svg.lucide-pause')).toBeNull();
    expect(btnFor(container, 'lucide-play')).toBeDisabled();
    expect(btnFor(container, 'lucide-skip-back')).toBeDisabled();
    expect(btnFor(container, 'lucide-skip-forward')).toBeDisabled();
  });

  it('does not show an active shuffle/repeat state and cannot toggle them', () => {
    const { container } = render(<Player />);

    const shuffle = btnFor(container, 'lucide-shuffle');
    expect(shuffle).toBeDisabled();
    expect(shuffle).not.toHaveClass('from-violet-500');

    const repeat = btnFor(container, 'lucide-repeat');
    expect(repeat).toBeDisabled();
    expect(repeat).not.toHaveClass('from-emerald-500');
  });

  it('offers no mobile expand affordance', () => {
    const { container } = render(<Player />);

    expect(container.querySelector('[aria-label="Expand player"]')).toBeNull();
    expect(screen.queryByText('Now Playing')).toBeNull();
  });
});

describe('Player — track loaded but paused', () => {
  it('restores the full player: title, duration, enabled transport', () => {
    const song = makeSong('s1', { duration: 200 });
    setPlaybackState({ currentSong: song, isPlaying: false, duration: 200 });

    const { container } = render(<Player />);

    expect(screen.getByText('Song s1')).toBeInTheDocument();
    expect(screen.queryByText('Nothing playing')).not.toBeInTheDocument();

    // Duration shown: 0:00 current / 3:20 total (200s).
    const times = timeReadouts(container);
    expect(times.length).toBe(2);
    expect(times[0].textContent).toBe('0:00');
    expect(times[1].textContent).toBe('3:20');

    // Paused → play icon, transport enabled, shuffle/repeat enabled again.
    expect(container.querySelector('svg.lucide-pause')).toBeNull();
    expect(btnFor(container, 'lucide-play')).toBeEnabled();
    expect(btnFor(container, 'lucide-skip-back')).toBeEnabled();
    expect(btnFor(container, 'lucide-shuffle')).toBeEnabled();
    expect(btnFor(container, 'lucide-repeat')).toBeEnabled();
  });

  it('reflects active shuffle/repeat only when a track is loaded', () => {
    const song = makeSong('s2');
    setPlaybackState({ currentSong: song, duration: 200 });

    const { container } = render(<Player />);

    expect(btnFor(container, 'lucide-shuffle')).toHaveClass('from-violet-500');
    expect(btnFor(container, 'lucide-repeat')).toHaveClass('from-emerald-500');
  });
});

describe('Player — track playing', () => {
  it('shows the pause icon and live progress', () => {
    const song = makeSong('s3', { duration: 200 });
    setPlaybackState({ currentSong: song, isPlaying: true, progress: 65, duration: 200 });

    const { container } = render(<Player />);

    expect(container.querySelector('svg.lucide-pause')).not.toBeNull();
    expect(container.querySelector('svg.lucide-play')).toBeNull();
    const times = timeReadouts(container);
    expect(times[0].textContent).toBe('1:05');
    expect(times[1].textContent).toBe('3:20');
  });
});

describe('Player — track ended', () => {
  it('stays on the finished track (paused at full duration), never idle', () => {
    const song = makeSong('s4', { duration: 200 });
    setPlaybackState({ currentSong: song, isPlaying: false, progress: 200, duration: 200 });

    const { container } = render(<Player />);

    expect(screen.queryByText('Nothing playing')).not.toBeInTheDocument();
    expect(screen.getByText('Song s4')).toBeInTheDocument();

    // Paused-at-end: play icon, full duration, no pause icon.
    expect(container.querySelector('svg.lucide-pause')).toBeNull();
    expect(btnFor(container, 'lucide-play')).toBeEnabled();
    const times = timeReadouts(container);
    expect(times[0].textContent).toBe('3:20');
    expect(times[1].textContent).toBe('3:20');
  });
});

describe('Player — track removed', () => {
  it('returns to the idle state when the current track is cleared', async () => {
    const song = makeSong('s5', { duration: 200 });
    setPlaybackState({ currentSong: song, isPlaying: true, progress: 30, duration: 200 });

    const { container } = render(<Player />);
    expect(screen.getByText('Song s5')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-pause')).not.toBeNull();

    // Removal (stop/clear): no song, playback fully reset.
    await act(async () => {
      setPlaybackState({ currentSong: null, isPlaying: false, progress: 0, duration: 0 });
    });

    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
    expect(container.querySelector('.font-mono')).toBeNull();
    expect(container.querySelector('svg.lucide-pause')).toBeNull();
    expect(btnFor(container, 'lucide-play')).toBeDisabled();
    expect(btnFor(container, 'lucide-shuffle')).toBeDisabled();
  });
});

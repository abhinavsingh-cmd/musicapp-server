import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DownloadButton, useSongDownloadState } from './DownloadButton';
import { useDownloadsStore } from '../stores/downloadsStore';
import { Song } from '../types/music';

// ---------------------------------------------------------------------------
// The ONE download button/state system used by every song row in the app.
// These tests pin the idle → downloading → downloaded / failed state machine
// and its tap semantics (start / cancel / retry) without touching IndexedDB.
// ---------------------------------------------------------------------------

const makeSong = (over: Partial<Song> = {}): Song => ({
  id: 'lib-1',
  youtubeId: 'yt-123',
  title: 'Test Song',
  artist: 'Tester',
  album: 'Album',
  duration: 200,
  genre: 'Pop',
  coverArt: '',
  audioUrl: '',
  releaseYear: 2024,
  ...over,
});

interface Fakes {
  downloadSong: ReturnType<typeof vi.fn>;
  cancelDownload: ReturnType<typeof vi.fn>;
  retryDownload: ReturnType<typeof vi.fn>;
}

function setupStore(opts: { downloaded?: boolean; downloading?: boolean } = {}): Fakes {
  const fakes: Fakes = {
    downloadSong: vi.fn(async () => {}),
    cancelDownload: vi.fn(),
    retryDownload: vi.fn(),
  };
  useDownloadsStore.setState({
    downloads: [],
    downloadingIds: new Set(),
    progressMap: {},
    failedDownloads: [],
    isDownloaded: () => opts.downloaded ?? false,
    isDownloading: () => opts.downloading ?? false,
    downloadSong: fakes.downloadSong as never,
    cancelDownload: fakes.cancelDownload as never,
    retryDownload: fakes.retryDownload as never,
  });
  return fakes;
}

beforeEach(() => {
  setupStore();
});

describe('DownloadButton', () => {
  it('renders an always-visible idle button and starts a download on tap', () => {
    const fakes = setupStore();
    render(<DownloadButton song={makeSong()} />);

    const btn = screen.getByRole('button', { name: /download test song/i });
    expect(btn).toHaveAttribute('data-state', 'idle');
    // Must not be hidden behind hover/opacity gating (mobile app).
    expect(btn.className).not.toMatch(/opacity-0/);

    fireEvent.click(btn);
    expect(fakes.downloadSong).toHaveBeenCalledTimes(1);
    expect(fakes.downloadSong.mock.calls[0][0]).toMatchObject({ youtubeId: 'yt-123' });
  });

  it('shows a spinner while downloading and cancels on tap', () => {
    const fakes = setupStore({ downloading: true });
    render(<DownloadButton song={makeSong()} />);

    const btn = screen.getByRole('button', { name: /downloading test song/i });
    expect(btn).toHaveAttribute('data-state', 'downloading');
    expect(btn.querySelector('.animate-spin')).not.toBeNull();

    fireEvent.click(btn);
    expect(fakes.cancelDownload).toHaveBeenCalledTimes(1);
    expect(fakes.cancelDownload).toHaveBeenCalledWith('yt-123');
    expect(fakes.downloadSong).not.toHaveBeenCalled();
  });

  it('includes live progress percentage in the accessible label', () => {
    setupStore({ downloading: true });
    useDownloadsStore.setState({
      progressMap: { 'yt-123': { loaded: 42, total: 100, percent: 42 } },
    });
    render(<DownloadButton song={makeSong()} />);

    expect(screen.getByRole('button', { name: /42%/ })).toBeTruthy();
  });

  it('renders the downloaded state as an inert checkmark', () => {
    const fakes = setupStore({ downloaded: true });
    render(<DownloadButton song={makeSong()} />);

    const btn = screen.getByRole('button', { name: /downloaded/i });
    expect(btn).toHaveAttribute('data-state', 'downloaded');
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    expect(fakes.downloadSong).not.toHaveBeenCalled();
    expect(fakes.retryDownload).not.toHaveBeenCalled();
  });

  it('renders a retry state with the preserved error reason and retries on tap', () => {
    const fakes = setupStore();
    const song = makeSong();
    useDownloadsStore.setState({
      failedDownloads: [{ song, message: 'Download failed: network error', timestamp: Date.now() }],
    });
    render(<DownloadButton song={song} />);

    const btn = screen.getByRole('button', { name: /download failed.*network error.*retry/i });
    expect(btn).toHaveAttribute('data-state', 'failed');

    fireEvent.click(btn);
    expect(fakes.retryDownload).toHaveBeenCalledTimes(1);
    expect(fakes.retryDownload.mock.calls[0][0]).toMatchObject({ youtubeId: 'yt-123' });
    expect(fakes.downloadSong).not.toHaveBeenCalled();
  });

  it('uses the most recent failure when a song failed multiple times', () => {
    setupStore();
    const song = makeSong();
    useDownloadsStore.setState({
      failedDownloads: [
        { song, message: 'first attempt error', timestamp: 1 },
        { song, message: 'final attempt error', timestamp: 2 },
      ],
    });
    render(<DownloadButton song={song} />);

    expect(screen.getByRole('button', { name: /final attempt error/i })).toBeTruthy();
  });

  it('renders nothing for a song that cannot be downloaded', () => {
    setupStore();
    const { container } = render(<DownloadButton song={makeSong({ youtubeId: undefined, audioUrl: '' })} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not leak the tap into the row click handler (stopPropagation)', () => {
    setupStore();
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <DownloadButton song={makeSong()} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /download test song/i }));
    expect(rowClick).not.toHaveBeenCalled();
  });
});

describe('useSongDownloadState', () => {
  const probe: { current: ReturnType<typeof useSongDownloadState> | null } = { current: null };
  const Probe = ({ song }: { song: Song | null }) => {
    probe.current = useSongDownloadState(song);
    return null;
  };

  it('reports unavailable for null songs', () => {
    setupStore();
    render(<Probe song={null} />);
    expect(probe.current?.state).toBe('unavailable');
  });

  it('prioritizes downloaded over downloading over failed', () => {
    setupStore({ downloaded: true, downloading: true });
    const song = makeSong();
    useDownloadsStore.setState({
      failedDownloads: [{ song, message: 'boom', timestamp: Date.now() }],
    });
    render(<Probe song={song} />);
    expect(probe.current?.state).toBe('downloaded');
  });
});

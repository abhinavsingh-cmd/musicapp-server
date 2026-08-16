/**
 * Regression proof for the "stuck on Searching YouTube..." bug.
 *
 * The bug: after a successful first page, the sentinel's IntersectionObserver
 * re-fired loadMore() from FAILURE states. A failed page (~33s of deadlines
 * when the backend is down) set ytStatus back to 'loading' every time the
 * observer re-created, so the spinner looped forever.
 *
 * This test drives the REAL SearchPage + REAL searchStore through the exact
 * sequence: search succeeds (20 rows, hasMore) -> sentinel visible ->
 * loadMore fires -> paging FAILS -> the observer fires again. It asserts:
 *   1. the failure banner appears (error state is shown, spinner is gone)
 *   2. the observer does NOT re-fire loadMore from the failure state
 *   3. ytStatus stays terminal — the spinner can never return without a
 *      user action (Retry / new query).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TimeoutError } from '../config/api';
import type { Track } from '../providers/types';

vi.mock('../providers/search', () => ({ searchProviders: vi.fn() }));
vi.mock('../services/librarySearchIndex', () => ({
  initLibrarySearchIndex: vi.fn(),
  librarySearchIndex: { search: vi.fn(async () => []), suggest: vi.fn(async () => []) },
}));
vi.mock('../services/metricsCollector', () => ({ metricsCollector: { pushSearchLatency: vi.fn() } }));
vi.mock('../components/SongContextMenu', () => ({
  useSongContextMenu: () => ({
    handleContextMenu: () => {},
    handleLongPress: () => {},
    ContextMenu: () => null,
  }),
}));
vi.mock('../features/library/SongTable', () => ({
  SongTable: () => <div data-testid="song-table" />,
}));
vi.mock('../components/DownloadButton', () => ({
  DownloadButton: () => <button type="button">dl</button>,
}));

import { SearchPage } from './SearchPage';
import { useSearchStore } from '../stores/searchStore';
import { searchProviders } from '../providers/search';
import { librarySearchIndex } from '../services/librarySearchIndex';

// ---- IntersectionObserver stub (jsdom has none) ----
class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = [];
  callback: IntersectionObserverCallback;
  elements: Element[] = [];
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    IntersectionObserverStub.instances.push(this);
  }
  observe(el: Element) { this.elements.push(el); }
  unobserve() {}
  disconnect() {}
  /** Fire the callback as if the observed sentinel is now visible. */
  trigger() {
    this.callback(
      this.elements.map((el) => ({ isIntersecting: true, target: el })) as unknown as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }
  static latest() {
    return IntersectionObserverStub.instances[IntersectionObserverStub.instances.length - 1];
  }
}

function makeTrack(id: string): Track {
  return {
    id,
    externalId: id,
    title: `Track ${id}`,
    artist: 'Artist',
    album: '',
    duration: 200,
    artwork: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
    playCount: 0,
  } as unknown as Track;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e?: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const ytResult = (tracks: Track[]) => [{ providerId: 'youtube' as const, providerName: 'YouTube', tracks }];

const pending = new Map<string, Deferred<ReturnType<typeof ytResult>>>();

beforeEach(() => {
  IntersectionObserverStub.instances = [];
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  vi.useFakeTimers();
  pending.clear();
  useSearchStore.getState().clear();
  (searchProviders as unknown as ReturnType<typeof vi.fn>).mockImplementation((query: string) => {
    const d = deferred<ReturnType<typeof ytResult>>();
    pending.set(query, d);
    return d.promise;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function tick() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

describe('SearchPage — no permanent "Searching YouTube..." spinner', () => {
  it('a failed loadMore shows the error banner and the observer never re-fires it', async () => {
    render(
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>,
    );

    // Type a query; let the 300ms debounce fire.
    const input = screen.getByPlaceholderText(/search songs, artists/i);
    fireEvent.change(input, { target: { value: 'arijit' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await tick();
    await tick();

    // First search succeeds with 20 rows -> 15 shown, hasMore=true.
    const many = Array.from({ length: 20 }, (_, i) => makeTrack(`v-${i}`));
    await act(async () => { pending.get('arijit')!.resolve(ytResult(many)); });
    await tick();
    await tick();

    const s1 = useSearchStore.getState();
    expect(s1.ytStatus).toBe('success');
    expect(s1.hasMore).toBe(true);

    // Expire the 60s in-memory YT cache so the paging request must hit the
    // network (like the first page did).
    await vi.advanceTimersByTimeAsync(61_000);
    await tick();

    // Sentinel is visible -> observer fires -> loadMore hits the network.
    IntersectionObserverStub.latest().trigger();
    await tick();
    await tick();
    expect(useSearchStore.getState().ytStatus).toBe('loading');
    expect((searchProviders as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);

    // The paging request FAILS (backend down — the wedged-network worst case).
    await act(async () => { pending.get('arijit')!.reject(new TimeoutError('http://x/api/youtube/search')); });
    await tick();
    await tick();
    await vi.advanceTimersByTimeAsync(0);

    // Spinner must be GONE; the failure banner (with Retry) must be visible.
    expect(screen.queryByText(/searching youtube\.\.\./i)).not.toBeInTheDocument();
    expect(screen.getByText(/youtube search timed out/i)).toBeInTheDocument();
    expect(useSearchStore.getState().ytStatus).toBe('timeout');

    // The effect re-created the observer when ytStatus changed (sentinel
    // still in the DOM, still "visible"). It must NOT re-fire loadMore from
    // a failure state — otherwise the spinner loops forever.
    const callsBefore = (searchProviders as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    IntersectionObserverStub.latest().trigger();
    await tick();
    await tick();

    const callsAfter = (searchProviders as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
    expect(useSearchStore.getState().ytStatus).toBe('timeout'); // still terminal
    expect(screen.queryByText(/searching youtube\.\.\./i)).not.toBeInTheDocument();

    // A user retry (banner Retry) DOES start a fresh search — that's the
    // intended escape hatch, and it is bounded like any other search.
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await tick();
    expect(useSearchStore.getState().ytStatus).toBe('retrying');
    await act(async () => { pending.get('arijit')!.resolve(ytResult(many)); });
    await tick();
    await tick();
    expect(useSearchStore.getState().ytStatus).toBe('success');
  });

  it('the spinner shows during a genuine first load and leaves when results arrive', async () => {
    render(
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>,
    );
    const input = screen.getByPlaceholderText(/search songs, artists/i);
    fireEvent.change(input, { target: { value: 'atif' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await tick();

    expect(screen.getByText(/searching youtube\.\.\./i)).toBeInTheDocument();

    await act(async () => { pending.get('atif')!.resolve(ytResult([makeTrack('a1')])); });
    await tick();
    await tick();
    expect(screen.queryByText(/searching youtube\.\.\./i)).not.toBeInTheDocument();
    expect(useSearchStore.getState().ytStatus).toBe('success');
  });

  it('shows an explicit "no YouTube results" state when YouTube returns empty', async () => {
    render(
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>,
    );
    const input = screen.getByPlaceholderText(/search songs, artists/i);
    // The LIBRARY half succeeds (results on screen) while YouTube returns
    // ZERO rows — the YouTube section must render its own explicit
    // "no results" state instead of hiding or spinning forever.
    (librarySearchIndex.search as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{
      song: { id: 'lib-1', title: 'Library Hit', artist: 'Me', genre: 'Pop', duration: 200, coverArt: '', youtubeId: 'lib-1' },
    }]);
    fireEvent.change(input, { target: { value: 'nonexistent' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await tick();

    await act(async () => { pending.get('nonexistent')!.resolve(ytResult([])); });
    await tick();
    await tick();

    const s = useSearchStore.getState();
    expect(s.status).toBe('success'); // library half succeeded
    expect(s.ytStatus).toBe('empty'); // YouTube answered with zero rows
    expect(screen.queryByText(/searching youtube\.\.\./i)).not.toBeInTheDocument();
    expect(screen.getByText(/no youtube results found/i)).toBeInTheDocument();
  });

  it('re-focusing the input never re-fires an identical completed search', async () => {
    render(
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>,
    );
    const input = screen.getByPlaceholderText(/search songs, artists/i);
    fireEvent.change(input, { target: { value: 'atif' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await tick();

    await act(async () => { pending.get('atif')!.resolve(ytResult([makeTrack('a1')])); });
    await tick();
    await tick();
    expect(useSearchStore.getState().ytStatus).toBe('success');

    const callsBefore = (searchProviders as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    // Focus flips showSuggestions, which re-runs the search effect — the
    // component's query-change guard must absorb the identical query.
    fireEvent.focus(input);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await tick();

    const callsAfter = (searchProviders as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
    expect(useSearchStore.getState().ytStatus).toBe('success');
  });
});

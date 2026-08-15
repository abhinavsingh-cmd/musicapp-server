import { memo, useCallback, useMemo } from 'react';
import { Download, Check, Loader2, RotateCw } from 'lucide-react';
import { Song } from '../types/music';
import { useDownloadsStore } from '../stores/downloadsStore';
import { sourceKey, isDownloadable } from '../services/musicSource';
import type { DownloadProgress } from '../utils/downloadManager';
import { cn } from '../utils/cn';

/**
 * Single source of truth for per-song download UI state.
 *
 * Every song row in the app (library, search, charts, playlists, queue,
 * history, player) derives its download button from this hook so the
 * idle → downloading → downloaded / failed state machine is implemented
 * exactly once. A song is downloadable when it has a YouTube id (server
 * download endpoint) or a direct audioUrl (library stream).
 */
export type SongDownloadState = 'unavailable' | 'idle' | 'downloading' | 'downloaded' | 'failed';

export interface SongDownloadStatus {
  key: string;
  state: SongDownloadState;
  progress: DownloadProgress | null;
  errorMessage: string | null;
  toggle: () => void;
}

export function useSongDownloadState(song: Song | null | undefined): SongDownloadStatus {
  const key = song ? sourceKey(song) : '';
  const downloadable = !!song && isDownloadable(song);

  // Primitive selectors — rows only re-render when THEIR song changes.
  const downloaded = useDownloadsStore((s) => (downloadable && key ? s.isDownloaded(key) : false));
  const downloading = useDownloadsStore((s) => (downloadable && key ? s.isDownloading(key) : false));
  const failedEntry = useDownloadsStore((s) => {
    if (!downloadable || !key) return null;
    // Latest entry wins if the same song failed more than once.
    for (let i = s.failedDownloads.length - 1; i >= 0; i--) {
      const f = s.failedDownloads[i];
      if (f && sourceKey(f.song) === key) return f;
    }
    return null;
  });
  const progress = useDownloadsStore((s) => (downloading && key ? s.progressMap[key] ?? null : null));
  const downloadSong = useDownloadsStore((s) => s.downloadSong);
  const cancelDownload = useDownloadsStore((s) => s.cancelDownload);
  const retryDownload = useDownloadsStore((s) => s.retryDownload);

  const state: SongDownloadState = !downloadable
    ? 'unavailable'
    : downloaded
      ? 'downloaded'
      : downloading
        ? 'downloading'
        : failedEntry
          ? 'failed'
          : 'idle';

  const toggle = useCallback(() => {
    if (!song || !downloadable) return;
    if (downloading) cancelDownload(key);
    else if (failedEntry) retryDownload(song);
    else if (!downloaded) void downloadSong(song);
  }, [song, downloadable, downloading, failedEntry, downloaded, key, cancelDownload, retryDownload, downloadSong]);

  return useMemo(
    () => ({ key, state, progress, errorMessage: failedEntry?.message ?? null, toggle }),
    [key, state, progress, failedEntry, toggle],
  );
}

export interface DownloadButtonProps {
  song: Song;
  /** Icon size in px (default 14 — matches compact song rows). */
  size?: number;
  /** Extra classes merged onto the button (e.g. larger hit-area variants). */
  className?: string;
  /** Stop click propagation so the row's play handler doesn't fire (default true). */
  stopPropagation?: boolean;
}

/**
 * The one download button used by every song row. Always visible — never
 * gated behind hover states (this is a mobile-first app). Tap behavior:
 * idle → start download, downloading → cancel, failed → retry,
 * downloaded → inert (checkmark).
 */
export const DownloadButton = memo(function DownloadButton({
  song,
  size = 14,
  className,
  stopPropagation = true,
}: DownloadButtonProps) {
  const { state, progress, errorMessage, toggle } = useSongDownloadState(song);

  if (state === 'unavailable') return null;

  const percent = progress && progress.total > 0 ? Math.floor(progress.percent) : null;
  const label =
    state === 'downloaded'
      ? `Downloaded: ${song.title}`
      : state === 'downloading'
        ? percent !== null
          ? `Downloading ${song.title} — ${percent}% — tap to cancel`
          : `Downloading ${song.title} — tap to cancel`
        : state === 'failed'
          ? `Download failed${errorMessage ? `: ${errorMessage}` : ''} — tap to retry`
          : `Download ${song.title}`;

  return (
    <button
      type="button"
      data-state={state}
      aria-label={label}
      title={label}
      disabled={state === 'downloaded'}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        toggle();
      }}
      className={cn(
        // Always visible with a comfortable touch target — no hover gating.
        'p-1.5 rounded-lg transition-all flex items-center justify-center flex-shrink-0',
        state === 'downloaded' && 'text-emerald-400',
        state === 'downloading' && 'text-violet-400',
        state === 'failed' && 'text-red-400',
        state === 'idle' && 'text-gray-500 active:text-violet-400 active:bg-white/5',
        className,
      )}
    >
      {state === 'downloaded' ? (
        <Check size={size} />
      ) : state === 'downloading' ? (
        <Loader2 size={size} className="animate-spin" />
      ) : state === 'failed' ? (
        <RotateCw size={size} />
      ) : (
        <Download size={size} />
      )}
    </button>
  );
});

export default DownloadButton;

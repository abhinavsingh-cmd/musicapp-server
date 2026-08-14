import { useEffect, useRef } from 'react';

/**
 * Measures the player bar height via ResizeObserver and sets
 * `--player-h` on :root. Also detects the on-screen keyboard
 * via VisualViewport and toggles `data-keyboard` on <html>
 * so CSS can hide the mobile bottom nav while typing.
 */
export function usePlayerLayout(playerRef: React.RefObject<HTMLDivElement | null>) {
  const rafRef = useRef(0);

  /* ── Measure player bar height ── */
  useEffect(() => {
    const el = playerRef.current;
    if (!el) return;

    const update = () => {
      const h = el.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--player-h', `${h}px`);
    };

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    });

    observer.observe(el);
    update();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [playerRef]);

  /* ── Keyboard detection via VisualViewport ── */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--keyboard-h', `${kb}px`);
      document.documentElement.toggleAttribute('data-keyboard', kb > 50);
    };

    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();

    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);
}

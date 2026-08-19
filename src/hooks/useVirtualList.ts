import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Fixed-height windowing for long lists. Mounting every row at once (each
 * with images + buttons) is a real OOM / crash source on low-end Android
 * WebViews — the library's 647+ rows used to all mount simultaneously. Only
 * the rows inside the nearest scrollable ancestor's viewport (±overscan)
 * are mounted; a spacer div preserves the full scroll height so page-level
 * scrolling is untouched.
 */
export interface VirtualWindow {
  start: number;
  end: number;
  totalHeight: number;
}

/** Nearest scrollable ancestor (or the document root as a fallback). */
export function findScrollParent(el: HTMLElement): HTMLElement {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = window.getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return document.documentElement;
}

interface UseVirtualListOptions {
  /** Extra rows mounted beyond the viewport on each side. Default 6. */
  overscan?: number;
  /**
   * An index that must stay mounted even when scrolled out of view — e.g. a
   * row being drag-reordered (dnd-kit) whose element must not unmount
   * mid-gesture as the window shifts.
   */
  includeIndex?: number | null;
  /** Rows mounted before the first layout measure. Default 40. */
  initialRender?: number;
}

export function useVirtualList(
  count: number,
  rowHeight: number,
  containerRef: RefObject<HTMLElement | null>,
  options: UseVirtualListOptions = {},
): VirtualWindow {
  const { overscan = 6, includeIndex = null, initialRender = 40 } = options;

  const [win, setWin] = useState<VirtualWindow>(() => ({
    start: 0,
    end: Math.min(count, initialRender),
    totalHeight: count * rowHeight,
  }));

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const parent = findScrollParent(el);
      const parentRect = parent.getBoundingClientRect();
      const viewportTop = parent === document.documentElement || parent === document.body ? 0 : parentRect.top;
      const visibleStart = viewportTop - el.getBoundingClientRect().top;
      const viewport = parent.clientHeight || window.innerHeight;
      let start = Math.max(0, Math.floor(visibleStart / rowHeight) - overscan);
      let end = Math.min(count, Math.ceil((visibleStart + viewport) / rowHeight) + overscan);
      if (includeIndex != null && includeIndex >= 0 && includeIndex < count) {
        start = Math.min(start, includeIndex);
        end = Math.max(end, includeIndex + 1);
      }
      setWin({ start, end, totalHeight: count * rowHeight });
    };

    compute();
    window.addEventListener('scroll', compute, { capture: true, passive: true });
    window.addEventListener('resize', compute);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(compute);
      ro.observe(el);
      const parent = findScrollParent(el);
      if (parent !== document.documentElement && parent !== document.body) ro.observe(parent);
    }
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
      ro?.disconnect();
    };
  }, [containerRef, rowHeight, count, overscan, includeIndex]);

  return win;
}

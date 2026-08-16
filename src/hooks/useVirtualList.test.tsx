/**
 * Unit tests for the fixed-height list virtualizer (useVirtualList).
 *
 * jsdom has no layout engine, so the harness mocks the geometry the hook
 * reads: the nearest scrollable ancestor's clientHeight + rect.top (the
 * viewport), the list container's rect.top (which moves with scrollTop),
 * and overflow-y/scrollHeight so findScrollParent picks the scroller. A
 * scroll event (dispatched in capture phase, like the real scroller fires)
 * then drives the recompute — exactly how the hook updates in the browser.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import { useVirtualList } from './useVirtualList';

afterEach(() => {
  vi.restoreAllMocks();
});

const ROW_HEIGHT = 56;

function makeRect(top: number, height: number): DOMRect {
  return {
    x: 0, y: top, top, left: 0, right: 800,
    bottom: top + height, width: 800, height,
    toJSON: () => ({}),
  } as DOMRect;
}

interface HarnessProps {
  count: number;
  rowHeight?: number;
  overscan?: number;
  includeIndex?: number | null;
  scrollTop?: number;
  viewportHeight?: number;
  scrollable?: boolean;
  /** Insert a plain (non-scrolling) wrapper between scroller and list. */
  nested?: boolean;
}

function Harness({
  count,
  rowHeight = ROW_HEIGHT,
  overscan,
  includeIndex,
  scrollTop = 0,
  viewportHeight = 600,
  scrollable = true,
  nested = false,
}: HarnessProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const win = useVirtualList(count, rowHeight, listRef, { overscan, includeIndex });

  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = scrollerRef.current;
    if (!list || !scroller) return;
    if (scrollable) {
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: viewportHeight });
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 100_000 });
      Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: scrollTop });
      vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(makeRect(0, viewportHeight));
    }
    // The list sits at the top of the scroller's content, so its rect top
    // moves up by exactly scrollTop.
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(makeRect(-scrollTop, viewportHeight));
    // Same capture-phase scroll event a real scrolling element dispatches.
    scroller.dispatchEvent(new Event('scroll'));
  }, [scrollTop, viewportHeight, scrollable]);

  return (
    <div ref={scrollerRef} data-testid="scroller" style={{ overflowY: scrollable ? 'auto' : 'visible' }}>
      {nested ? <div>{renderList(listRef, win, count, rowHeight)}</div> : renderList(listRef, win, count, rowHeight)}
    </div>
  );
}

function renderList(
  listRef: React.RefObject<HTMLDivElement | null>,
  win: { start: number; end: number; totalHeight: number },
  _count: number,
  _rowHeight: number,
) {
  return (
    <div ref={listRef} data-testid="win" data-win={JSON.stringify(win)} style={{ height: win.totalHeight }} />
  );
}

function getWin(): { start: number; end: number; totalHeight: number } {
  return JSON.parse(screen.getByTestId('win').getAttribute('data-win')!);
}

describe('useVirtualList — window math', () => {
  it('at the top of a long list mounts only the visible window plus overscan', () => {
    render(<Harness count={100} viewportHeight={600} />);
    // ceil(600/56)=11 visible + 6 overscan; start clamps at 0.
    expect(getWin()).toEqual({ start: 0, end: 17, totalHeight: 5600 });
  });

  it('tracks the scroll position: floor/ceil over scrollTop with overscan both sides', () => {
    render(<Harness count={100} scrollTop={560} viewportHeight={600} />);
    // Row 10 is at the viewport top: start=10-6=4, end=ceil(1160/56)+6=27.
    expect(getWin()).toEqual({ start: 4, end: 27, totalHeight: 5600 });
  });

  it('at the bottom the last rows are mounted and end never exceeds count', () => {
    render(<Harness count={100} scrollTop={5000} viewportHeight={600} />);
    const win = getWin();
    expect(win.start).toBe(83); // floor(5000/56)-6
    expect(win.end).toBe(100); // clamped to count
    expect(win.totalHeight).toBe(5600);
  });

  it('handles fractional scroll positions by flooring to the row boundary', () => {
    render(<Harness count={100} scrollTop={28} viewportHeight={600} />);
    // Half-way down row 0: start=floor(28/56)-6=0, end=ceil(628/56)+6=18.
    expect(getWin()).toEqual({ start: 0, end: 18, totalHeight: 5600 });
  });

  it('renders every row when the list is shorter than the viewport', () => {
    render(<Harness count={8} viewportHeight={600} />);
    expect(getWin()).toEqual({ start: 0, end: 8, totalHeight: 448 });
  });

  it('produces a zero-height window for an empty list without crashing', () => {
    render(<Harness count={0} />);
    expect(getWin()).toEqual({ start: 0, end: 0, totalHeight: 0 });
  });

  it('honors a custom row height (e.g. 80px search cards)', () => {
    render(<Harness count={100} rowHeight={80} viewportHeight={600} />);
    expect(getWin()).toEqual({ start: 0, end: 14, totalHeight: 8000 }); // ceil(600/80)+6
  });

  it('honors a custom overscan', () => {
    render(<Harness count={100} overscan={2} viewportHeight={600} />);
    expect(getWin()).toEqual({ start: 0, end: 13, totalHeight: 5600 }); // ceil(600/56)+2
  });
});

describe('useVirtualList — includeIndex (dnd drag pinning)', () => {
  it('keeps an off-screen row mounted when it is being dragged', () => {
    render(<Harness count={100} includeIndex={50} />);
    // Visible window is [0,17) at the top; includeIndex must extend end past 50.
    const win = getWin();
    expect(win.start).toBe(0);
    expect(win.end).toBeGreaterThanOrEqual(51);
  });

  it('keeps a dragged row near the top mounted while scrolled to the bottom', () => {
    render(<Harness count={100} scrollTop={5000} includeIndex={2} />);
    const win = getWin();
    expect(win.start).toBeLessThanOrEqual(2);
    expect(win.end).toBe(100);
  });

  it('ignores an includeIndex outside the list bounds', () => {
    render(<Harness count={100} includeIndex={150} />);
    expect(getWin().end).toBe(17); // unchanged from the normal top window
  });
});

describe('useVirtualList — scroll parent detection', () => {
  it('falls back to the document scroller when no ancestor scrolls', () => {
    render(<Harness count={100} scrollTop={560} viewportHeight={600} scrollable={false} />);
    // Without a scrollable ancestor the viewport is the window itself
    // (jsdom's innerHeight is 768): end=ceil((560+768)/56)+6=30.
    expect(getWin()).toEqual({ start: 4, end: 30, totalHeight: 5600 });
  });

  it('finds the nearest scrollable ancestor through a plain wrapper', () => {
    render(<Harness count={100} scrollTop={560} viewportHeight={600} nested />);
    expect(getWin()).toEqual({ start: 4, end: 27, totalHeight: 5600 });
  });

  it('recomputes when a scroll event fires on the scroller (capture phase)', () => {
    render(<Harness count={100} viewportHeight={600} />);
    expect(getWin().end).toBe(17);

    // Simulate scrolling to row 10: move the scroller + list rects, then fire
    // the element scroll event the browser would dispatch.
    const scroller = screen.getByTestId('scroller');
    const list = screen.getByTestId('win');
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 560 });
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(makeRect(-560, 600));
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(getWin()).toEqual({ start: 4, end: 27, totalHeight: 5600 });
  });
});

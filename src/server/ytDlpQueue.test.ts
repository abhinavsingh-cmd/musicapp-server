import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal replica of server.cjs priority gate logic for unit testing
// Keep in sync with server.cjs PRIORITY and insertByPriority
const PRIORITY = { PLAY: 0, PRELOAD: 1, BACKGROUND: 2 } as const;

type Job = () => void;

class PriorityGate {
  private max: number;
  private active = 0;
  private queue: Array<{ job: Job; priority: number; seq: number; timer: ReturnType<typeof setTimeout> | null; id: string | null }> = [];
  private seq = 0;
  constructor(max: number) { this.max = max; }
  private insert(item: typeof this.queue[0]) {
    const idx = this.queue.findIndex(q => q.priority > item.priority || (q.priority === item.priority && q.seq > item.seq));
    if (idx === -1) this.queue.push(item);
    else this.queue.splice(idx, 0, item);
  }
  acquire(cb: Job, opts: { priority?: number; id?: string; queueTimeoutMs?: number; onQueuedTooLong?: () => void } = {}) {
    const priority = opts.priority ?? PRIORITY.BACKGROUND;
    const seq = this.seq++;
    const job = () => { this.active++; cb(); };
    if (this.active >= this.max) {
      const item = { job, priority, seq, timer: null as any, id: opts.id ?? null };
      if (opts.queueTimeoutMs && opts.onQueuedTooLong) {
        item.timer = setTimeout(() => {
          const idx = this.queue.indexOf(item);
          if (idx === -1) return;
          this.queue.splice(idx, 1);
          opts.onQueuedTooLong!();
        }, opts.queueTimeoutMs);
      }
      this.insert(item);
    } else job();
  }
  release() {
    this.active--;
    const next = this.queue.shift();
    if (!next) return;
    if (next.timer) clearTimeout(next.timer);
    next.job();
  }
  cancelPreloads() {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].priority === PRIORITY.PRELOAD) {
        const it = this.queue[i];
        if (it.timer) clearTimeout(it.timer);
        this.queue.splice(i, 1);
      }
    }
  }
  cancelById(id: string) {
    let n = 0;
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].id === id) { if (this.queue[i].timer) clearTimeout(this.queue[i].timer); this.queue.splice(i, 1); n++; }
    return n;
  }
  get queuedIds() { return this.queue.map(q => q.id); }
  get activeCount() { return this.active; }
  get queuedCount() { return this.queue.length; }
}

describe('yt-dlp priority gate', () => {
  let gate: PriorityGate;
  beforeEach(() => { gate = new PriorityGate(1); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllTimers(); });

  it('playback while queue is empty runs immediately', () => {
    const order: string[] = [];
    gate.acquire(() => order.push('play'), { priority: PRIORITY.PLAY, id: 'play:1' });
    expect(order).toEqual(['play']);
    expect(gate.activeCount).toBe(1);
    expect(gate.queuedCount).toBe(0);
  });

  it('playback while preload is running queues play behind running job, preload stays queued', () => {
    const order: string[] = [];
    // occupy slot with preload
    gate.acquire(() => order.push('preload-running'), { priority: PRIORITY.PRELOAD, id: 'preload:next' });
    expect(gate.activeCount).toBe(1);
    // queue a preload for next track
    gate.acquire(() => order.push('preload-queued'), { priority: PRIORITY.PRELOAD, id: 'preload:queued' });
    expect(gate.queuedCount).toBe(1);
    // playback arrives — should be inserted before preload-queued due to higher priority
    gate.acquire(() => order.push('play'), { priority: PRIORITY.PLAY, id: 'play:2' });
    expect(gate.queuedIds).toEqual(['play:2', 'preload:queued']); // play ahead of preload
    // release running preload
    gate.release();
    expect(order).toEqual(['preload-running', 'play']);
    // play still active, preload still queued
    expect(gate.queuedCount).toBe(1);
    gate.release();
    expect(order[2]).toBe('preload-queued');
  });

  it('playback while trending (background) is running preempts queued background', () => {
    const gate2 = new PriorityGate(1);
    const order: string[] = [];
    gate2.acquire(() => order.push('trending-running'), { priority: PRIORITY.BACKGROUND, id: 'search:trending' });
    gate2.acquire(() => order.push('search-queued'), { priority: PRIORITY.BACKGROUND, id: 'search:q2' });
    // play should jump ahead of queued background
    gate2.acquire(() => order.push('play'), { priority: PRIORITY.PLAY, id: 'play:3' });
    expect(gate2.queuedIds[0]).toBe('play:3');
    gate2.release(); // trending-running done -> play runs next
    expect(order[1]).toBe('play');
    gate2.release();
    expect(order[2]).toBe('search-queued');
  });

  it('multiple playback requests preserve FIFO among PLAY priority', () => {
    const order: string[] = [];
    gate.acquire(() => order.push('running'), { priority: PRIORITY.PLAY, id: 'play:0' });
    gate.acquire(() => order.push('play1'), { priority: PRIORITY.PLAY, id: 'play:1' });
    gate.acquire(() => order.push('play2'), { priority: PRIORITY.PLAY, id: 'play:2' });
    gate.acquire(() => order.push('play3'), { priority: PRIORITY.PLAY, id: 'play:3' });
    expect(gate.queuedIds).toEqual(['play:1', 'play:2', 'play:3']);
    gate.release(); expect(order[1]).toBe('play1');
    gate.release(); expect(order[2]).toBe('play2');
    gate.release(); expect(order[3]).toBe('play3');
  });

  it('queue cancellation via timeout drops job and calls onQueuedTooLong', () => {
    const onTimeout = vi.fn();
    gate.acquire(() => {}, { priority: PRIORITY.PLAY, id: 'play:running' });
    gate.acquire(() => {}, { priority: PRIORITY.BACKGROUND, id: 'search:to-timeout', queueTimeoutMs: 5000, onQueuedTooLong: onTimeout });
    expect(gate.queuedCount).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(gate.queuedCount).toBe(0);
    // release running — no queued job to run
    gate.release();
    expect(gate.activeCount).toBe(0);
  });

  it('stale preload cancellation removes only PRELOAD jobs', () => {
    gate.acquire(() => {}, { priority: PRIORITY.PLAY, id: 'play:running' });
    gate.acquire(() => {}, { priority: PRIORITY.PRELOAD, id: 'preload:a' });
    gate.acquire(() => {}, { priority: PRIORITY.PRELOAD, id: 'preload:b' });
    gate.acquire(() => {}, { priority: PRIORITY.BACKGROUND, id: 'search:x' });
    gate.acquire(() => {}, { priority: PRIORITY.PLAY, id: 'play:queued' });
    // order before cancel: play:queued (0) before preloads (1) before background (2)
    expect(gate.queuedIds).toEqual(['play:queued', 'preload:a', 'preload:b', 'search:x']);
    gate.cancelPreloads();
    expect(gate.queuedIds).toEqual(['play:queued', 'search:x']);
    // cancel by id
    gate.acquire(() => {}, { priority: PRIORITY.PRELOAD, id: 'preload:c' });
    expect(gate.cancelById('preload:c')).toBe(1);
    expect(gate.queuedIds.includes('preload:c')).toBe(false);
  });

  it('does not allow unlimited concurrency', () => {
    const gate3 = new PriorityGate(2);
    gate3.acquire(() => {}, { priority: PRIORITY.PLAY });
    gate3.acquire(() => {}, { priority: PRIORITY.PLAY });
    expect(gate3.activeCount).toBe(2);
    gate3.acquire(() => {}, { priority: PRIORITY.PLAY });
    gate3.acquire(() => {}, { priority: PRIORITY.PLAY });
    expect(gate3.activeCount).toBe(2);
    expect(gate3.queuedCount).toBe(2);
    gate3.release(); expect(gate3.activeCount).toBe(2); // one queued promoted
    gate3.release(); expect(gate3.activeCount).toBe(2);
    gate3.release(); expect(gate3.activeCount).toBe(1);
    gate3.release(); expect(gate3.activeCount).toBe(0);
  });
});

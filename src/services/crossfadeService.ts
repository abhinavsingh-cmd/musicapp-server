export class CrossfadeService {
  private _enabled = false;
  private _duration = 3; // seconds
  private listeners: Array<() => void> = [];

  get enabled(): boolean { return this._enabled; }
  get duration(): number { return this._duration; }

  toggle(): void {
    this._enabled = !this._enabled;
    this.notify();
  }

  setDuration(seconds: number): void {
    this._duration = Math.max(0, Math.min(12, seconds));
    this.notify();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private notify(): void {
    this.listeners.forEach(cb => cb());
  }
}

export const crossfadeService = new CrossfadeService();

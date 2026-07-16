export interface EQBand {
  frequency: number;
  gain: number;
  label: string;
}

const DEFAULT_BANDS: EQBand[] = [
  { frequency: 60, gain: 0, label: '60' },
  { frequency: 170, gain: 0, label: '170' },
  { frequency: 310, gain: 0, label: '310' },
  { frequency: 600, gain: 0, label: '600' },
  { frequency: 1000, gain: 0, label: '1K' },
  { frequency: 3000, gain: 0, label: '3K' },
  { frequency: 6000, gain: 0, label: '6K' },
  { frequency: 12000, gain: 0, label: '12K' },
  { frequency: 14000, gain: 0, label: '14K' },
  { frequency: 16000, gain: 0, label: '16K' },
];

export interface EQPreset {
  name: string;
  bands: number[]; // gains in dB
}

export const EQ_PRESETS: EQPreset[] = [
  { name: 'Flat', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'Bass Boost', bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { name: 'Treble Boost', bands: [0, 0, 0, 0, 0, 0, 2, 4, 5, 6] },
  { name: 'Rock', bands: [5, 4, 2, 0, -1, 0, 2, 4, 5, 5] },
  { name: 'Pop', bands: [-1, 2, 4, 5, 3, 0, -1, -1, 2, 3] },
  { name: 'Jazz', bands: [3, 2, 0, 2, -2, -2, 0, 2, 3, 4] },
  { name: 'Classical', bands: [4, 3, 2, 1, -1, 0, 0, 2, 3, 4] },
  { name: 'Hip Hop', bands: [5, 4, 2, 0, -1, 1, 0, 0, 2, 3] },
  { name: 'Electronic', bands: [5, 4, 2, 0, -2, 0, 2, 4, 5, 5] },
  { name: 'Vocal', bands: [-2, -1, 0, 3, 5, 5, 3, 1, 0, -1] },
];

export class EqualizerService {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private _gains: number[] = DEFAULT_BANDS.map(() => 0);
  private _enabled = false;
  private _preset = 'Flat';
  private listeners: Array<() => void> = [];

  async init(audioElement: HTMLAudioElement): Promise<void> {
    if (this.audioContext) return;

    this.audioContext = new AudioContext();
    this.sourceNode = this.audioContext.createMediaElementSource(audioElement);

    // Create 10 band filters
    const frequencies = DEFAULT_BANDS.map(b => b.frequency);
    let prevNode: AudioNode = this.sourceNode;

    for (let i = 0; i < frequencies.length; i++) {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = i === 0 ? 'lowshelf' : i === frequencies.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = frequencies[i];
      filter.gain.value = 0;
      filter.Q.value = 1.4;
      prevNode.connect(filter);
      prevNode = filter;
      this.filters.push(filter);
    }

    prevNode.connect(this.audioContext.destination);
  }

  setBand(index: number, gain: number): void {
    const clamped = Math.max(-12, Math.min(12, gain));
    this._gains[index] = clamped;
    if (this.filters[index] && this._enabled) {
      this.filters[index].gain.value = clamped;
    }
    this._preset = 'Custom';
    this.notify();
  }

  setPreset(presetName: string): void {
    const preset = EQ_PRESETS.find(p => p.name === presetName);
    if (!preset) return;

    this._preset = presetName;
    this._gains = [...preset.bands];

    if (this._enabled) {
      for (let i = 0; i < this.filters.length; i++) {
        this.filters[i].gain.value = preset.bands[i];
      }
    }
    this.notify();
  }

  toggle(): void {
    this._enabled = !this._enabled;
    if (!this._enabled) {
      for (const filter of this.filters) {
        filter.gain.value = 0;
      }
    } else {
      for (let i = 0; i < this.filters.length; i++) {
        this.filters[i].gain.value = this._gains[i];
      }
    }
    this.notify();
  }

  get enabled(): boolean { return this._enabled; }
  get preset(): string { return this._preset; }
  get gains(): number[] { return [...this._gains]; }

  subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private notify(): void {
    this.listeners.forEach(cb => cb());
  }
}

export const equalizerService = new EqualizerService();

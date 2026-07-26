const _DEV = import.meta.env.DEV;
function eqLog(...args: any[]) { if (_DEV) console.log('[Equalizer]', ...args); }

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
  private _supported = typeof AudioContext !== 'undefined';
  private listeners: Array<() => void> = [];
  private _audioElement: HTMLAudioElement | null = null;

  get supported(): boolean { return this._supported; }
  get audioContextState(): string {
    if (!this.audioContext) return 'null';
    return this.audioContext.state;
  }
  get isReady(): boolean {
    return this.audioContext !== null && this.sourceNode !== null;
  }

  async init(audioElement: HTMLAudioElement): Promise<void> {
    eqLog('init() called — existing context:', this.audioContext ? this.audioContext.state : 'null', 'sourceNode:', !!this.sourceNode, 'elementChanged:', this._audioElement !== null && this._audioElement !== audioElement);

    // Audio element changed — destroy old source node chain and recreate
    if (this.sourceNode && this._audioElement !== audioElement) {
      eqLog('init() — audio element changed, destroying old source chain');
      this.disconnectSourceChain();
    }

    // Already fully initialized with same element — just ensure running
    if (this.audioContext && this.sourceNode && this._audioElement === audioElement) {
      await this.resume();
      return;
    }

    if (!this._supported) return;

    try {
      // Create AudioContext if needed
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
        eqLog('init() — created AudioContext, state:', this.audioContext.state);
      }

      // CRITICAL: Resume BEFORE creating MediaElementAudioSourceNode.
      // If the context is suspended when createMediaElementSource() is called,
      // the source node captures the audio element but routes through a dead path —
      // time advances, events fire, but NO SOUND is heard.
      if (this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume();
          eqLog('init() — AudioContext resumed to:', this.audioContext.state);
        } catch (err) {
          eqLog('init() — AudioContext resume failed:', err);
          this.setupAutoResume();
        }
      }

      // ONLY create source node if context is actually running.
      // If it's still suspended, audio plays through the default path (no equalizer).
      // On next init() call (from playHtmlAudio), we'll try again.
      if (this.audioContext.state === 'running' && !this.sourceNode) {
        this.sourceNode = this.audioContext.createMediaElementSource(audioElement);
        this._audioElement = audioElement;
        eqLog('init() — MediaElementAudioSourceNode created');

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
        eqLog('init() — Equalizer chain connected to destination');
      } else if (this.audioContext.state !== 'running') {
        eqLog('init() — AudioContext NOT running, skipping equalizer (audio plays through default path)');
      }
    } catch (err) {
      eqLog('init() — FAILED:', err);
      // Don't set _supported = false — just skip equalizer for this playback.
      // Audio will play through the default HTMLAudioElement path (no equalizer).
    }
  }

  private autoResumeHandler: (() => void) | null = null;

  private setupAutoResume(): void {
    if (this.autoResumeHandler) return;
    this.autoResumeHandler = () => {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        eqLog('Auto-resuming AudioContext on user interaction');
        this.audioContext.resume().catch(() => {});
      }
      if (this.audioContext && this.audioContext.state === 'running') {
        this.removeAutoResume();
      }
    };
    const events = ['touchstart', 'click', 'keydown', 'mousedown'];
    for (const event of events) {
      try { document.addEventListener(event, this.autoResumeHandler, { once: false, passive: true }); } catch {}
    }
  }

  private removeAutoResume(): void {
    if (!this.autoResumeHandler) return;
    const events = ['touchstart', 'click', 'keydown', 'mousedown'];
    for (const event of events) {
      try { document.removeEventListener(event, this.autoResumeHandler); } catch {}
    }
    this.autoResumeHandler = null;
  }

  private disconnectSourceChain(): void {
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch {}
      this.sourceNode = null;
    }
    for (const filter of this.filters) {
      try { filter.disconnect(); } catch {}
    }
    this.filters = [];
    this._audioElement = null;
  }

  async resume(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        eqLog('AudioContext resumed successfully');
        this.removeAutoResume();
      } catch {
        this.setupAutoResume();
      }
    }
  }

  destroy(): void {
    this.removeAutoResume();
    this.disconnectSourceChain();
    if (this.audioContext) {
      try { this.audioContext.close(); } catch {}
      this.audioContext = null;
    }
    this._enabled = false;
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

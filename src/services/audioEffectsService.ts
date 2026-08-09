// 10-band equalizer + audio effects chain, wired to a real AudioContext graph.
// Effects: Bass boost, Treble, Stereo widening, Virtualizer, Loudness, Limiter.

export interface EnhancedEQBand {
  frequency: number;
  gain: number;
  q: number;
  type: BiquadFilterType;
  label: string;
}

export interface AudioEffectPreset {
  name: string;
  bands: number[];
  bassBoost: number;
  treble: number;
  stereoWidth: number;
  loudnessMode: boolean;
}

interface ChainNodes {
  bassFilter: BiquadFilterNode;
  trebleFilter: BiquadFilterNode;
  midGain: GainNode;
  sideGain: GainNode;
  outL: GainNode;
  outR: GainNode;
  merger: ChannelMergerNode;
  compressor: DynamicsCompressorNode;
  loudnessGain: GainNode;
  masterGain: GainNode;
}

export class AudioEffectsService {
  private context: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private filters: BiquadFilterNode[] = [];
  private chain: ChainNodes | null = null;
  private listeners: Array<() => void> = [];

  private _enabled = false;
  private _preset = 'Flat';
  private _gains: number[] = [];
  private _bassBoost = 0;
  private _treble = 0;
  private _stereoWidth = 0.5;
  private _loudnessMode = false;
  private _limiter = false;
  private _virtualizer = false;
  private _supported = typeof AudioContext !== 'undefined';

  private autoResumeHandler: (() => void) | null = null;
  private readonly bands: EnhancedEQBand[];

  constructor() {
    const rawBands: Array<[number, BiquadFilterType, string]> = [
      [32, 'lowshelf', '32'],
      [64, 'peaking', '64'],
      [100, 'peaking', '100'],
      [200, 'peaking', '200'],
      [400, 'peaking', '400'],
      [800, 'peaking', '800'],
      [1600, 'peaking', '1.6K'],
      [3200, 'peaking', '3.2K'],
      [6400, 'peaking', '6.4K'],
      [12800, 'highshelf', '12.8K'],
    ];
    this.bands = rawBands.map(([frequency, type, label], i) => ({
      frequency,
      q: i === 0 || i === 9 ? 1.0 : 1.4,
      type,
      label,
      gain: 0,
    }));
    this._gains = this.bands.map(() => 0);
  }

  get supported(): boolean { return this._supported; }
  get enabled(): boolean { return this._enabled; }
  get gains(): number[] { return [...this._gains]; }
  get preset(): string { return this._preset; }
  get isReady(): boolean {
    return this.context !== null && this.sourceNode !== null && this.chain !== null;
  }
  get audioContextState(): string {
    return this.context ? this.context.state : 'null';
  }
  getAudioElement(): HTMLAudioElement | null {
    return this.audioElement;
  }
  getFilters(): BiquadFilterNode[] {
    return this.filters;
  }

  async init(audioElement: HTMLAudioElement): Promise<void> {
    if (!this._supported) return;
    try {
    // Already attached to this exact element and running — just resume.
    if (
      this.context &&
      this.context.state === 'running' &&
      this.sourceNode &&
      this.audioElement === audioElement
    ) {
      return;
    }

    if (this.context && this.audioElement && this.audioElement !== audioElement) {
      // A different element is now the playback source — rebuild the source.
      this.disconnectChain();
      this.chain = null;
      try { this.sourceNode?.disconnect(); } catch {}
      try {
        this.sourceNode = this.context.createMediaElementSource(audioElement);
      } catch (err) {
        console.warn('[AudioEffects] createMediaElementSource failed, resetting AudioContext:', err);
        try { this.context.close(); } catch {}
        this.context = null;
        this.sourceNode = null;
        this.audioElement = null;
        this.filters = [];
        this.chain = null;
        return;
      }
      this.audioElement = audioElement;
      this.buildChain();
    } else if (!this.context) {
      this.context = new AudioContext();
      try {
        this.sourceNode = this.context.createMediaElementSource(audioElement);
      } catch (err) {
        console.warn('[AudioEffects] createMediaElementSource failed:', err);
        try { this.context.close(); } catch {}
        this.context = null;
        return;
      }
      this.audioElement = audioElement;
      this.buildChain();
    }

    if (this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch (err) {
        this.setupAutoResume();
      }
    }

    this.applyAll();
    } catch {
      // Equalizer init failed — continue without it
    }
  }

  async resume(): Promise<void> {
    try {
      if (this.context && this.context.state === 'suspended' && this.sourceNode) {
        await this.context.resume();
      }
    } catch {}
  }

  private buildChain(): void {
    if (!this.context || !this.sourceNode) return;

    let prev: AudioNode = this.sourceNode;

    this.filters = this.bands.map((band) => {
      const filter = this.context!.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      filter.gain.value = band.gain;
      filter.Q.value = band.q;
      return filter;
    });
    for (const filter of this.filters) {
      prev.connect(filter);
      prev = filter;
    }

    const bassFilter = this.context.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 100;
    bassFilter.gain.value = 0;
    prev.connect(bassFilter);
    prev = bassFilter;

    const trebleFilter = this.context.createBiquadFilter();
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.value = 8000;
    trebleFilter.gain.value = 0;
    prev.connect(trebleFilter);
    prev = trebleFilter;

    // Mid/side stereo widening: side = L - R, decoded with a width factor.
    const splitter = this.context.createChannelSplitter(2);
    prev.connect(splitter);

    const midGain = this.context.createGain();
    const sideGain = this.context.createGain();
    const sideInvert = this.context.createGain();
    sideInvert.gain.value = -1;
    midGain.gain.value = 1;
    sideGain.gain.value = 0;
    splitter.connect(midGain, 0);
    splitter.connect(midGain, 1);
    splitter.connect(sideInvert, 0);
    sideInvert.connect(sideGain);
    splitter.connect(sideGain, 1);

    const outL = this.context.createGain();
    const outR = this.context.createGain();
    midGain.connect(outL);
    midGain.connect(outR);
    sideGain.connect(outL);
    sideGain.connect(outR);

    const merger = this.context.createChannelMerger(2);
    outL.connect(merger, 0, 0);
    outR.connect(merger, 0, 1);
    prev = merger;

    // Limiter: a compressor acting as a brick-wall limiter when enabled.
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -6;
    compressor.knee.value = 0;
    compressor.ratio.value = 1;
    compressor.attack.value = 0.001;
    compressor.release.value = 0.2;
    prev.connect(compressor);
    prev = compressor;

    const loudnessGain = this.context.createGain();
    loudnessGain.gain.value = 1;
    prev.connect(loudnessGain);
    prev = loudnessGain;

    const masterGain = this.context.createGain();
    masterGain.gain.value = 1;
    prev.connect(masterGain);
    masterGain.connect(this.context.destination);

    this.chain = {
      bassFilter,
      trebleFilter,
      midGain,
      sideGain,
      outL,
      outR,
      merger,
      compressor,
      loudnessGain,
      masterGain,
    };
  }

  private applyAll(): void {
    if (!this.context || !this.chain) return;
    const t = this.context.currentTime;

    for (let i = 0; i < this.filters.length && i < this._gains.length; i++) {
      const target = this._enabled ? this._gains[i] : 0;
      this.filters[i].gain.setTargetAtTime(target, t, 0.02);
    }
    this.chain.bassFilter.gain.setTargetAtTime(this._enabled ? this._bassBoost : 0, t, 0.02);
    this.chain.trebleFilter.gain.setTargetAtTime(this._enabled ? this._treble : 0, t, 0.02);

    const width = this._enabled ? this._stereoWidth + (this._virtualizer ? 0.25 : 0) : 0;
    const side = 0.5 * Math.max(0, Math.min(1, width));
    this.chain.sideGain.gain.setTargetAtTime(side, t, 0.02);
    this.chain.midGain.gain.setTargetAtTime(1 - side, t, 0.02);

    const limiterOn = this._enabled && this._limiter;
    this.chain.compressor.ratio.setTargetAtTime(limiterOn ? 20 : 1, t, 0.02);
    this.chain.compressor.threshold.setTargetAtTime(limiterOn ? -6 : 0, t, 0.02);

    this.chain.loudnessGain.gain.setTargetAtTime(
      this._enabled && this._loudnessMode ? 1.12 : 1,
      t,
      0.02,
    );
  }

  setBand(index: number, gainValue: number): void {
    if (index < 0 || index >= this._gains.length) return;
    const clamped = Math.max(-30, Math.min(30, gainValue));
    this._gains[index] = clamped;
    this._preset = 'Custom';
    if (this.context && this.filters[index]) {
      this.filters[index].gain.setTargetAtTime(
        this._enabled ? clamped : 0,
        this.context.currentTime,
        0.02,
      );
    }
    this.notify();
  }

  setBassBoost(value: number): void {
    this._bassBoost = Math.max(-12, Math.min(12, value));
    if (this.context && this.chain) {
      this.chain.bassFilter.gain.setTargetAtTime(
        this._enabled ? this._bassBoost : 0,
        this.context.currentTime,
        0.02,
      );
    }
    this.notify();
  }

  setTreble(value: number): void {
    this._treble = Math.max(-12, Math.min(12, value));
    if (this.context && this.chain) {
      this.chain.trebleFilter.gain.setTargetAtTime(
        this._enabled ? this._treble : 0,
        this.context.currentTime,
        0.02,
      );
    }
    this.notify();
  }

  setStereoWidth(value: number): void {
    this._stereoWidth = Math.max(0, Math.min(1, value));
    if (this.context && this.chain) {
      const width = this._enabled ? this._stereoWidth + (this._virtualizer ? 0.25 : 0) : 0;
      const side = 0.5 * Math.max(0, Math.min(1, width));
      this.chain.sideGain.gain.setTargetAtTime(side, this.context.currentTime, 0.02);
      this.chain.midGain.gain.setTargetAtTime(1 - side, this.context.currentTime, 0.02);
    }
    this.notify();
  }

  setLoudnessMode(enabled: boolean): void {
    this._loudnessMode = enabled;
    if (this.context && this.chain) {
      this.chain.loudnessGain.gain.setTargetAtTime(
        this._enabled && enabled ? 1.12 : 1,
        this.context.currentTime,
        0.02,
      );
    }
    this.notify();
  }

  setLimiter(enabled: boolean): void {
    this._limiter = enabled;
    if (this.context && this.chain) {
      this.chain.compressor.ratio.setTargetAtTime(
        this._enabled && enabled ? 20 : 1,
        this.context.currentTime,
        0.02,
      );
      this.chain.compressor.threshold.setTargetAtTime(
        this._enabled && enabled ? -6 : 0,
        this.context.currentTime,
        0.02,
      );
    }
    this.notify();
  }

  setVirtualizer(enabled: boolean): void {
    this._virtualizer = enabled;
    if (this.context && this.chain) {
      const width = this._enabled ? this._stereoWidth + (enabled ? 0.25 : 0) : 0;
      const side = 0.5 * Math.max(0, Math.min(1, width));
      this.chain.sideGain.gain.setTargetAtTime(side, this.context.currentTime, 0.02);
      this.chain.midGain.gain.setTargetAtTime(1 - side, this.context.currentTime, 0.02);
    }
    this.notify();
  }

  toggle(): void {
    this._enabled = !this._enabled;
    if (!this._enabled) {
      this._preset = 'Flat';
    }
    this.applyAll();
    this.notify();
  }

  setPreset(name: string): void {
    const preset = AudioEffectsService.PRESETS.find((p) => p.name === name);
    if (!preset) return;
    this._gains = [...preset.bands];
    this._bassBoost = preset.bassBoost;
    this._treble = preset.treble;
    this._stereoWidth = preset.stereoWidth;
    this._loudnessMode = preset.loudnessMode;
    this._preset = name;
    if (this._enabled) {
      this.applyAll();
    }
    this.notify();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify(): void {
    this.listeners.forEach((cb) => {
      try { cb(); } catch {}
    });
  }

  destroy(): void {
    this.disconnectChain();
    this.chain = null;
    if (this.context) {
      try { this.context.close(); } catch {}
      this.context = null;
    }
    this.sourceNode = null;
    this.audioElement = null;
    this.removeAutoResume();
    this._enabled = false;
    this._preset = 'Flat';
  }

  private disconnectChain(): void {
    for (const filter of this.filters) {
      try { filter.disconnect(); } catch {}
    }
    if (this.chain) {
      try { this.chain.masterGain.disconnect(); } catch {}
    }
    this.filters = [];
  }

  private setupAutoResume(): void {
    if (this.autoResumeHandler) return;
    this.autoResumeHandler = () => {
      if (this.context && this.context.state === 'suspended') {
        this.context.resume().catch(() => {});
      }
      if (this.context && this.context.state === 'running') {
        this.removeAutoResume();
      }
    };
    const events = ['touchstart', 'click', 'keydown', 'mousedown'];
    for (const event of events) {
      document.addEventListener(event, this.autoResumeHandler, { passive: true });
    }
  }

  private removeAutoResume(): void {
    if (!this.autoResumeHandler) return;
    const events = ['touchstart', 'click', 'keydown', 'mousedown'];
    for (const event of events) {
      document.removeEventListener(event, this.autoResumeHandler);
    }
    this.autoResumeHandler = null;
  }

  static readonly PRESETS: AudioEffectPreset[] = [
    { name: 'Flat', bands: [0,0,0,0,0,0,0,0,0,0], bassBoost: 0, treble: 0, stereoWidth: 0.5, loudnessMode: false },
    { name: 'Bass Boost', bands: [0,0,0,0,0,0,0,0,0,0], bassBoost: 6, treble: 0, stereoWidth: 0.5, loudnessMode: false },
    { name: 'Treble Boost', bands: [0,0,0,0,0,0,0,0,0,0], bassBoost: 0, treble: 6, stereoWidth: 0.5, loudnessMode: false },
    { name: 'Rock', bands: [5,4,3,2,0,-1,0,2,4,5], bassBoost: 3, treble: 2, stereoWidth: 0.6, loudnessMode: true },
    { name: 'Classical', bands: [3,2,2,1,0,0,1,2,3,4], bassBoost: 2, treble: 2, stereoWidth: 0.4, loudnessMode: false },
    { name: 'Jazz', bands: [3,2,1,0,-1,-2,0,2,3,4], bassBoost: 1, treble: 1, stereoWidth: 0.5, loudnessMode: true },
    { name: 'Hip Hop', bands: [5,4,3,2,0,0,2,2,3,4], bassBoost: 4, treble: 1, stereoWidth: 0.7, loudnessMode: true },
    { name: 'Electronic', bands: [5,4,3,2,1,0,1,2,3,4], bassBoost: 3, treble: 3, stereoWidth: 0.6, loudnessMode: true },
    { name: 'Vocal', bands: [-2,-1,0,3,5,5,3,1,0,-1], bassBoost: 0, treble: 0, stereoWidth: 0.5, loudnessMode: false },
    { name: 'Pop', bands: [-1,0,2,4,5,3,1,0,-1,-2], bassBoost: 1, treble: 2, stereoWidth: 0.5, loudnessMode: false },
  ];

  get PRESETS(): AudioEffectPreset[] {
    return AudioEffectsService.PRESETS;
  }
}

export const audioEffectsService = new AudioEffectsService();
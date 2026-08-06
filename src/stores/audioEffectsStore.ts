import { create } from 'zustand';
import { audioEffectsService, AudioEffectPreset } from '../services/audioEffectsService';

const STORAGE_KEY = 'audio_effects_v1';

interface PersistedState {
  enabled: boolean;
  preset: string;
  gains: number[];
  bassBoost: number;
  treble: number;
  stereoWidth: number;
  loudnessMode: boolean;
  limiterEnabled: boolean;
  virtualizerEnabled: boolean;
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePersisted(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function applyToService(state: PersistedState): void {
  if (state.enabled !== audioEffectsService.enabled) {
    audioEffectsService.toggle();
  }
  for (let i = 0; i < state.gains.length; i++) {
    audioEffectsService.setBand(i, state.gains[i]);
  }
  audioEffectsService.setBassBoost(state.bassBoost);
  audioEffectsService.setTreble(state.treble);
  audioEffectsService.setStereoWidth(state.stereoWidth);
  audioEffectsService.setLoudnessMode(state.loudnessMode);
  audioEffectsService.setLimiter(state.limiterEnabled);
  audioEffectsService.setVirtualizer(state.virtualizerEnabled);
  audioEffectsService.setPreset(state.preset);
}

function getPersistedOrDefault(): PersistedState {
  const saved = loadPersisted();
  return saved ?? {
    enabled: false,
    preset: 'Flat',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bassBoost: 0,
    treble: 0,
    stereoWidth: 0.5,
    loudnessMode: false,
    limiterEnabled: false,
    virtualizerEnabled: false,
  };
}

function persistAndApply(get: () => AudioEffectsStore): void {
  const s = get();
  savePersisted({
    enabled: s.enabled,
    preset: s.preset,
    gains: s.gains,
    bassBoost: s.bassBoost,
    treble: s.treble,
    stereoWidth: s.stereoWidth,
    loudnessMode: s.loudnessMode,
    limiterEnabled: s.limiterEnabled,
    virtualizerEnabled: s.virtualizerEnabled,
  });
}

export interface AudioEffectsStore {
  enabled: boolean;
  preset: string;
  gains: number[];
  bassBoost: number;
  treble: number;
  stereoWidth: number;
  loudnessMode: boolean;
  limiterEnabled: boolean;
  virtualizerEnabled: boolean;

  toggle: () => void;
  setBand: (index: number, gain: number) => void;
  setBassBoost: (value: number) => void;
  setTreble: (value: number) => void;
  setStereoWidth: (value: number) => void;
  setLoudnessMode: (enabled: boolean) => void;
  setLimiter: (enabled: boolean) => void;
  setVirtualizer: (enabled: boolean) => void;
  setPreset: (name: string) => void;

  bands: Array<{ frequency: number; label: string }>;
  presets: AudioEffectPreset[];
}

const initial = getPersistedOrDefault();

export const useAudioEffectsStore = create<AudioEffectsStore>((set, get) => ({
  enabled: initial.enabled,
  preset: initial.preset,
  gains: initial.gains,
  bassBoost: initial.bassBoost,
  treble: initial.treble,
  stereoWidth: initial.stereoWidth,
  loudnessMode: initial.loudnessMode,
  limiterEnabled: initial.limiterEnabled,
  virtualizerEnabled: initial.virtualizerEnabled,

  toggle: () => {
    audioEffectsService.toggle();
    set({ enabled: audioEffectsService.enabled });
    persistAndApply(get);
  },

  setBand: (index: number, gain: number) => {
    audioEffectsService.setBand(index, gain);
    set({ gains: audioEffectsService.gains, preset: audioEffectsService.preset });
    persistAndApply(get);
  },

  setBassBoost: (value: number) => {
    audioEffectsService.setBassBoost(value);
    set({ bassBoost: value });
    persistAndApply(get);
  },

  setTreble: (value: number) => {
    audioEffectsService.setTreble(value);
    set({ treble: value });
    persistAndApply(get);
  },

  setStereoWidth: (value: number) => {
    audioEffectsService.setStereoWidth(value);
    set({ stereoWidth: value });
    persistAndApply(get);
  },

  setLoudnessMode: (enabled: boolean) => {
    audioEffectsService.setLoudnessMode(enabled);
    set({ loudnessMode: enabled });
    persistAndApply(get);
  },

  setLimiter: (enabled: boolean) => {
    audioEffectsService.setLimiter(enabled);
    set({ limiterEnabled: enabled });
    persistAndApply(get);
  },

  setVirtualizer: (enabled: boolean) => {
    audioEffectsService.setVirtualizer(enabled);
    set({ virtualizerEnabled: enabled });
    persistAndApply(get);
  },

  setPreset: (name: string) => {
    audioEffectsService.setPreset(name);
    const preset = audioEffectsService.PRESETS.find(p => p.name === name);
    if (preset) {
      set({
        gains: preset.bands,
        bassBoost: preset.bassBoost,
        treble: preset.treble,
        stereoWidth: preset.stereoWidth,
        loudnessMode: preset.loudnessMode,
        preset: name,
      });
    }
    persistAndApply(get);
  },

  bands: [
    { frequency: 32, label: '32' },
    { frequency: 64, label: '64' },
    { frequency: 100, label: '100' },
    { frequency: 200, label: '200' },
    { frequency: 400, label: '400' },
    { frequency: 800, label: '800' },
    { frequency: 1600, label: '1.6K' },
    { frequency: 3200, label: '3.2K' },
    { frequency: 6400, label: '6.4K' },
    { frequency: 12800, label: '12.8K' },
  ],

  presets: audioEffectsService.PRESETS,
}));

// Apply persisted settings to service on startup
if (typeof window !== 'undefined') {
  const deferInit = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
  deferInit(() => {
    applyToService(getPersistedOrDefault());
  });
}

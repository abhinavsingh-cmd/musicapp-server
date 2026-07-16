import { create } from 'zustand';
import { equalizerService } from '../services/equalizerService';

export interface EqualizerStore {
  enabled: boolean;
  preset: string;
  gains: number[];
  toggle: () => void;
  setBand: (index: number, gain: number) => void;
  setPreset: (name: string) => void;
  bands: Array<{ frequency: number; label: string }>;
}

export const useEqualizerStore = create<EqualizerStore>((set) => ({
  enabled: false,
  preset: 'Flat',
  gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bands: [
    { frequency: 60, label: '60' },
    { frequency: 170, label: '170' },
    { frequency: 310, label: '310' },
    { frequency: 600, label: '600' },
    { frequency: 1000, label: '1K' },
    { frequency: 3000, label: '3K' },
    { frequency: 6000, label: '6K' },
    { frequency: 12000, label: '12K' },
    { frequency: 14000, label: '14K' },
    { frequency: 16000, label: '16K' },
  ],

  toggle: () => {
    equalizerService.toggle();
    set({ enabled: equalizerService.enabled, gains: equalizerService.gains });
  },

  setBand: (index: number, gain: number) => {
    equalizerService.setBand(index, gain);
    set({ gains: equalizerService.gains, preset: equalizerService.preset });
  },

  setPreset: (name: string) => {
    equalizerService.setPreset(name);
    set({ gains: equalizerService.gains, preset: equalizerService.preset });
  },
}));

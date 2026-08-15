import { describe, it, expect, beforeEach } from 'vitest';
import { useAudioEffectsStore } from './audioEffectsStore';
import { audioEffectsService } from '../services/audioEffectsService';

const STORAGE_KEY = 'audio_effects_v1';

// Normalize store + service to a known baseline through the public API.
function resetAll() {
  const s = useAudioEffectsStore.getState();
  if (s.enabled) s.toggle();
  s.setPreset('Flat');
  s.setBassBoost(0);
  s.setTreble(0);
  s.setStereoWidth(0.5);
  s.setLoudnessMode(false);
  s.setLimiter(false);
  s.setVirtualizer(false);
  localStorage.removeItem(STORAGE_KEY);
}

describe('audioEffectsStore ↔ audioEffectsService synchronization', () => {
  beforeEach(async () => {
    // Let the startup applyToService(deferInit) settle before asserting.
    await new Promise((r) => setTimeout(r, 5));
    resetAll();
  });

  it('toggle keeps store and service in sync — preset survives the round trip', () => {
    useAudioEffectsStore.getState().setPreset('Rock');

    useAudioEffectsStore.getState().toggle(); // enable
    expect(useAudioEffectsStore.getState().enabled).toBe(true);
    expect(audioEffectsService.enabled).toBe(true);

    useAudioEffectsStore.getState().toggle(); // disable
    expect(useAudioEffectsStore.getState().enabled).toBe(false);
    expect(audioEffectsService.enabled).toBe(false);

    // Neither side forgets the selected preset — the label never lies.
    expect(useAudioEffectsStore.getState().preset).toBe('Rock');
    expect(audioEffectsService.preset).toBe('Rock');
    expect(useAudioEffectsStore.getState().gains).toEqual([5, 4, 3, 2, 0, -1, 0, 2, 4, 5]);
  });

  it('setBand syncs gains to the service and marks Custom on both sides', () => {
    useAudioEffectsStore.getState().setBand(4, 6.5);

    expect(useAudioEffectsStore.getState().gains[4]).toBe(6.5);
    expect(useAudioEffectsStore.getState().preset).toBe('Custom');
    expect(audioEffectsService.gains[4]).toBe(6.5);
    expect(audioEffectsService.preset).toBe('Custom');
  });

  it('setPreset syncs every effect field from the preset definition', () => {
    useAudioEffectsStore.getState().setPreset('Electronic');

    const s = useAudioEffectsStore.getState();
    expect(s.preset).toBe('Electronic');
    expect(s.gains).toEqual([5, 4, 3, 2, 1, 0, 1, 2, 3, 4]);
    expect(s.bassBoost).toBe(3);
    expect(s.treble).toBe(3);
    expect(s.stereoWidth).toBe(0.6);
    expect(s.loudnessMode).toBe(true);
    expect(audioEffectsService.gains).toEqual(s.gains);
    expect(audioEffectsService.preset).toBe('Electronic');
  });

  it('every store mutation persists so a reload restores the exact same settings', () => {
    useAudioEffectsStore.getState().setPreset('Hip Hop');
    useAudioEffectsStore.getState().setLimiter(true);
    useAudioEffectsStore.getState().setVirtualizer(true);
    useAudioEffectsStore.getState().toggle(); // enable

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    expect(saved.enabled).toBe(true);
    expect(saved.preset).toBe('Hip Hop');
    expect(saved.gains).toEqual([5, 4, 3, 2, 0, 0, 2, 2, 3, 4]);
    expect(saved.limiterEnabled).toBe(true);
    expect(saved.virtualizerEnabled).toBe(true);
  });
});

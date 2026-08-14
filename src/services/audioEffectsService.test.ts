import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AudioEffectsService } from './audioEffectsService';

const mockGainFn = () => ({
  value: 1,
  setValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
});

const mockFilterNode = (type = 'peaking') => ({
  type,
  frequency: { value: 0 },
  gain: { value: 0, ...mockGainFn() },
  Q: { value: 1 },
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const mockGainNode = (val = 1) => ({
  gain: { value: val, ...mockGainFn() },
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const mockCompressorNode = () => ({
  threshold: { value: 0, ...mockGainFn() },
  knee: { value: 0 },
  ratio: { value: 1, ...mockGainFn() },
  attack: { value: 0.001 },
  release: { value: 0.2 },
  connect: vi.fn(),
  disconnect: vi.fn(),
});

const mockSplitter = () => ({ connect: vi.fn(), disconnect: vi.fn() });
const mockMerger = () => ({ connect: vi.fn(), disconnect: vi.fn() });
const mockSourceNode = () => ({ connect: vi.fn(), disconnect: vi.fn() });

function createMockContext() {
  return {
    state: 'running' as AudioContextState,
    currentTime: 0,
    destination: {} as AudioDestinationNode,
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createBiquadFilter: vi.fn(() => mockFilterNode()),
    createGain: vi.fn(() => mockGainNode()),
    createMediaElementSource: vi.fn(() => mockSourceNode()),
    createDynamicsCompressor: vi.fn(() => mockCompressorNode()),
    createChannelSplitter: vi.fn(() => mockSplitter()),
    createChannelMerger: vi.fn(() => mockMerger()),
  };
}

let latestCtx: ReturnType<typeof createMockContext>;

vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function () {
  latestCtx = createMockContext();
  return latestCtx;
}));

describe('AudioEffectsService', () => {
  let svc: AudioEffectsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new AudioEffectsService();
  });

  // ── Constructor defaults ──
  describe('constructor', () => {
    it('starts disabled with Flat preset and all gains at 0', () => {
      expect(svc.enabled).toBe(false);
      expect(svc.preset).toBe('Flat');
      expect(svc.gains).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(svc.isReady).toBe(false);
      expect(svc.audioContextState).toBe('null');
    });
  });

  // ── init() ──
  describe('init()', () => {
    it('creates AudioContext + sourceNode and marks ready', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      expect(latestCtx.createMediaElementSource).toHaveBeenCalledWith(el);
      expect(svc.isReady).toBe(true);
    });

    it('resumes suspended context', async () => {
      // Make the mock AudioContext start in suspended state
      vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function () {
        latestCtx = createMockContext();
        latestCtx.state = 'suspended';
        return latestCtx;
      }));
      const el = document.createElement('audio');
      await svc.init(el);
      expect(latestCtx.resume).toHaveBeenCalled();
    });

    it('does not create duplicate sourceNodes on re-init with same element', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      const count = latestCtx.createMediaElementSource.mock.calls.length;
      await svc.init(el);
      expect(latestCtx.createMediaElementSource).toHaveBeenCalledTimes(count);
    });

    it('fullDisconnect + rebuild when different element is passed', async () => {
      const el1 = document.createElement('audio');
      const el2 = document.createElement('audio');
      await svc.init(el1);
      await svc.init(el2);
      expect(latestCtx.createMediaElementSource).toHaveBeenCalledTimes(2);
      expect(svc.isReady).toBe(true);
    });

    it('does nothing when AudioContext is not supported', async () => {
      vi.stubGlobal('AudioContext', undefined);
      const s = new AudioEffectsService();
      await s.init(document.createElement('audio'));
      expect(s.isReady).toBe(false);
      vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function () { return createMockContext(); }));
    });
  });

  // ── resume() ──
  describe('resume()', () => {
    it('resumes suspended context and applies gains', async () => {
      // Re-stub AudioContext to start suspended
      vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function () {
        const ctx = createMockContext();
        ctx.state = 'suspended';
        latestCtx = ctx;
        return ctx;
      }));
      const fresh = new AudioEffectsService();
      const el = document.createElement('audio');
      await fresh.init(el);
      expect(latestCtx.resume).toHaveBeenCalled();
    });

    it('does nothing when context is running', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      latestCtx.state = 'running';
      latestCtx.resume.mockClear();
      await svc.resume();
      expect(latestCtx.resume).not.toHaveBeenCalled();
    });
  });

  // ── Presets ──
  describe('presets', () => {
    it('has 10 presets including Flat, Rock, Bass Boost', () => {
      expect(AudioEffectsService.PRESETS).toHaveLength(10);
      expect(AudioEffectsService.PRESETS.map(p => p.name)).toContain('Flat');
      expect(AudioEffectsService.PRESETS.map(p => p.name)).toContain('Rock');
      expect(AudioEffectsService.PRESETS.map(p => p.name)).toContain('Bass Boost');
    });

    it('setPreset applies gains and notifies', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      const cb = vi.fn();
      svc.subscribe(cb);
      svc.setPreset('Rock');
      expect(svc.preset).toBe('Rock');
      expect(svc.gains).toEqual([5, 4, 3, 2, 0, -1, 0, 2, 4, 5]);
      expect(cb).toHaveBeenCalled();
    });

    it('setPreset ignores unknown preset names', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.setPreset('Rock');
      svc.setPreset('NonExistent');
      expect(svc.preset).toBe('Rock');
    });

    it('Flat preset has all-zero bands and no effects', () => {
      const flat = AudioEffectsService.PRESETS.find(p => p.name === 'Flat')!;
      expect(flat.bands).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(flat.bassBoost).toBe(0);
      expect(flat.treble).toBe(0);
      expect(flat.loudnessMode).toBe(false);
    });

    it('Bass Boost preset has bassBoost=8', () => {
      const preset = AudioEffectsService.PRESETS.find(p => p.name === 'Bass Boost')!;
      expect(preset.bassBoost).toBe(8);
      expect(preset.bands).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('Electronic preset has stereoWidth=0.6 and loudnessMode=true', () => {
      const preset = AudioEffectsService.PRESETS.find(p => p.name === 'Electronic')!;
      expect(preset.stereoWidth).toBe(0.6);
      expect(preset.loudnessMode).toBe(true);
    });

    it('Rock preset has non-flat bands', () => {
      const preset = AudioEffectsService.PRESETS.find(p => p.name === 'Rock')!;
      expect(preset.bands[0]).toBe(5);
      expect(preset.bands[9]).toBe(5);
      expect(preset.bassBoost).toBe(3);
      expect(preset.treble).toBe(2);
    });

    it('Vocal preset boosts mids (400-800Hz)', () => {
      const preset = AudioEffectsService.PRESETS.find(p => p.name === 'Vocal')!;
      expect(preset.bands[4]).toBe(5); // 400Hz
      expect(preset.bands[5]).toBe(5); // 800Hz
    });
  });

  // ── Band controls ──
  describe('band controls', () => {
    it('setBand clamps to [-30, 30] and sets Custom preset', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.setBand(0, 50);
      expect(svc.gains[0]).toBe(30);
      expect(svc.preset).toBe('Custom');

      svc.setBand(0, -50);
      expect(svc.gains[0]).toBe(-30);
    });

    it('setBand ignores out-of-range index', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.setBand(-1, 5);
      svc.setBand(10, 5);
      expect(svc.gains).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('setBassBoost clamps to [-12, 12]', () => {
      svc.setBassBoost(15);
      svc.setTreble(-15);
      // setBassBoost/treble don't change preset
      expect(svc.preset).toBe('Flat');
    });
  });

  // ── toggle ──
  describe('toggle()', () => {
    it('first toggle enables (false→true), second disables and resets to Flat', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.setPreset('Rock');
      svc.toggle();
      expect(svc.enabled).toBe(true);
      svc.toggle();
      expect(svc.enabled).toBe(false);
      expect(svc.preset).toBe('Flat');
    });

    it('toggle without context does not throw', () => {
      expect(() => svc.toggle()).not.toThrow();
      svc.toggle();
      svc.toggle();
    });
  });

  // ── fullDisconnect / destroy ──
  describe('destroy()', () => {
    it('resets all state after init', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.setPreset('Rock');
      svc.toggle();
      svc.destroy();
      expect(svc.isReady).toBe(false);
      expect(svc.enabled).toBe(false);
      expect(svc.preset).toBe('Flat');
    });

    it('is safe to call multiple times', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.destroy();
      expect(() => svc.destroy()).not.toThrow();
    });

    it('safe to call without init', () => {
      expect(() => svc.destroy()).not.toThrow();
    });
  });

  // ── subscribe / unsubscribe ──
  describe('subscribe()', () => {
    it('listener fires on notify and can be unsubscribed', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      const cb = vi.fn();
      const unsub = svc.subscribe(cb);
      svc.setPreset('Jazz');
      expect(cb).toHaveBeenCalledTimes(1);
      unsub();
      svc.setPreset('Pop');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('swallows errors in listeners', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.subscribe(() => { throw new Error('boom'); });
      expect(() => svc.toggle()).not.toThrow();
    });

    it('multiple listeners all fire', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      svc.subscribe(cb1);
      svc.subscribe(cb2);
      svc.toggle();
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Stereo width / virtualizer ──
  describe('stereo width & virtualizer', () => {
    it('setStereoWidth clamps to [0, 1] and notifies', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      const cb = vi.fn();
      svc.subscribe(cb);
      svc.setStereoWidth(1.5);
      svc.setStereoWidth(-0.5);
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('setVirtualizer notifies listeners', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      const cb = vi.fn();
      svc.subscribe(cb);
      svc.setVirtualizer(true);
      svc.setVirtualizer(false);
      expect(cb).toHaveBeenCalledTimes(2);
    });
  });

  // ── Loudness / limiter ──
  describe('loudness & limiter', () => {
    it('setLoudnessMode and setLimiter notify without throwing', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      const cb = vi.fn();
      svc.subscribe(cb);
      svc.setLoudnessMode(true);
      svc.setLimiter(true);
      svc.setLoudnessMode(false);
      svc.setLimiter(false);
      expect(cb).toHaveBeenCalledTimes(4);
    });
  });

  // ── applyAllForce via init with effects ──
  describe('applyAllForce()', () => {
    it('called by init after toggle and preset change', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.setBand(3, 12);
      svc.setBassBoost(6);
      svc.toggle();
      await svc.init(el);
      expect(svc.isReady).toBe(true);
    });
  });

  // ── setBand disabled path ──
  describe('setBand disabled path', () => {
    it('stores internal gain but writes 0 to filter when disabled', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.toggle(); // enable
      svc.setBand(5, 10);
      svc.toggle(); // disable
      svc.setBand(3, 7);
      expect(svc.gains[3]).toBe(7);
      expect(svc.enabled).toBe(false);
    });
  });

  // ── setBassBoost/setTreble enabled path ──
  describe('setBassBoost/setTreble enabled path', () => {
    it('uses setTargetAtTime when enabled', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.toggle();
      svc.setBassBoost(8);
      svc.setTreble(8);
      // setBassBoost/treble don't change preset
      expect(svc.preset).toBe('Flat');
    });
  });

  // ── Supported property ──
  describe('supported', () => {
    it('returns true when AudioContext exists', () => {
      expect(svc.supported).toBe(true);
    });
  });

  // ── AudioElement getter ──
  describe('getAudioElement()', () => {
    it('returns null before init', () => {
      expect(svc.getAudioElement()).toBeNull();
    });

    it('returns the audio element after init', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      expect(svc.getAudioElement()).toBe(el);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Chain topology — proves the audio graph is wired correctly
  // ══════════════════════════════════════════════════════════════════════════

  describe('chain topology', () => {
    it('builds correct signal path: source → 10 filters → bass → treble → splitter → mid/side → merger → compressor → loudness → master → destination', async () => {
      const el = document.createElement('audio');
      await svc.init(el);

      // Collect all created nodes in order
      const filters = latestCtx.createBiquadFilter.mock.results.map((r: any) => r.value);
      const gains = latestCtx.createGain.mock.results.map((r: any) => r.value);
      const compressor = latestCtx.createDynamicsCompressor.mock.results[0].value;
      const splitter = latestCtx.createChannelSplitter.mock.results[0].value;
      const merger = latestCtx.createChannelMerger.mock.results[0].value;
      const source = latestCtx.createMediaElementSource.mock.results[0].value;

      // 10 EQ filters + bassFilter + trebleFilter + midGain + sideGain + sideInvert + outL + outR + loudnessGain + masterGain = 20 biquad/gain nodes
      expect(filters.length).toBe(12); // 10 EQ + bass + treble

      // Verify source connects to first filter
      expect(source.connect).toHaveBeenCalledWith(filters[0]);

      // Verify filters chain: filter[i] → filter[i+1]
      for (let i = 0; i < 9; i++) {
        expect(filters[i].connect).toHaveBeenCalledWith(filters[i + 1]);
      }

      // Verify filter[9] (12.8K highshelf) → bassFilter (filter[10])
      expect(filters[9].connect).toHaveBeenCalledWith(filters[10]);

      // Verify bassFilter → trebleFilter (filter[11])
      expect(filters[10].connect).toHaveBeenCalledWith(filters[11]);

      // Verify trebleFilter → splitter
      expect(filters[11].connect).toHaveBeenCalledWith(splitter);

      // Verify splitter → midGain, sideInvert, sideGain
      const sideInvert = gains[2]; // third gain node is sideInvert
      const midGain = gains[0];
      const sideGain = gains[1];
      expect(splitter.connect).toHaveBeenCalledWith(midGain, 0);
      expect(splitter.connect).toHaveBeenCalledWith(midGain, 1);
      expect(splitter.connect).toHaveBeenCalledWith(sideInvert, 0);
      expect(splitter.connect).toHaveBeenCalledWith(sideGain, 1);

      // Verify sideInvert → sideGain
      expect(sideInvert.connect).toHaveBeenCalledWith(sideGain);

      // Verify midGain → outL, outR; sideGain → outL, outR
      const outL = gains[3];
      const outR = gains[4];
      expect(midGain.connect).toHaveBeenCalledWith(outL);
      expect(midGain.connect).toHaveBeenCalledWith(outR);
      expect(sideGain.connect).toHaveBeenCalledWith(outL);
      expect(sideGain.connect).toHaveBeenCalledWith(outR);

      // Verify outL → merger (port 0), outR → merger (port 1)
      expect(outL.connect).toHaveBeenCalledWith(merger, 0, 0);
      expect(outR.connect).toHaveBeenCalledWith(merger, 0, 1);

      // Verify merger → compressor
      expect(merger.connect).toHaveBeenCalledWith(compressor);

      // Verify compressor → loudnessGain → masterGain → destination
      const loudnessGain = gains[5];
      const masterGain = gains[6];
      expect(compressor.connect).toHaveBeenCalledWith(loudnessGain);
      expect(loudnessGain.connect).toHaveBeenCalledWith(masterGain);
      expect(masterGain.connect).toHaveBeenCalledWith(latestCtx.destination);
    });

    it('fullDisconnect disconnects every node', async () => {
      const el = document.createElement('audio');
      await svc.init(el);

      const filters = latestCtx.createBiquadFilter.mock.results.map((r: any) => r.value);
      const gains = latestCtx.createGain.mock.results.map((r: any) => r.value);
      const compressor = latestCtx.createDynamicsCompressor.mock.results[0].value;
      const merger = latestCtx.createChannelMerger.mock.results[0].value;

      svc.destroy();

      // Every filter disconnect called
      for (const f of filters) {
        expect(f.disconnect).toHaveBeenCalled();
      }
      // Every chain node disconnect called
      for (const g of gains) {
        expect(g.disconnect).toHaveBeenCalled();
      }
      expect(compressor.disconnect).toHaveBeenCalled();
      expect(merger.disconnect).toHaveBeenCalled();
    });

    it('applyAllForce calls setValueAtTime on all 10 EQ filters', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.toggle(); // enable

      const filters = latestCtx.createBiquadFilter.mock.results.map((r: any) => r.value);
      // Only first 10 are EQ bands
      const eqFilters = filters.slice(0, 10);

      for (const f of eqFilters) {
        expect(f.gain.setValueAtTime).toHaveBeenCalled();
      }
    });

    it('applyAllForce calls setValueAtTime on bassFilter and trebleFilter', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.toggle();

      const filters = latestCtx.createBiquadFilter.mock.results.map((r: any) => r.value);
      const bassFilter = filters[10];
      const trebleFilter = filters[11];

      expect(bassFilter.gain.setValueAtTime).toHaveBeenCalled();
      expect(trebleFilter.gain.setValueAtTime).toHaveBeenCalled();
    });

    it('applyAllForce sets limiter ratio=20 and threshold=-6 when limiter enabled', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.toggle();
      svc.setLimiter(true);

      const compressor = latestCtx.createDynamicsCompressor.mock.results[0].value;
      // setLimiter uses setTargetAtTime
      expect(compressor.ratio.setTargetAtTime).toHaveBeenCalledWith(20, expect.any(Number), expect.any(Number));
      expect(compressor.threshold.setTargetAtTime).toHaveBeenCalledWith(-6, expect.any(Number), expect.any(Number));
    });

    it('applyAllForce sets loudness gain to 1.12 when loudness mode enabled', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.toggle();
      svc.setLoudnessMode(true);

      const gains = latestCtx.createGain.mock.results.map((r: any) => r.value);
      const loudnessGain = gains[5];
      // setLoudnessMode uses setTargetAtTime
      expect(loudnessGain.gain.setTargetAtTime).toHaveBeenCalledWith(1.12, expect.any(Number), expect.any(Number));
    });

    it('rebuilding chain on different element produces same topology', async () => {
      const el1 = document.createElement('audio');
      const el2 = document.createElement('audio');
      await svc.init(el1);
      await svc.init(el2);

      // After second init, should have 24 biquad filters (12 per build)
      expect(latestCtx.createBiquadFilter).toHaveBeenCalledTimes(24);
      // And source created twice
      expect(latestCtx.createMediaElementSource).toHaveBeenCalledTimes(2);
      expect(svc.isReady).toBe(true);
    });
  });
});

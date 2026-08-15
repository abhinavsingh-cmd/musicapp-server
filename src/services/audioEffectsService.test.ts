import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AudioEffectsService } from './audioEffectsService';

const mockGainFn = () => ({
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
    it('setBand clamps to [-12, 12] and sets Custom preset', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.setBand(0, 50);
      expect(svc.gains[0]).toBe(12);
      expect(svc.preset).toBe('Custom');

      svc.setBand(0, -50);
      expect(svc.gains[0]).toBe(-12);
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
    it('disable/enable round trip preserves preset and gains', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.setPreset('Rock');
      svc.toggle(); // enable
      expect(svc.enabled).toBe(true);
      svc.toggle(); // disable
      expect(svc.enabled).toBe(false);
      // Settings SURVIVE — disabling only forces the chain to unity values,
      // and the stored preset label must never lie about the stored gains.
      expect(svc.preset).toBe('Rock');
      expect(svc.gains).toEqual([5, 4, 3, 2, 0, -1, 0, 2, 4, 5]);
    });

    it('toggle without context does not throw', () => {
      expect(() => svc.toggle()).not.toThrow();
      svc.toggle();
      svc.toggle();
    });
  });

  // ── fullDisconnect / destroy ──
  describe('destroy()', () => {
    it('tears down the graph but preserves the user settings', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.setPreset('Rock');
      svc.toggle();
      svc.destroy();
      expect(svc.isReady).toBe(false);
      // Settings survive teardown so a later init() re-applies them —
      // destroy must never silently disable the EQ.
      expect(svc.enabled).toBe(true);
      expect(svc.preset).toBe('Rock');
      expect(svc.gains).toEqual([5, 4, 3, 2, 0, -1, 0, 2, 4, 5]);
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

      // 10 EQ filters + bassFilter + trebleFilter + midGain + sideGain +
      // sideInvert + sideNegate + outL + outR + loudnessGain + masterGain
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
      const midGain = gains[0];
      const sideGain = gains[1];
      const sideInvert = gains[2];
      const sideNegate = gains[3];
      expect(splitter.connect).toHaveBeenCalledWith(midGain, 0);
      expect(splitter.connect).toHaveBeenCalledWith(midGain, 1);
      expect(splitter.connect).toHaveBeenCalledWith(sideInvert, 0);
      expect(splitter.connect).toHaveBeenCalledWith(sideGain, 1);

      // Verify sideInvert → sideGain
      expect(sideInvert.connect).toHaveBeenCalledWith(sideGain);

      // M/S decode: outL = M − g·(R−L), outR = M + g·(R−L). The side path
      // reaches outR directly and outL ONLY through the sign inverter —
      // same-sign into both outputs would collapse the image to mono.
      const outL = gains[4];
      const outR = gains[5];
      expect(midGain.connect).toHaveBeenCalledWith(outL);
      expect(midGain.connect).toHaveBeenCalledWith(outR);
      expect(sideGain.connect).toHaveBeenCalledWith(sideNegate);
      expect(sideNegate.connect).toHaveBeenCalledWith(outL);
      expect(sideGain.connect).toHaveBeenCalledWith(outR);

      // Verify outL → merger (port 0), outR → merger (port 1)
      expect(outL.connect).toHaveBeenCalledWith(merger, 0, 0);
      expect(outR.connect).toHaveBeenCalledWith(merger, 0, 1);

      // Verify merger → compressor
      expect(merger.connect).toHaveBeenCalledWith(compressor);

      // Verify compressor → loudnessGain → masterGain → destination
      const loudnessGain = gains[6];
      const masterGain = gains[7];
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
      const loudnessGain = gains[6];
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

  // ═════════════════════════════════════════════════════════════════════
  // Single audio path — audio passes through the EQ chain EXACTLY once
  // ═════════════════════════════════════════════════════════════════════

  describe('single audio path', () => {
    it('exactly one route to destination — master connects once, source feeds only the first filter', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      const masterGain = latestCtx.createGain.mock.results[7].value;
      expect(masterGain.connect).toHaveBeenCalledTimes(1);
      expect(masterGain.connect).toHaveBeenCalledWith(latestCtx.destination);
      const source = latestCtx.createMediaElementSource.mock.results[0].value;
      expect(source.connect).toHaveBeenCalledTimes(1);
      expect(latestCtx.createMediaElementSource).toHaveBeenCalledTimes(1);
    });

    it('repeated init with the SAME element never creates a second source or chain', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      await svc.init(el);
      await svc.init(el);
      expect(latestCtx.createMediaElementSource).toHaveBeenCalledTimes(1);
      expect(latestCtx.createBiquadFilter).toHaveBeenCalledTimes(12); // one chain only
      const masterGain = latestCtx.createGain.mock.results[7].value;
      expect(masterGain.connect).toHaveBeenCalledTimes(1); // one route to destination
    });

    it('rebuild for a NEW element fully disconnects the old path — no duplicate route', async () => {
      const el1 = document.createElement('audio');
      const el2 = document.createElement('audio');
      await svc.init(el1);
      const firstMaster = latestCtx.createGain.mock.results[7].value;
      const firstFilters = latestCtx.createBiquadFilter.mock.results
        .slice(0, 12).map((r: any) => r.value);

      await svc.init(el2);

      // Every node of the FIRST chain was disconnected...
      expect(firstMaster.disconnect).toHaveBeenCalled();
      for (const f of firstFilters) expect(f.disconnect).toHaveBeenCalled();
      // ...and the NEW chain owns the single route to destination.
      const secondMaster = latestCtx.createGain.mock.results[15].value;
      expect(secondMaster.connect).toHaveBeenCalledTimes(1);
      expect(secondMaster.connect).toHaveBeenCalledWith(latestCtx.destination);
      expect(latestCtx.createMediaElementSource).toHaveBeenCalledTimes(2);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Band definitions, per-band gain application, presets
  // ═════════════════════════════════════════════════════════════════════

  describe('band definitions and gain application', () => {
    const lastSetValue = (param: any): unknown =>
      param.setValueAtTime.mock.calls.at(-1)?.[0];

    const EXPECTED: Array<[number, BiquadFilterType, number]> = [
      [32, 'lowshelf', 1.0], [64, 'peaking', 1.4], [100, 'peaking', 1.4],
      [200, 'peaking', 1.4], [400, 'peaking', 1.4], [800, 'peaking', 1.4],
      [1600, 'peaking', 1.4], [3200, 'peaking', 1.4], [6400, 'peaking', 1.4],
      [12800, 'highshelf', 1.0],
    ];

    it('every band filter is created with the correct frequency, type and Q', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      const filters = latestCtx.createBiquadFilter.mock.results.map((r: any) => r.value);
      EXPECTED.forEach(([freq, type, q], i) => {
        expect(filters[i].frequency.value).toBe(freq);
        expect(filters[i].type).toBe(type);
        expect(filters[i].Q.value).toBe(q);
      });
      // Bass-boost lowshelf at 100 Hz, treble highshelf at 8 kHz.
      expect(filters[10].type).toBe('lowshelf');
      expect(filters[10].frequency.value).toBe(100);
      expect(filters[11].type).toBe('highshelf');
      expect(filters[11].frequency.value).toBe(8000);
    });

    it('each of the 10 bands receives its own gain when enabled', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.toggle(); // enable
      const filters = latestCtx.createBiquadFilter.mock.results.map((r: any) => r.value);
      for (let i = 0; i < 10; i++) {
        svc.setBand(i, (i % 5) + 1);
      }
      for (let i = 0; i < 10; i++) {
        expect(lastSetValue(filters[i].gain)).toBe((i % 5) + 1);
      }
    });

    it('every preset applies its bands, bass and treble to the chain', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.toggle(); // enable
      const filters = latestCtx.createBiquadFilter.mock.results.map((r: any) => r.value);
      for (const preset of AudioEffectsService.PRESETS) {
        svc.setPreset(preset.name);
        for (let i = 0; i < 10; i++) {
          expect(lastSetValue(filters[i].gain)).toBe(preset.bands[i]);
        }
        expect(lastSetValue(filters[10].gain)).toBe(preset.bassBoost);
        expect(lastSetValue(filters[11].gain)).toBe(preset.treble);
      }
    });

    it('preset bands stay within the audible-but-safe ±5 dB range', () => {
      for (const preset of AudioEffectsService.PRESETS) {
        for (const g of preset.bands) {
          expect(Math.abs(g)).toBeLessThanOrEqual(5);
        }
        expect(Math.abs(preset.bassBoost)).toBeLessThanOrEqual(8);
        expect(Math.abs(preset.treble)).toBeLessThanOrEqual(8);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // Bypass transparency — disabled EQ must never color the audio
  // ═════════════════════════════════════════════════════════════════════

  describe('bypass transparency', () => {
    const lastSetValue = (param: any): unknown =>
      param.setValueAtTime.mock.calls.at(-1)?.[0];

    it('a disabled EQ forces a fully transparent chain', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.setPreset('Rock');
      svc.setLimiter(true);
      svc.setLoudnessMode(true);
      svc.toggle(); // enable
      svc.toggle(); // disable — everything must collapse to unity

      const filters = latestCtx.createBiquadFilter.mock.results.map((r: any) => r.value);
      const gains = latestCtx.createGain.mock.results.map((r: any) => r.value);
      const compressor = latestCtx.createDynamicsCompressor.mock.results[0].value;

      for (let i = 0; i < 12; i++) {
        expect(lastSetValue(filters[i].gain)).toBe(0); // all EQ bands + bass/treble
      }
      // Identity M/S decode: outL/outR reconstruct L/R exactly.
      expect(lastSetValue(gains[0].gain)).toBe(0.5); // mid
      expect(lastSetValue(gains[1].gain)).toBe(0.5); // side (identity width)
      expect(lastSetValue(compressor.ratio)).toBe(1);      // limiter off
      expect(lastSetValue(compressor.threshold)).toBe(0);
      expect(lastSetValue(gains[6].gain)).toBe(1);         // loudness off
    });

    it('re-enabling restores the stored preset gains exactly', async () => {
      const el = document.createElement('audio');
      await svc.init(el);
      svc.setPreset('Rock');
      svc.toggle(); // enable
      svc.toggle(); // disable
      svc.toggle(); // enable again

      const filters = latestCtx.createBiquadFilter.mock.results.map((r: any) => r.value);
      const rock = AudioEffectsService.PRESETS.find(p => p.name === 'Rock')!;
      for (let i = 0; i < 10; i++) {
        expect(lastSetValue(filters[i].gain)).toBe(rock.bands[i]);
      }
      expect(lastSetValue(filters[10].gain)).toBe(rock.bassBoost);
      expect(lastSetValue(filters[11].gain)).toBe(rock.treble);
    });

    it('suspended context: init resumes it and force-applies gains', async () => {
      vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function () {
        const ctx = createMockContext();
        ctx.state = 'suspended';
        latestCtx = ctx;
        return ctx;
      }));
      const fresh = new AudioEffectsService();
      fresh.setPreset('Jazz');
      fresh.toggle(); // enable while no context yet
      const el = document.createElement('audio');
      await fresh.init(el);

      expect(latestCtx.resume).toHaveBeenCalled();
      expect(latestCtx.state).toBeDefined();
      const filters = latestCtx.createBiquadFilter.mock.results.map((r: any) => r.value);
      const jazz = AudioEffectsService.PRESETS.find(p => p.name === 'Jazz')!;
      for (let i = 0; i < 10; i++) {
        expect(filters[i].gain.setValueAtTime).toHaveBeenCalledWith(
          jazz.bands[i], expect.any(Number),
        );
      }
    });
  });
});

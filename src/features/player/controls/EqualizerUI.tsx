import React, { memo } from 'react';
import { useAudioEffectsStore } from '../../../stores/audioEffectsStore';
import { motion } from 'framer-motion';
import {
  Power, Volume2, Headphones, ShieldCheck,
} from 'lucide-react';
import { cn } from '../../../utils/cn';

const Toggle = memo(({ enabled, onToggle, icon: Icon, label }: {
  enabled: boolean; onToggle: () => void; icon: React.FC<{ size?: number }>; label: string;
}) => (
  <button
    onClick={onToggle}
    className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all",
      enabled ? "bg-violet-500/20 text-violet-300 border border-violet-500/30" : "bg-white/5 text-gray-500 border border-white/5 hover:text-gray-300"
    )}
  >
    <Icon size={14} />
    {label}
  </button>
));
Toggle.displayName = 'Toggle';

const Slider = memo(({ label, value, min, max, step, onChange, unit, disabled }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; unit?: string; disabled?: boolean;
}) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-gray-500 font-medium">{label}</span>
      <span className="text-[10px] text-gray-400 font-mono">
        {value > 0 ? '+' : ''}{value.toFixed(step < 1 ? 1 : 0)}{unit || ''}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      disabled={disabled}
      className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-30 bg-white/10"
      style={{
        background: `linear-gradient(to right, rgb(139 92 246) 0%, rgb(139 92 246) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.1) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.1) 100%)`,
      }}
    />
  </div>
));
Slider.displayName = 'Slider';

export const EqualizerUI: React.FC = memo(() => {
  const enabled = useAudioEffectsStore((s) => s.enabled);
  const preset = useAudioEffectsStore((s) => s.preset);
  const gains = useAudioEffectsStore((s) => s.gains);
  const bassBoost = useAudioEffectsStore((s) => s.bassBoost);
  const treble = useAudioEffectsStore((s) => s.treble);
  const stereoWidth = useAudioEffectsStore((s) => s.stereoWidth);
  const loudnessMode = useAudioEffectsStore((s) => s.loudnessMode);
  const limiterEnabled = useAudioEffectsStore((s) => s.limiterEnabled);
  const virtualizerEnabled = useAudioEffectsStore((s) => s.virtualizerEnabled);
  const toggle = useAudioEffectsStore((s) => s.toggle);
  const setBand = useAudioEffectsStore((s) => s.setBand);
  const setBassBoost = useAudioEffectsStore((s) => s.setBassBoost);
  const setTreble = useAudioEffectsStore((s) => s.setTreble);
  const setStereoWidth = useAudioEffectsStore((s) => s.setStereoWidth);
  const setLoudnessMode = useAudioEffectsStore((s) => s.setLoudnessMode);
  const setLimiter = useAudioEffectsStore((s) => s.setLimiter);
  const setVirtualizer = useAudioEffectsStore((s) => s.setVirtualizer);
  const setPreset = useAudioEffectsStore((s) => s.setPreset);
  const bands = useAudioEffectsStore((s) => s.bands);
  const presets = useAudioEffectsStore((s) => s.presets);

  return (
    <div className="bg-[#1a1a2e] rounded-2xl p-5 border border-white/5 space-y-5 max-h-[70vh] overflow-y-auto scrollbar-thin">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white">Audio Effects</h3>
        <motion.button
          onClick={toggle}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className={cn(
            "p-2 rounded-full transition-all",
            enabled ? "bg-violet-500/20 text-violet-400" : "bg-white/5 text-gray-500"
          )}
        >
          <Power size={20} />
        </motion.button>
      </div>

      {/* Presets */}
      <div>
        <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-2">Presets</div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.name}
              onClick={() => setPreset(p.name)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium transition-all",
                preset === p.name
                  ? "bg-violet-500 text-white"
                  : "bg-white/5 text-gray-400 hover:bg-white/10"
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* 10-Band EQ */}
      <div>
        <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-2">Equalizer</div>
        <div className="flex items-end justify-between gap-1.5 h-40">
          {bands.map((band, i) => (
            <div key={band.frequency} className="flex flex-col items-center flex-1">
              <span className="text-[9px] text-gray-500 mb-1">
                {gains[i] > 0 ? '+' : ''}{gains[i].toFixed(0)}
              </span>
              <div className="relative h-24 w-full flex justify-center">
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  value={gains[i]}
                  onChange={(e) => setBand(i, parseFloat(e.target.value))}
                  disabled={!enabled}
                  className="h-24 w-6 appearance-none cursor-pointer disabled:opacity-30"
                  style={{
                    writingMode: 'vertical-rl',
                    direction: 'rtl',
                    background: `linear-gradient(to top,
                      rgb(139 92 246) 0%,
                      rgb(139 92 246) ${((gains[i] + 12) / 24) * 100}%,
                      rgba(255,255,255,0.1) ${((gains[i] + 12) / 24) * 100}%,
                      rgba(255,255,255,0.1) 100%)`,
                    borderRadius: '3px',
                  }}
                />
              </div>
              <span className="text-[8px] text-gray-500 mt-1">{band.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bass Boost & Treble */}
      <div className="grid grid-cols-2 gap-4">
        <Slider label="Bass Boost" value={bassBoost} min={-12} max={12} step={0.5} onChange={setBassBoost} unit="dB" disabled={!enabled} />
        <Slider label="Treble" value={treble} min={-12} max={12} step={0.5} onChange={setTreble} unit="dB" disabled={!enabled} />
      </div>

      {/* Stereo Width */}
      <Slider label="Stereo Width" value={stereoWidth} min={0} max={1} step={0.05} onChange={setStereoWidth} disabled={!enabled} />

      {/* Toggles */}
      <div>
        <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-2">Effects</div>
        <div className="flex flex-wrap gap-2">
          <Toggle enabled={loudnessMode} onToggle={() => setLoudnessMode(!loudnessMode)} icon={Volume2} label="Loudness" />
          <Toggle enabled={limiterEnabled} onToggle={() => setLimiter(!limiterEnabled)} icon={ShieldCheck} label="Limiter" />
          <Toggle enabled={virtualizerEnabled} onToggle={() => setVirtualizer(!virtualizerEnabled)} icon={Headphones} label="Virtualizer" />
        </div>
      </div>
    </div>
  );
});
EqualizerUI.displayName = 'EqualizerUI';

import React from 'react';
import { useEqualizerStore } from '../../../stores/equalizerStore';
import { EQ_PRESETS } from '../../../services/equalizerService';
import { motion } from 'framer-motion';
import { Power } from 'lucide-react';

export const EqualizerUI: React.FC = () => {
  const enabled = useEqualizerStore((s) => s.enabled);
  const preset = useEqualizerStore((s) => s.preset);
  const gains = useEqualizerStore((s) => s.gains);
  const toggle = useEqualizerStore((s) => s.toggle);
  const setBand = useEqualizerStore((s) => s.setBand);
  const setPreset = useEqualizerStore((s) => s.setPreset);
  const bands = useEqualizerStore((s) => s.bands);

  return (
    <div className="bg-[#1a1a2e] rounded-2xl p-6 border border-white/5">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-white">Equalizer</h3>
        <motion.button
          onClick={toggle}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className={`p-2 rounded-full transition-all ${
            enabled
              ? 'bg-violet-500/20 text-violet-400'
              : 'bg-white/5 text-gray-500'
          }`}
        >
          <Power size={20} />
        </motion.button>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-2 mb-6">
        {EQ_PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => setPreset(p.name)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              preset === p.name
                ? 'bg-violet-500 text-white'
                : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* EQ Sliders */}
      <div className="flex items-end justify-between gap-2 h-48">
        {bands.map((band, i) => (
          <div key={band.frequency} className="flex flex-col items-center flex-1">
            <span className="text-[10px] text-gray-500 mb-2">
              {gains[i] > 0 ? '+' : ''}{gains[i].toFixed(0)}dB
            </span>
            <div className="relative h-32 w-full flex justify-center">
              <input
                type="range"
                min="-12"
                max="12"
                step="0.5"
                value={gains[i]}
                onChange={(e) => setBand(i, parseFloat(e.target.value))}
                disabled={!enabled}
                className="h-32 w-8 appearance-none cursor-pointer disabled:opacity-30"
                style={{
                  writingMode: 'vertical-rl',
                  direction: 'rtl',
                  background: `linear-gradient(to top, 
                    rgb(139 92 246) 0%, 
                    rgb(139 92 246) ${((gains[i] + 12) / 24) * 100}%, 
                    rgba(255,255,255,0.1) ${((gains[i] + 12) / 24) * 100}%, 
                    rgba(255,255,255,0.1) 100%)`,
                  borderRadius: '4px',
                }}
              />
            </div>
            <span className="text-[10px] text-gray-400 mt-2">{band.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

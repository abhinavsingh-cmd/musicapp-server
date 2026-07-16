import React, { useRef } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { themes } from '../../themes/themeDefinitions';
import { cn } from '../../utils/cn';
import { Palette, Check, RotateCcw, Monitor } from 'lucide-react';
import { motion } from 'framer-motion';

const PRESET_ACCENTS = [
  '#8b5cf6', '#7c3aed', '#6366f1', '#3b82f6', '#0ea5e9',
  '#06b6d4', '#14b8a6', '#10b981', '#22c55e', '#84cc16',
  '#eab308', '#f59e0b', '#f97316', '#ef4444', '#ec4899',
  '#d946ef', '#a855f7', '#ffffff', '#64748b', '#000000',
];

const themePreviewColors: Record<string, { bg: string; accent: string; surface: string }> = {
  'purple':      { bg: '#0a0a14', accent: '#8b5cf6', surface: '#1e1e32' },
  'neon-blue':   { bg: '#050510', accent: '#00d4ff', surface: '#151540' },
  'amoled-black':{ bg: '#000000', accent: '#ffffff', surface: '#1a1a1a' },
  'spotify-green':{ bg: '#0a0f0a', accent: '#1db954', surface: '#1a2a1a' },
  'sunset':      { bg: '#120a08', accent: '#ff6b35', surface: '#2e1c14' },
  'glass':       { bg: '#0d0d1a', accent: 'rgba(255,255,255,0.9)', surface: 'rgba(255,255,255,0.06)' },
  'system':      { bg: '#0a0a14', accent: '#8b5cf6', surface: '#1e1e32' },
};

export const ThemePicker: React.FC = () => {
  const { themeId, customAccent, setTheme, setCustomAccent, clearCustomAccent } = useThemeStore();
  const colorInputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="bg-[var(--color-surface)] rounded-2xl p-6 border border-[var(--color-border)]">
      <h2 className="text-lg font-bold text-[var(--color-text)] mb-1 flex items-center gap-2">
        <Palette size={20} className="text-[var(--color-accent)]" />
        Theme
      </h2>
      <p className="text-sm text-[var(--color-text-secondary)] mb-5">Choose a look for your app</p>

      {/* Theme grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-3 mb-6">
        {/* System theme */}
        <button
          onClick={() => setTheme('system')}
          className={cn(
            "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-300",
            themeId === 'system'
              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
              : "border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-hover)]"
          )}
        >
          <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center bg-[#1a1a2e]">
            <Monitor size={20} className="text-gray-400" />
          </div>
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">System</span>
          {themeId === 'system' && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-accent)] flex items-center justify-center"
            >
              <Check size={10} className="text-[var(--color-bg)]" />
            </motion.div>
          )}
        </button>

        {/* Theme options */}
        {themes.map((theme) => {
          const preview = themePreviewColors[theme.id] || themePreviewColors['purple'];
          return (
            <button
              key={theme.id}
              onClick={() => setTheme(theme.id)}
              className={cn(
                "relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-300",
                themeId === theme.id
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                  : "border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-hover)]"
              )}
            >
              {/* Color preview */}
              <div className="w-12 h-12 rounded-xl overflow-hidden shadow-lg relative" style={{ background: preview.bg }}>
                <div className="absolute bottom-0 left-0 right-0 h-5" style={{ background: preview.surface }} />
                <div className="absolute top-2 left-2 w-3 h-3 rounded-full" style={{ background: preview.accent }} />
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-white/20" />
              </div>
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">{theme.name}</span>
              {themeId === theme.id && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-accent)] flex items-center justify-center"
                >
                  <Check size={10} className="text-[var(--color-bg)]" />
                </motion.div>
              )}
            </button>
          );
        })}
      </div>

      {/* Custom accent color */}
      <div className="border-t border-[var(--color-border)] pt-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">Accent Color</p>
            <p className="text-xs text-[var(--color-text-muted)]">Customize the accent color across all themes</p>
          </div>
          {customAccent && (
            <button
              onClick={clearCustomAccent}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-all"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          )}
        </div>

        {/* Preset swatches */}
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESET_ACCENTS.map((hex) => (
            <button
              key={hex}
              onClick={() => setCustomAccent(hex)}
              className={cn(
                "w-8 h-8 rounded-full border-2 transition-all duration-200 hover:scale-110",
                customAccent === hex ? "border-[var(--color-text)] scale-110" : "border-transparent"
              )}
              style={{ background: hex }}
              title={hex}
            />
          ))}
          {/* Custom color picker */}
          <button
            onClick={() => colorInputRef.current?.click()}
            className="w-8 h-8 rounded-full border-2 border-dashed border-[var(--color-border-hover)] hover:border-[var(--color-accent)] flex items-center justify-center transition-all"
            title="Custom color"
          >
            <span className="text-[var(--color-text-muted)] text-lg leading-none">+</span>
          </button>
          <input
            ref={colorInputRef}
            type="color"
            value={customAccent || '#8b5cf6'}
            onChange={(e) => setCustomAccent(e.target.value)}
            className="sr-only"
          />
        </div>

        {/* Live preview of current accent */}
        {customAccent && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex items-center gap-3 p-3 rounded-xl bg-[var(--color-surface-hover)] border border-[var(--color-border)]"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: customAccent }}>
              <Palette size={18} style={{ color: customAccent === '#000000' || customAccent === '#000' ? '#fff' : '#000' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--color-text)]">Custom accent active</p>
              <p className="text-xs text-[var(--color-text-muted)] font-mono">{customAccent}</p>
            </div>
            <div className="flex gap-1">
              <div className="w-6 h-6 rounded-full" style={{ background: customAccent }} />
              <div className="w-6 h-6 rounded-full" style={{ background: `color-mix(in srgb, ${customAccent} 70%, black)` }} />
              <div className="w-6 h-6 rounded-full" style={{ background: `color-mix(in srgb, ${customAccent} 30%, black)` }} />
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
};

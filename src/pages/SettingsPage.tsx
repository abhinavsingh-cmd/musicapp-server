import React, { useState, useEffect, useRef } from 'react';
import { useGoBack } from '../hooks/useGoBack';
import { backupService } from '../services/backupService';
import { useQueueStore } from '../stores/queueStore';
import { ThemePicker } from '../features/theme/ThemePicker';
import { motion } from 'framer-motion';
import { Settings, Download, Upload, Save, Zap, Loader2, Check, X, ToggleLeft, ArrowLeft } from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const goBack = useGoBack();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const autoplayEnabled = useQueueStore((s) => s.autoplayEnabled);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await backupService.exportData();
      backupService.downloadBackup(data);
      setMessage({ type: 'success', text: 'Library exported successfully!' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to export library' });
    }
    setExporting(false);
    setTimeout(() => { if (mountedRef.current) setMessage(null); }, 3000);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const result = await backupService.restoreFromFile(file);
      setMessage({ type: result.success ? 'success' : 'error', text: result.message });
    } catch {
      setMessage({ type: 'error', text: 'Failed to import library' });
    }
    setImporting(false);
    setTimeout(() => { if (mountedRef.current) setMessage(null); }, 3000);
  };

  const toggleAutoplay = () => {
    useQueueStore.getState().toggleAutoplay();
  };

  return (
    <div className="p-6 space-y-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={goBack} className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-400 hover:text-white" aria-label="Go back">
          <ArrowLeft size={20} />
        </button>
        <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center">
          <Settings size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-sm text-gray-400">Customize your experience</p>
        </div>
      </div>

      {/* Status Message */}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={`p-4 rounded-xl flex items-center gap-3 ${
            message.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {message.type === 'success' ? <Check size={18} /> : <X size={18} />}
          <span>{message.text}</span>
        </motion.div>
      )}

      {/* Theme */}
      <ThemePicker />

      {/* Backup & Restore */}
      <section className="bg-[#1a1a2e] rounded-2xl p-6 border border-white/5">
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Save size={20} className="text-violet-400" />
          Backup & Restore
        </h2>
        <p className="text-sm text-gray-400 mb-6">
          Export your library, favorites, playlists, and history to a JSON file.
        </p>
        <div className="flex gap-4">
          <motion.button
            onClick={handleExport}
            disabled={exporting}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-500 text-white font-medium disabled:opacity-50"
          >
            {exporting ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
            Export Library
          </motion.button>
          <label>
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-white/5 text-gray-300 font-medium cursor-pointer hover:bg-white/10 transition-all"
            >
              {importing ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
              Import Library
            </motion.div>
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
              disabled={importing}
            />
          </label>
        </div>
      </section>

      {/* Autoplay */}
      <section className="bg-[#1a1a2e] rounded-2xl p-6 border border-white/5">
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <ToggleLeft size={20} className="text-emerald-400" />
          Autoplay
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Automatically play similar songs when your queue ends. Keeps the music going based on your listening history, favorites, and current queue.
        </p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white font-medium">Autoplay</p>
            <p className="text-xs text-gray-400">Continue playing similar songs automatically</p>
          </div>
          <button
            onClick={toggleAutoplay}
            className={`w-14 h-7 rounded-full transition-all relative ${
              autoplayEnabled ? 'bg-emerald-500' : 'bg-white/10'
            }`}
            aria-label={autoplayEnabled ? 'Disable autoplay' : 'Enable autoplay'}
          >
            <div className={`w-6 h-6 rounded-full bg-white transition-transform ${
              autoplayEnabled ? 'translate-x-7' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
      </section>

      {/* Keyboard Shortcuts */}
      <section className="bg-[#1a1a2e] rounded-2xl p-6 border border-white/5">
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Zap size={20} className="text-violet-400" />
          Keyboard Shortcuts
        </h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex justify-between p-2 rounded bg-white/5">
            <span className="text-gray-400">Play / Pause</span>
            <kbd className="px-2 py-0.5 rounded bg-white/10 text-white font-mono">Space</kbd>
          </div>
          <div className="flex justify-between p-2 rounded bg-white/5">
            <span className="text-gray-400">Seek +5s</span>
            <kbd className="px-2 py-0.5 rounded bg-white/10 text-white font-mono">→</kbd>
          </div>
          <div className="flex justify-between p-2 rounded bg-white/5">
            <span className="text-gray-400">Seek -5s</span>
            <kbd className="px-2 py-0.5 rounded bg-white/10 text-white font-mono">←</kbd>
          </div>
          <div className="flex justify-between p-2 rounded bg-white/5">
            <span className="text-gray-400">Next track</span>
            <kbd className="px-2 py-0.5 rounded bg-white/10 text-white font-mono">Shift+→</kbd>
          </div>
          <div className="flex justify-between p-2 rounded bg-white/5">
            <span className="text-gray-400">Previous track</span>
            <kbd className="px-2 py-0.5 rounded bg-white/10 text-white font-mono">Shift+←</kbd>
          </div>
          <div className="flex justify-between p-2 rounded bg-white/5">
            <span className="text-gray-400">Volume Up</span>
            <kbd className="px-2 py-0.5 rounded bg-white/10 text-white font-mono">↑</kbd>
          </div>
          <div className="flex justify-between p-2 rounded bg-white/5">
            <span className="text-gray-400">Volume Down</span>
            <kbd className="px-2 py-0.5 rounded bg-white/10 text-white font-mono">↓</kbd>
          </div>
          <div className="flex justify-between p-2 rounded bg-white/5">
            <span className="text-gray-400">Toggle Like</span>
            <kbd className="px-2 py-0.5 rounded bg-white/10 text-white font-mono">L</kbd>
          </div>
          <div className="flex justify-between p-2 rounded bg-white/5">
            <span className="text-gray-400">Toggle Shuffle</span>
            <kbd className="px-2 py-0.5 rounded bg-white/10 text-white font-mono">S</kbd>
          </div>
          <div className="flex justify-between p-2 rounded bg-white/5">
            <span className="text-gray-400">Cycle Repeat</span>
            <kbd className="px-2 py-0.5 rounded bg-white/10 text-white font-mono">R</kbd>
          </div>
        </div>
      </section>
    </div>
  );
};

export default SettingsPage;

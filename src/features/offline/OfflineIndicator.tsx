import React, { useState, useEffect } from 'react';
import { useDownloadsStore } from '../../stores/downloadsStore';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, Wifi } from 'lucide-react';

/**
 * Floating pill that appears when the device goes offline,
 * and briefly reappears when it comes back online.
 */
export const OfflineIndicator: React.FC = () => {
  const isOnline = useDownloadsStore((s) => s.isOnline);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    if (isOnline) {
      // Brief "Back online" toast
      setShowReconnected(true);
      const t = setTimeout(() => setShowReconnected(false), 3000);
      return () => clearTimeout(t);
    }
  }, [isOnline]);

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full bg-gray-900/90 border border-white/10 backdrop-blur-md shadow-lg"
          >
            <WifiOff size={14} className="text-amber-400" />
            <span className="text-sm font-medium text-gray-300">You're offline</span>
            <span className="text-xs text-gray-500">· downloaded songs still play</span>
          </motion.div>
        )}

        {isOnline && showReconnected && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-900/90 border border-emerald-500/20 backdrop-blur-md shadow-lg"
          >
            <Wifi size={14} className="text-emerald-400" />
            <span className="text-sm font-medium text-emerald-300">Back online</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

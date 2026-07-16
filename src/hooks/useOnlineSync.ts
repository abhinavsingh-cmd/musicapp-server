import { useEffect, useRef } from 'react';
import { useDownloadsStore } from '../stores/downloadsStore';

/**
 * Tracks browser online/offline status and syncs the downloadsStore.
 * Also refreshes cached metadata when the connection is restored.
 */
export function useOnlineSync() {
  const setOnline = useDownloadsStore((s) => s.setOnline);
  const loadDownloads = useDownloadsStore((s) => s.loadDownloads);
  const refreshCacheSize = useDownloadsStore((s) => s.refreshCacheSize);
  const wasOffline = useRef(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      // If we were offline, refresh downloads & cache on reconnect
      if (wasOffline.current) {
        wasOffline.current = false;
        loadDownloads().then(() => refreshCacheSize());
      }
    };

    const handleOffline = () => {
      setOnline(false);
      wasOffline.current = true;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initialize
    setOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline, loadDownloads, refreshCacheSize]);
}

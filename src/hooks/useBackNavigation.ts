import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const HOME_PATHS = ['/', '/home'];

function isNativePlatform(): boolean {
  return !!(window as any).Capacitor;
}

export function useBackNavigation(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    if (!isNativePlatform()) return;

    let cancelled = false;
    let subscription: { remove: () => void } | null = null;

    import('@capacitor/app').then(({ App }) => {
      if (cancelled) return;
      App.addListener('backButton', ({ canGoBack }: { canGoBack: boolean }) => {
        const currentPath = locationRef.current.pathname;

        if (HOME_PATHS.includes(currentPath)) {
          App.exitApp();
          return;
        }

        if (canGoBack || window.history.length > 1) {
          navigate(-1);
        } else {
          navigate('/', { replace: true });
        }
      }).then(sub => {
        if (cancelled) {
          sub.remove();
        } else {
          subscription = sub;
        }
      }).catch(() => {});
    }).catch(() => {});

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [navigate]);
}

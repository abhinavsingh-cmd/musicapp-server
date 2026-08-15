import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from './contexts/ToastContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { metricsCollector } from './services/metricsCollector'
import App from './App.tsx'
import { logger } from './utils/logger'
import './index.css'

// --- Startup performance measurement ---
const perf = {
  mark(name: string) { performance.mark(name); },
  measure(name: string, start: string, end: string) {
    try {
      performance.measure(name, start, end);
      const m = performance.getEntriesByName(name)[0];
      return m?.duration;
    } catch { return undefined; }
  },
  log(label: string, name: string, start: string, end: string) {
    const dur = this.measure(name, start, end);
    if (dur !== undefined) logger.debug(`[Perf] ${label}: ${dur.toFixed(0)}ms`);
    return dur;
  },
};

// Mark the very first frame
perf.mark('app_t0');

// Immediate render with cached data
const initialRender = () => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary level="app">
        <BrowserRouter>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>
  );
};

// Show the app immediately - no blocking
initialRender();

// Preload critical resources in background
if (typeof window !== 'undefined') {
  const defer = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: IdleRequestCallback) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
  
  import('./services/preloadService').then(module => {
    defer(() => module.preloadCriticalResources().catch(() => {}));
  }).catch(() => {});
}

// Measure after first render + paint
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    perf.mark('app_raf2');
    const dur = perf.log('Boot → 2nd RAF', 'boot→raf2', 'app_t0', 'app_raf2');
    if (dur !== undefined) metricsCollector.setStartupTime(dur);
  });
});

// Measure full interactive time
window.addEventListener('load', () => {
  perf.mark('app_load');
  perf.log('Boot → DOMContentLoaded', 'boot→dcl', 'app_t0', 'app_load');
});

// Dev-only: log all startup marks
if (import.meta.env.DEV) {
  window.addEventListener('load', () => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        const entries = performance.getEntriesByType('mark');
        const measures = performance.getEntriesByType('measure');
        console.group('[Perf] Startup Timeline');
        entries.forEach(e => logger.debug(`  ${e.name}: ${e.startTime.toFixed(0)}ms`));
        console.groupEnd();
        console.group('[Perf] Startup Measures');
        measures.forEach(m => logger.debug(`  ${m.name}: ${m.duration.toFixed(0)}ms`));
        console.groupEnd();
      }, 1000);
    });
  });
}

window.addEventListener('unhandledrejection', (e) => {
  logger.error('[Global] Unhandled promise rejection:', e.reason);
  e.preventDefault();
});

window.addEventListener('error', (e) => {
  logger.error('[Global] Uncaught error:', e.error?.message || e.message, e.error?.stack);
  e.preventDefault();
});

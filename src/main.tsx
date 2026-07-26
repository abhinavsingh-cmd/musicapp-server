import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from './contexts/ToastContext'
import App from './App.tsx'
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
    if (dur !== undefined) console.log(`[Perf] ${label}: ${dur.toFixed(0)}ms`);
    return dur;
  },
};

// Mark the very first frame
perf.mark('app_t0');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Measure after first render + paint
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    perf.mark('app_raf2');
    perf.log('Boot → 2nd RAF', 'boot→raf2', 'app_t0', 'app_raf2');
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
        entries.forEach(e => console.log(`  ${e.name}: ${e.startTime.toFixed(0)}ms`));
        console.groupEnd();
        console.group('[Perf] Startup Measures');
        measures.forEach(m => console.log(`  ${m.name}: ${m.duration.toFixed(0)}ms`));
        console.groupEnd();
      }, 1000);
    });
  });
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('[Global] Unhandled promise rejection:', e.reason);
  e.preventDefault();
});

window.addEventListener('error', (e) => {
  console.error('[Global] Uncaught error:', e.error?.message || e.message, e.error?.stack);
});

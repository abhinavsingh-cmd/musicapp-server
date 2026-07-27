import React, { useSyncExternalStore, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, ArrowLeft, Clock, Database, Download, Globe,
  MemoryStick, Search, Zap, AlertTriangle,
  ChevronDown, ChevronRight, Trash2, Radio,
} from 'lucide-react';
import { metricsCollector } from '../services/metricsCollector';
import { cn } from '../utils/cn';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function p95(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)];
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url, location.origin);
    const parts = u.pathname.split('/').filter(Boolean);
    return '/' + parts.slice(-2).join('/');
  } catch {
    return url.slice(0, 40);
  }
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function Section({
  title, icon, children, defaultOpen = true,
}: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-white/5 bg-[#111127] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        {icon}
        <span className="text-sm font-semibold text-white flex-1">{title}</span>
        {open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-2">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric Row
// ---------------------------------------------------------------------------

function Metric({ label, value, good, warn }: {
  label: string; value: string; good?: boolean; warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-gray-400">{label}</span>
      <span className={cn(
        'text-xs font-mono font-medium',
        warn ? 'text-red-400' : good ? 'text-emerald-400' : 'text-white',
      )}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini bar chart
// ---------------------------------------------------------------------------

function MiniBar({ values, max }: { values: number[]; max?: number }) {
  const ceiling = max || Math.max(...values, 1);
  return (
    <div className="flex items-end gap-px h-8">
      {values.slice(-30).map((v, i) => (
        <div
          key={i}
          className={cn(
            'flex-1 rounded-t-sm min-w-[2px]',
            v > 1000 ? 'bg-red-500/70' : v > 500 ? 'bg-amber-500/70' : 'bg-violet-500/70',
          )}
          style={{ height: `${Math.max(4, (v / ceiling) * 100)}%` }}
          title={`${Math.round(v)}ms`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DevPage
// ---------------------------------------------------------------------------

const DevPage: React.FC = () => {
  const navigate = useNavigate();
  const snapshot = useSyncExternalStore(
    metricsCollector.subscribe.bind(metricsCollector),
    metricsCollector.getSnapshot.bind(metricsCollector),
    metricsCollector.getServerSnapshot.bind(metricsCollector),
  );

  const handleClear = useCallback(() => {
    metricsCollector.clear();
  }, []);

  // Derived stats
  const apiLatencies = snapshot.apiLatencies.map(l => l.duration);
  const searchLatencies = snapshot.searchLatencies.map(l => l.duration);
  const streamLatencies = snapshot.streamLatencies.map(l => l.duration);
  const bufferDurations = snapshot.bufferSamples.map(b => b.bufferDuration);

  const recentFailed = snapshot.failedRequests.slice(-10).reverse();

  const dlSpeeds = snapshot.downloadSpeedSamples.map(d => d.bytesPerSecond);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-400 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity size={20} className="text-violet-400" />
            Developer Diagnostics
          </h1>
          <p className="text-xs text-gray-500">Real-time performance metrics</p>
        </div>
        <button
          onClick={handleClear}
          className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-500 hover:text-red-400"
          title="Clear metrics"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* ── Startup ── */}
      <Section title="Startup" icon={<Zap size={14} className="text-amber-400" />}>
        <Metric
          label="Boot time (2nd RAF)"
          value={snapshot.startupTimeMs > 0 ? fmt(snapshot.startupTimeMs) : 'Measuring...'}
          good={snapshot.startupTimeMs > 0 && snapshot.startupTimeMs < 500}
          warn={snapshot.startupTimeMs > 1000}
        />
        <Metric
          label="Total API calls"
          value={String(snapshot.totalApiCalls)}
        />
      </Section>

      {/* ── API Latency ── */}
      <Section title="API Latency" icon={<Globe size={14} className="text-blue-400" />}>
        {apiLatencies.length === 0 ? (
          <p className="text-xs text-gray-600">No API calls recorded yet</p>
        ) : (
          <>
            <MiniBar values={apiLatencies} />
            <Metric label="Samples" value={String(apiLatencies.length)} />
            <Metric label="Average" value={fmt(avg(apiLatencies))} good={avg(apiLatencies) < 500} />
            <Metric label="P95" value={fmt(p95(apiLatencies))} good={p95(apiLatencies) < 1000} />
            <Metric label="Fastest" value={fmt(Math.min(...apiLatencies))} />
            <Metric label="Slowest" value={fmt(Math.max(...apiLatencies))} warn={Math.max(...apiLatencies) > 3000} />
            {/* Recent requests */}
            <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
              {snapshot.apiLatencies.slice(-10).reverse().map((l, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                  <span className={cn('w-1.5 h-1.5 rounded-full', l.ok ? 'bg-emerald-500' : 'bg-red-500')} />
                  <span className="text-gray-500 flex-shrink-0">{fmt(l.duration)}</span>
                  <span className="text-gray-400 truncate">{shortUrl(l.url)}</span>
                  {l.cached && <span className="text-violet-400">cache</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* ── Search Latency ── */}
      <Section title="Search Latency" icon={<Search size={14} className="text-emerald-400" />}>
        {searchLatencies.length === 0 ? (
          <p className="text-xs text-gray-600">No searches recorded yet</p>
        ) : (
          <>
            <MiniBar values={searchLatencies} />
            <Metric label="Samples" value={String(searchLatencies.length)} />
            <Metric label="Average" value={fmt(avg(searchLatencies))} good={avg(searchLatencies) < 800} />
            <Metric label="P95" value={fmt(p95(searchLatencies))} />
            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {snapshot.searchLatencies.slice(-8).reverse().map((l, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                  <span className="text-gray-500 flex-shrink-0">{fmt(l.duration)}</span>
                  <span className="text-gray-400 truncate">"{l.query}"</span>
                  <span className="text-gray-600">{l.resultCount} results</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* ── Stream Latency ── */}
      <Section title="Stream Latency" icon={<Radio size={14} className="text-pink-400" />}>
        {streamLatencies.length === 0 ? (
          <p className="text-xs text-gray-600">No streams played yet</p>
        ) : (
          <>
            <MiniBar values={streamLatencies} />
            <Metric label="Samples" value={String(streamLatencies.length)} />
            <Metric label="Average" value={fmt(avg(streamLatencies))} good={avg(streamLatencies) < 2000} warn={avg(streamLatencies) > 4000} />
            <Metric label="P95" value={fmt(p95(streamLatencies))} warn={p95(streamLatencies) > 5000} />
            <Metric label="Fastest" value={fmt(Math.min(...streamLatencies))} />
            <Metric label="Slowest" value={fmt(Math.max(...streamLatencies))} warn={Math.max(...streamLatencies) > 8000} />
          </>
        )}
      </Section>

      {/* ── Buffer Time ── */}
      <Section title="Buffer Time" icon={<Clock size={14} className="text-orange-400" />}>
        {bufferDurations.length === 0 ? (
          <p className="text-xs text-gray-600">No buffer events recorded yet</p>
        ) : (
          <>
            <MiniBar values={bufferDurations} />
            <Metric label="Buffer events" value={String(bufferDurations.length)} />
            <Metric label="Average" value={fmt(avg(bufferDurations))} good={avg(bufferDurations) < 1000} warn={avg(bufferDurations) > 3000} />
            <Metric label="P95" value={fmt(p95(bufferDurations))} warn={p95(bufferDurations) > 5000} />
          </>
        )}
      </Section>

      {/* ── Memory ── */}
      <Section title="Memory Usage" icon={<MemoryStick size={14} className="text-cyan-400" />}>
        <Metric
          label="JS Heap"
          value={snapshot.memoryUsageMB > 0 ? `${snapshot.memoryUsageMB} MB` : 'N/A (API unavailable)'}
          warn={snapshot.memoryUsageMB > 200}
          good={snapshot.memoryUsageMB > 0 && snapshot.memoryUsageMB < 100}
        />
        <Metric label="Performance entries" value={String(performance.getEntriesByType('resource').length)} />
        <Metric label="Marks" value={String(performance.getEntriesByType('mark').length)} />
        <Metric label="Measures" value={String(performance.getEntriesByType('measure').length)} />
      </Section>

      {/* ── Cache Hit Rate ── */}
      <Section title="Cache Hit Rate" icon={<Database size={14} className="text-violet-400" />}>
        <Metric label="Hits" value={String(snapshot.cacheHits)} />
        <Metric label="Misses" value={String(snapshot.cacheMisses)} />
        <Metric
          label="Hit rate"
          value={snapshot.totalCacheEvents > 0 ? `${snapshot.cacheHitRate.toFixed(1)}%` : 'No data'}
          good={snapshot.cacheHitRate > 60}
          warn={snapshot.cacheHitRate > 0 && snapshot.cacheHitRate < 30}
        />
        <Metric label="Total cache events" value={String(snapshot.totalCacheEvents)} />
      </Section>

      {/* ── Failed Requests ── */}
      <Section
        title={`Failed Requests (${snapshot.failedRequests.length})`}
        icon={<AlertTriangle size={14} className="text-red-400" />}
        defaultOpen={snapshot.failedRequests.length > 0}
      >
        {recentFailed.length === 0 ? (
          <p className="text-xs text-gray-600">No failed requests</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {recentFailed.map((f, i) => (
              <div key={i} className="p-2 rounded-lg bg-red-500/5 border border-red-500/10 text-[10px] font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-red-400">{f.status || 'ERR'}</span>
                  <span className="text-gray-400 truncate">{shortUrl(f.url)}</span>
                </div>
                <div className="text-gray-600 mt-1">{f.error}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Download Speed ── */}
      <Section title="Download Speed" icon={<Download size={14} className="text-indigo-400" />}>
        {dlSpeeds.length === 0 ? (
          <p className="text-xs text-gray-600">No downloads recorded yet</p>
        ) : (
          <>
            <Metric label="Samples" value={String(dlSpeeds.length)} />
            <Metric label="Average" value={`${fmtBytes(Math.round(avg(dlSpeeds)))}/s`} />
            <Metric label="Peak" value={`${fmtBytes(Math.round(Math.max(...dlSpeeds)))}/s`} />
            <MiniBar values={dlSpeeds} />
          </>
        )}
      </Section>

      {/* Footer */}
      <p className="text-center text-[10px] text-gray-700 py-4">
        Navigate to <code className="text-gray-500">/dev</code> to view diagnostics
      </p>
    </div>
  );
};

export default DevPage;

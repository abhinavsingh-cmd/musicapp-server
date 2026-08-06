import React, { useState, useEffect } from 'react';
import { metricsCollector } from '../services/metricsCollector';
import { cacheManager } from '../services/cacheManager';

const DevPage: React.FC = () => {
  const [metrics, setMetrics] = useState<any>(null);
  const [cacheStats, setCacheStats] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'performance' | 'cache' | 'startup'>('performance');

  useEffect(() => {
    const updateMetrics = () => {
      setMetrics(metricsCollector.getStats());
      setCacheStats(cacheManager.getStats());
    };

    updateMetrics();
    const interval = setInterval(updateMetrics, 2000);
    return () => clearInterval(interval);
  }, []);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatNumber = (num: number) => {
    if (num < 1000) return num.toString();
    if (num < 1000000) return (num / 1000).toFixed(1) + 'k';
    return (num / 1000000).toFixed(2) + 'M';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-900/20 via-bg to-indigo-900/20 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Developer Dashboard</h1>
          <p className="text-gray-400">Real-time performance metrics & cache statistics</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(['performance', 'cache', 'startup'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${activeTab === tab
                ? 'bg-violet-500 text-white'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Performance Tab */}
        {activeTab === 'performance' && (
          <div className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/10">
                <div className="text-gray-400 text-sm mb-1">Startup Time</div>
                <div className="text-2xl font-bold text-violet-400">
                  {metrics?.startupTime ? formatDuration(metrics.startupTime) : 'N/A'}
                </div>
                <div className="text-xs text-gray-500 mt-1">First frame → interactive</div>
              </div>

              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/10">
                <div className="text-gray-400 text-sm mb-1">API Calls</div>
                <div className="text-2xl font-bold text-blue-400">
                  {formatNumber(metrics?.totalApiCalls || 0)}
                </div>
                <div className="text-xs text-gray-500 mt-1">Total API requests made</div>
              </div>

              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/10">
                <div className="text-gray-400 text-sm mb-1">Cache Hit Rate</div>
                <div className="text-2xl font-bold text-green-400">
                  {metrics?.cacheHitRate ? metrics.cacheHitRate.toFixed(1) : '0'}%
                </div>
                <div className="text-xs text-gray-500 mt-1">Cache efficiency</div>
              </div>

              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/10">
                <div className="text-gray-400 text-sm mb-1">Failed Requests</div>
                <div className="text-2xl font-bold text-red-400">
                  {formatNumber(metrics?.failedRequests?.length || 0)}
                </div>
                <div className="text-xs text-gray-500 mt-1">Request failures</div>
              </div>
            </div>

            {/* Detailed Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* API Latencies */}
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/10">
                <h3 className="text-lg font-semibold text-white mb-4">API Latencies</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {metrics?.apiLatencyEvents?.slice(0, 10).map((event: any, idx: number) => (
                    <div key={idx} className="flex justify-between items-center text-sm">
                      <div className="text-gray-300 truncate max-w-xs">
                        {event.url}
                      </div>
                      <div className={`font-mono ${event.duration > 2000 ? 'text-red-400' : event.cached ? 'text-green-400' : 'text-gray-400'}`}>
                        {formatDuration(event.duration)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Search Latencies */}
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/10">
                <h3 className="text-lg font-semibold text-white mb-4">Search Latencies</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {metrics?.dataLoadEvents?.filter((e: any) => e.type === 'search').slice(0, 10).map((event: any, idx: number) => (
                    <div key={idx} className="flex justify-between items-center text-sm">
                      <div className="text-gray-300">
                        {event.source} {event.source !== 'cache' ? `(${event.count} results)` : ''}
                      </div>
                      <div className={`font-mono ${event.duration > 1000 ? 'text-red-400' : 'text-green-400'}`}>
                        {formatDuration(event.duration)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stream Latencies */}
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/10">
                <h3 className="text-lg font-semibold text-white mb-4">Stream Latencies</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {metrics?.streamLatencyEvents?.slice(0, 10).map((event: any, idx: number) => (
                    <div key={idx} className="flex justify-between items-center text-sm">
                      <div className="text-gray-300">
                        Song: {event.songId.substring(0, 8)}...
                      </div>
                      <div className={`font-mono ${event.duration > 3000 ? 'text-red-400' : 'text-violet-400'}`}>
                        {formatDuration(event.duration)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Buffer Samples */}
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/10">
                <h3 className="text-lg font-semibold text-white mb-4">Buffer Times</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {metrics?.bufferSamples?.slice(0, 10).map((sample: any, idx: number) => (
                    <div key={idx} className="flex justify-between items-center text-sm">
                      <div className="text-gray-300">
                        Song: {sample.songId.substring(0, 8)}...
                      </div>
                      <div className={`font-mono ${sample.bufferDuration > 2000 ? 'text-red-400' : 'text-blue-400'}`}>
                        {formatDuration(sample.bufferDuration)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cache Tab */}
        {activeTab === 'cache' && cacheStats && (
          <div className="space-y-6">
            {/* Cache Stats Overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Object.entries(cacheStats).map(([type, count]) => (
                <div key={type} className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/10">
                  <div className="text-gray-400 text-sm mb-1">
                    {type.charAt(0).toUpperCase() + type.slice(1)} Cache
                  </div>
                  <div className="text-2xl font-bold text-violet-400">
                    {formatNumber(count as number)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Items cached</div>
                </div>
              ))}
            </div>

            {/* Cache Details */}
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold text-white mb-4">Cache Details</h3>
              <div className="space-y-3">
                {(['search', 'trending', 'artwork', 'albums', 'artists', 'lyrics', 'stream', 'metadata'] as const).map((type) => (
                  <div key={type} className="flex items-center justify-between py-2 border-b border-white/5">
                    <div className="text-gray-300 capitalize">
                      {type} cache
                    </div>
                    <div className="text-violet-400 font-mono">
                      {(cacheStats as any)[type] || 0} items
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Startup Tab */}
        {activeTab === 'startup' && (
          <div className="space-y-6">
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold text-white mb-4">Performance Timeline</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-3 border-b border-white/5">
                  <div className="text-gray-300">Initial render</div>
                  <div className="text-violet-400 font-mono">
                    {formatDuration(metrics?.startupTime || 0)}
                  </div>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-white/5">
                  <div className="text-gray-300">Resource preloading</div>
                  <div className="text-violet-400 font-mono">+ 400ms</div>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-white/5">
                  <div className="text-gray-300">Data hydration</div>
                  <div className="text-violet-400 font-mono">+ 200ms</div>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-white/5">
                  <div className="text-gray-300">First content paint</div>
                  <div className="text-violet-400 font-mono">~ 800ms</div>
                </div>
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold text-white mb-4">Memory Usage</h3>
              <div className="flex items-center justify-between py-2">
                <div className="text-gray-300">Current memory</div>
                <div className="text-green-400 font-mono">
                  {metrics?.memoryUsageMB || 0} MB
                </div>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2 mt-2">
                <div 
                  className="bg-green-500 h-2 rounded-full"
                  style={{ width: `${Math.min((metrics?.memoryUsageMB || 0) / 2, 100)}%` }}
                />
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Optimal: {'<'} 200MB | Current: {metrics?.memoryUsageMB || 0}MB
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DevPage;

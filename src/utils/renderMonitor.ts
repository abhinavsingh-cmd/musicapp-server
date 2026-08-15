// Render monitoring utility for tracking component performance
import { logger } from './logger';
const RENDER_THRESHOLDS = {
  WARNING: 10,   // >10 renders per second
  ERROR: 20,    // >20 renders per second
};

export interface RenderInfo {
  name: string;
  count: number;
  timestamps: number[];
  lastRenderTime: number;
}

class RenderMonitor {
  private renders = new Map<string, RenderInfo>();

  trackRender(componentName: string, renderTime: number): void {
    const now = performance.now();
    let info = this.renders.get(componentName);
    
    if (!info) {
      info = {
        name: componentName,
        count: 0,
        timestamps: [],
        lastRenderTime: 0,
      };
      this.renders.set(componentName, info);
    }

    info.count++;
    info.lastRenderTime = now;
    info.timestamps.push(now);
    
    // Keep only recent timestamps (last 2 seconds)
    info.timestamps = info.timestamps.filter(t => now - t < 2000);

    // Check for performance issues
    const rendersPerSecond = info.timestamps.length;
    if (rendersPerSecond > RENDER_THRESHOLDS.ERROR) {
      logger.error(
        `[RenderMonitor] ${componentName}: High render rate detected! ${rendersPerSecond} renders/second (threshold: ${RENDER_THRESHOLDS.ERROR})`
      );
    } else if (rendersPerSecond > RENDER_THRESHOLDS.WARNING) {
      logger.warn(
        `[RenderMonitor] ${componentName}: Elevated render rate: ${rendersPerSecond} renders/second (threshold: ${RENDER_THRESHOLDS.WARNING})`
      );
    }
    
    if (renderTime > 33) { // >33ms per render
      logger.warn(
        `[RenderMonitor] ${componentName}: Slow render detected: ${renderTime.toFixed(0)}ms`
      );
    }
  }

  getStats(): { component: string; rendersPerSecond: number; avgRenderTime: number }[] {
    return Array.from(this.renders.entries()).map(([name, info]) => {
      const now = performance.now();
      const recentTimestamps = info.timestamps.filter(t => now - t < 1000);
      const rendersPerSecond = recentTimestamps.length;
      const avgRenderTime = info.lastRenderTime ? 16 : 0; // Simplified for now
      
      return {
        component: name,
        rendersPerSecond,
        avgRenderTime,
      };
    });
  }

  exportStats(): string {
    const stats = this.getStats();
    const summary = stats
      .map(s => `${s.component}: ${s.rendersPerSecond}rps, ${s.avgRenderTime.toFixed(0)}ms avg`)
      .join('\n');
    return summary;
  }

  reset(): void {
    this.renders.clear();
  }
}

export const renderMonitor = new RenderMonitor();

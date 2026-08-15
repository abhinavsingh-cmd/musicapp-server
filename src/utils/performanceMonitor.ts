// Performance monitoring and profiling utilities
import { logger } from './logger';
interface PerformanceMeasure {
  name: string;
  duration: number;
  timestamp: number;
  fps?: number;
}

class PerformanceMonitor {
  private measures: PerformanceMeasure[] = [];
  private frameCount = 0;
  private lastFrameTime = performance.now();
  private fps = 60;
  private maxMeasureSamples = 100;

  // Measure individual operations
  measure(name: string, fn: () => any): any {
    const start = performance.now();
    const result = fn();
    const end = performance.now();
    
    const duration = end - start;
    if (duration > 16.67) { // > 16.67ms = < 60 FPS
      logger.warn(`[Performance] Slow operation: ${name} took ${duration.toFixed(0)}ms`);
    }
    
    this.addMeasure({ name, duration, timestamp: start, fps: this.fps });
    return result;
  }

  // Track component renders
  trackRender(componentName: string, renderTime: number): void {
    if (renderTime > 10) { // > 10ms
      logger.warn(`[Performance] Slow render: ${componentName} took ${renderTime.toFixed(0)}ms`);
    }
    this.addMeasure({ name: `${componentName}_render`, duration: renderTime, timestamp: performance.now(), fps: this.fps });
  }

  // Update FPS counter
  updateFPS(): void {
    const now = performance.now();
    const delta = now - this.lastFrameTime;
    this.frameCount++;

    if (delta >= 1000) {
      this.fps = Math.min(60, Math.round((this.frameCount * 1000) / delta));
      this.frameCount = 0;
      this.lastFrameTime = now;

      if (this.fps < 50) {
        logger.warn(`[Performance] Low FPS detected: ${this.fps}`);
      }
    }
  }

  // Memory usage check
  checkMemoryUsage(): void {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      const mb = Math.round(memory.usedJSHeapSize / (1024 * 1024));
      
      if (mb > 200) {
        logger.warn(`[Performance] High memory usage: ${mb}MB`);
      }
    }
  }

  // Get performance metrics
  getMetrics() {
    return {
      fps: this.fps,
      measures: this.measures.slice(-20),
      recentMeasures: this.measures.slice(-10).map(m => ({ ...m, duration: Math.round(m.duration) }))
    };
  }

  // Add measure with sample limit
  private addMeasure(measure: PerformanceMeasure): void {
    this.measures.push(measure);
    if (this.measures.length > this.maxMeasureSamples) {
      this.measures.shift();
    }
  }

  // Export metrics for analysis
  exportMetrics(): string {
    const data = JSON.stringify(this.measures, null, 2);
    return data;
  }

  // Clear measures
  clear(): void {
    this.measures = [];
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor();

// Measure async operations
export async function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const end = performance.now();
    performanceMonitor.trackRender(name, end - start);
    return result;
  } catch (error) {
    logger.error(`[Performance] Error in ${name}:`, error);
    throw error;
  }
}

// Performance mark for critical operations
export function markPerformance(operation: string): void {
  if (performance.mark) {
    performance.mark(`operation-start-${operation}`);
  }
}

export function measurePerformance(operation: string): number {
  if (performance.measure) {
    performance.measure(`operation-${operation}`);
    const measure = performance.getEntriesByName(`operation-${operation}`)[0];
    return measure ? measure.duration : 0;
  }
  return 0;
}

// Setup performance monitoring
export function setupPerformanceMonitoring() {
  if (typeof window !== 'undefined') {
    // Update FPS counter
    const animate = () => {
      performanceMonitor.updateFPS();
      performanceMonitor.checkMemoryUsage();
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);

    // Monitor memory leaks
    if ('memory' in performance) {
      setInterval(() => {
        performanceMonitor.checkMemoryUsage();
      }, 5000);
    }
  }
}
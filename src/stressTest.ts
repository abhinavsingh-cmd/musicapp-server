/**
 * Stress Test for Song Change Layout Stability
 * 
 * Run this in browser console to test rapid song changes:
 * 
 * import { stressTestSongChanges } from './stressTest';
 * await stressTestSongChanges(1000);
 */

import { useQueueStore } from './stores/queueStore';
import { sampleSongs } from './data/sampleSongs';

interface TestResult {
  totalChanges: number;
  layoutShifts: number;
  errors: string[];
  duration: number;
  avgTimePerChange: number;
}

let layoutShiftCount = 0;
let errorCount = 0;
const errors: string[] = [];

function detectLayoutShift(): boolean {
  const mainContent = document.querySelector('main.flex-1');
  const sidebar = document.querySelector('aside.w-64') || document.querySelector('.hidden.lg\\:block');
  const player = document.querySelector('.fixed.bottom-0');
  
  if (!mainContent || !player) return false;
  
  const mainRect = mainContent.getBoundingClientRect();
  const playerRect = player.getBoundingClientRect();
  
  // Check if main content is visible and not overlapped
  const isMainVisible = mainRect.height > 100 && mainRect.width > 100;
  const isPlayerAtBottom = playerRect.bottom === window.innerHeight || playerRect.bottom >= window.innerHeight - 5;
  const sidebarOverlaps = sidebar ? sidebar.getBoundingClientRect().right > mainRect.left : false;
  
  return !isMainVisible || !isPlayerAtBottom || sidebarOverlaps;
}

export async function stressTestSongChanges(iterations: number = 1000): Promise<TestResult> {
  const startTime = performance.now();
  layoutShiftCount = 0;
  errorCount = 0;
  errors.length = 0;
  
  const queueStore = useQueueStore.getState();
  
  // Use sample songs for testing
  const testSongs = [...sampleSongs];
  if (testSongs.length < 2) {
    return { totalChanges: 0, layoutShifts: 0, errors: ['Not enough test songs'], duration: 0, avgTimePerChange: 0 };
  }
  
  // Set up initial queue
  const initialPlaylist = testSongs.slice(0, 10);
  queueStore.setQueue(initialPlaylist, 0);
  
  console.log(`Starting stress test: ${iterations} song changes...`);
  
  for (let i = 0; i < iterations; i++) {
    const songIndex = i % testSongs.length;
    
    try {
      // Trigger song change
      queueStore.playAtIndex(songIndex % initialPlaylist.length);
      
      // Wait for state to settle
      await new Promise(r => setTimeout(r, 10));
      
      // Check for layout shifts
      if (detectLayoutShift()) {
        layoutShiftCount++;
        if (layoutShiftCount <= 5) { // Log first few
          console.warn(`Layout shift detected at iteration ${i + 1}`);
        }
      }
      
      // Check for console errors
      if (errorCount > 0) {
        break;
      }
      
      // Progress log
      if ((i + 1) % 100 === 0) {
        console.log(`Progress: ${i + 1}/${iterations} song changes`);
      }
    } catch (err) {
      errors.push(`Iteration ${i}: ${err instanceof Error ? err.message : String(err)}`);
      errorCount++;
    }
  }
  
  const endTime = performance.now();
  const duration = endTime - startTime;
  
  console.log(`\n=== Stress Test Results ===`);
  console.log(`Total changes: ${iterations}`);
  console.log(`Layout shifts: ${layoutShiftCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Duration: ${duration.toFixed(2)}ms`);
  console.log(`Avg time/change: ${(duration / iterations).toFixed(2)}ms`);
  
  if (errors.length > 0) {
    console.log('Errors:', errors);
  }
  
  return {
    totalChanges: iterations,
    layoutShifts: layoutShiftCount,
    errors,
    duration,
    avgTimePerChange: duration / iterations
  };
}

// Auto-run if in browser console
if (typeof window !== 'undefined' && (window as any).__STRESS_TEST__) {
  stressTestSongChanges((window as any).__STRESS_TEST__).then(result => {
    (window as any).__STRESS_TEST_RESULT__ = result;
  });
}
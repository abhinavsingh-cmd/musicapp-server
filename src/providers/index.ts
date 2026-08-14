/**
 * Music-source providers — public API.
 *
 * Importing this module registers the default providers (YouTube, Library,
 * JioSaavn) on the shared registry. The player and download system consume
 * everything through the resolve helpers below and never touch provider
 * internals.
 */

export * from './types';
export { providerRegistry } from './registry';
export { toTrack, toSong, trackKey, inferProvider } from './adapters';
export {
  resolvePlayableSource,
  resolveDownloadDescriptor,
  resolvePlayableFor,
  playableToEngineParams,
} from './resolve';
export type { EnginePlayParams } from './resolve';
export { youtubeProvider } from './youtubeProvider';
export { libraryProvider } from './libraryProvider';
export { jiosaavnProvider } from './jiosaavnProvider';

import { jiosaavnProvider } from './jiosaavnProvider';
import { libraryProvider } from './libraryProvider';
import { providerRegistry } from './registry';
import { youtubeProvider } from './youtubeProvider';

let initialized = false;

/** Register the built-in providers exactly once. */
export function initProviders(): void {
  if (initialized) return;
  initialized = true;
  providerRegistry.register(youtubeProvider);
  providerRegistry.register(libraryProvider);
  providerRegistry.register(jiosaavnProvider);
}

initProviders();
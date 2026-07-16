import { AudioService } from './audioService';

/** Shared AudioService singleton used by both audioStore and queueStore */
export const audioService = new AudioService();

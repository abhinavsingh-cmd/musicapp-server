// Shared music content filtering and scoring logic.
// Used by searchStore.ts client-side. Server.cjs has its own copy.

export interface FilterableSong {
  id?: string;
  title?: string;
  artist?: string;
  channel?: string;
  duration?: number;
  viewCount?: number;
  view_count?: number;
  channel_is_verified?: boolean;
}

export const MUSIC_SKIP_WORDS = [
  'lyrics video', 'lyric video', 'karaoke', 'instrumental', 'cover by',
  'live performance', 'live at', 'performs', 'acoustic session',
  'reaction', 'react to', 'reacting', 'my reaction',
  'interview', 'behind the scenes', 'making of', 'documentary',
  'tutorial', 'how to', 'lesson', 'learn', 'music theory',
  'unboxing', 'vlog', 'day in my life',
  'compilation', 'top 10', 'best of', 'countdown',
  'album mix', 'jukebox', 'full album', 'playlist mix',
  'slowed + reverb', 'slowed and reverb', 'sped up', 'nightcore',
  'mashup', 'remix by', 'bootleg', 'flip',
  'gaming', 'gameplay', 'lets play', 'walkthrough',
  'podcast', 'pod', 'talk show', 'radio show',
  'shorts', 'short', 'ytshorts', 'youtube short',
  'trailer', 'teaser', 'preview', 'snippet',
  'dance tutorial', 'choreography', 'dance practice',
  'parody', 'tribute', 'homage',
  'analysis', 'review', 'breakdown', 'explained',
  'audio', 'sound effect', 'sfx', 'ringtone',
  'news', 'update', 'announcement', 'press conference',
  'premiere', 'red carpet', 'awards show', 'concert footage',
  'studio session', 'recording session', 'behind the music',
  'fan made', 'fan edit', 'fan video',
  'lyrics', 'text', 'words', 'subtitles',
  'visualizer', 'visual', 'loops', 'aesthetic',
  '8d audio', '3d audio', 'binaural', 'immersive',
  'bass boosted', 'bass boosted version', 'bass boost',
  'elevator music', 'hold music', 'background music',
  'workout', 'exercise', 'gym', 'running', 'workout motivation',
  'study music', 'lo-fi', 'lofi', 'chill beats', 'relaxing',
  'meditation', 'yoga', 'sleep', 'ambient', 'nature sounds',
  'cooking', 'recipe', 'food', 'restaurant',
  'travel', 'adventure', 'trip', 'journey',
  'fashion', 'makeup', 'beauty', 'skincare', 'outfit',
  'tech', 'gadget', 'comparison',
  'car', 'automobile', 'vehicle', 'driving', 'test drive',
  'sports', 'football', 'basketball', 'soccer', 'cricket',
  'fitness', 'gym', 'training',
  'comedy', 'funny', 'humor', 'joke', 'prank',
  'politics', 'current events', 'debate',
  'education', 'lecture', 'course',
];

// Strip common title noise for better matching
export function normalizeTitle(raw: string): string {
  return raw
    .replace(/\(Official( Music)? Video\)/gi, '')
    .replace(/\[Official( Music)? Video\]/gi, '')
    .replace(/\(Official Audio\)/gi, '')
    .replace(/\(Audio\)/gi, '')
    .replace(/\(Lyrics\)/gi, '')
    .replace(/\(Lyric Video\)/gi, '')
    .replace(/\[Lyrics?\]/gi, '')
    .replace(/\(Visualizer\)/gi, '')
    .replace(/\(VEVO\)/gi, '')
    .replace(/\(4K\)/gi, '')
    .replace(/\(HD\)/gi, '')
    .replace(/\(Explicit\)/gi, '')
    .replace(/\(Clean\)/gi, '')
    .replace(/\(Remastered\)/gi, '')
    .replace(/\(Remaster\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Normalize artist name for comparison
export function normalizeArtist(raw: string): string {
  return raw
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .replace(/\s*Official$/i, '')
    .trim()
    .toLowerCase();
}

// Deduplicate songs by normalized title + artist, keeping highest viewCount
export function deduplicateByTitleArtist<T extends { title?: string; artist?: string; channel?: string; viewCount?: number; view_count?: number }>(
  songs: T[],
): T[] {
  const seen = new Map<string, T>();
  for (const s of songs) {
    const title = normalizeTitle(s.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const artist = normalizeArtist(s.artist || s.channel || '');
    const key = `${title}|${artist}`;
    const existing = seen.get(key);
    if (!existing || ((s.viewCount || s.view_count || 0) > (existing.viewCount || existing.view_count || 0))) {
      seen.set(key, s);
    }
  }
  return Array.from(seen.values());
}

export function isMusicResult(r: FilterableSong): boolean {
  if (!r || !r.id || !r.title) return false;
  const title = r.title || '';
  const artist = r.artist || r.channel || '';
  const lower = (title + ' ' + artist).toLowerCase();

  if (r.duration && r.duration > 0 && (r.duration < 60 || r.duration > 600)) return false;
  for (const w of MUSIC_SKIP_WORDS) {
    if (lower.includes(w)) return false;
  }
  if (title.length < 3 || title.length > 200) return false;
  if (/^\d+$/.test(title.trim())) return false;
  if (lower.includes('subscribe') && lower.includes('channel')) return false;
  if (artist && /compilation|playlist|mix|best of|top \d/i.test(artist)) return false;
  return true;
}

export function scoreMusicResult(r: FilterableSong, query: string): number {
  let score = 0;
  const title = normalizeTitle(r.title || '').toLowerCase();
  const artist = (r.artist || r.channel || '').toLowerCase();
  const q = (query || '').toLowerCase();
  const qWords = q.split(/\s+/).filter((w: string) => w.length > 2);

  if (/\b(official|official music video|official video|official audio)\b/.test(title)) score += 50;
  if (/\b(topic|vevo)\b/.test(artist)) score += 40;
  if (/\b(topic|vevo)\b/.test(title)) score += 30;
  if (r.channel_is_verified) score += 20;
  if (/official\s*(audio|video|music video)/.test(title)) score += 25;
  if (/\b(lyric video|visualizer|official visual)\b/.test(title)) score += 15;

  const qInTitle = qWords.filter((w: string) => title.includes(w)).length;
  score += qInTitle * 15;

  if (title.includes(q)) score += 60;
  if (title.startsWith(q)) score += 20;

  if (r.duration && r.duration > 120 && r.duration < 480) score += 20;
  else if (r.duration && r.duration >= 180 && r.duration <= 360) score += 10;

  const views = r.viewCount || r.view_count || 0;
  if (views > 1000000000) score += 40;
  else if (views > 100000000) score += 30;
  else if (views > 10000000) score += 20;
  else if (views > 1000000) score += 10;
  else if (views > 100000) score += 5;

  if (/\b(song|music|audio|official)\b/.test(title)) score += 10;
  if (!/\b(live|concert|tour|festival|acoustic|unplugged)\b/.test(title)) score += 5;
  if (/\b(explicit|clean)\b/.test(title)) score += 3;

  if (/\b(live|concert|tour|festival|acoustic|unplugged|performs|session)\b/.test(title)) score -= 30;
  if (/\b(fan|edit|tribute|cover|parody|mashup|remix)\b/.test(artist)) score -= 20;
  if (/\b(sports|football|basketball|soccer|cricket|goals|skills)\b/.test(title)) score -= 40;

  return score;
}

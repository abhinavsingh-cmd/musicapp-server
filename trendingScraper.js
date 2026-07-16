const https = require('https');
const http = require('http');

const TRENDING_QUERIES = [
  // Current trending 2025-2026
  "trending songs 2025",
  "top hits 2025",
  "viral songs 2025",
  "billboard hot 100 2025",
  "spotify top 50 2025",
  "trending Bollywood songs 2025",
  "trending Hindi songs 2025",
  "trending K-pop 2025",
  "trending Latin songs 2025",
  "new music releases 2025",
  "most popular songs right now",
  "trending TikTok songs 2025",
  "number 1 songs 2025",
  "hot right now music",
  "new songs this week",
  "trending Afrobeats 2025",
  "trending Punjabi songs 2025",
  "best new music 2025",
  "viral TikTok music 2025",
  "top 40 hits 2025",
  "trending English songs 2025",
  "new pop songs 2025",
  "trending rap songs 2025",
  "new hip hop 2025",
  "trending rock songs 2025",
  "latest Hindi hits",
  "Arijit Singh new song 2025",
  "Shreya Ghoshal new song 2025",
  "Badshah new song 2025",
  "Diljit Dosanjh new song 2025",
  "Taylor Swift new song 2025",
  "The Weeknd new song 2025",
  "Drake new song 2025",
  "BTS new song 2025",
  "BLACKPINK new song 2025",
  "Bad Bunny new song 2025",
  "Shakira new song 2025",
  "Billie Eilish new song 2025",
  "Sabrina Carpenter trending",
  "Dua Lipa trending",
  "Ed Sheeran new song 2025",
  "Imagine Dragons trending",
  "Maroon 5 new song 2025",
  "Bruno Mars trending 2025",
  "Lady Gaga trending 2025",
  "Post Malone trending 2025",
  "Olivia Rodrigo trending",
  "Harry Styles trending",
  "Rihanna trending 2025",
  "Eminem new song 2025",
  "Kendrick Lamar trending",
];

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      timeout: 8000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function extractVideoIds(html) {
  const ids = [];
  const regex = /"videoId":"([A-Za-z0-9_-]{11})"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    ids.push(match[1]);
  }
  return [...new Set(ids)];
}

function extractTitle(html, videoId) {
  // Try to extract title from the page
  const titleRegex = /<title>(.*?)<\/title>/;
  const match = html.match(titleRegex);
  if (match) {
    return match[1]
      .replace(/ - YouTube$/, '')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\|/g, '-')
      .trim();
  }
  return null;
}

async function verifyYouTubeId(id) {
  try {
    const url = `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
    const data = await fetchPage(url);
    return data.length > 500; // Valid thumbnail is >500 bytes
  } catch {
    return false;
  }
}

async function getSongTitle(id) {
  try {
    const url = `https://www.youtube.com/watch?v=${id}`;
    const html = await fetchPage(url);
    return extractTitle(html, id);
  } catch {
    return null;
  }
}

function parseTitle(title) {
  if (!title) return null;
  
  // Common patterns:
  // "Artist - Song Name (Official Music Video)"
  // "Song Name - Artist (Official Video)"
  // "Artist - Song Name [Official Music Video]"
  
  let cleaned = title
    .replace(/\(Official( Music)? Video\)/gi, '')
    .replace(/\[Official( Music)? Video\]/gi, '')
    .replace(/\(Lyrics\)/gi, '')
    .replace(/\[Lyrics\]/gi, '')
    .replace(/\(Lyric Video\)/gi, '')
    .replace(/\(Audio\)/gi, '')
    .replace(/\(Official Audio\)/gi, '')
    .replace(/\(Official Single\)/gi, '')
    .replace(/\(Music Video\)/gi, '')
    .replace(/\(VEVO\)/gi, '')
    .replace(/\(4K\)/gi, '')
    .replace(/\(HD\)/gi, '')
    .replace(/\(Remastered\)/gi, '')
    .trim();

  // Try to split by " - "
  const parts = cleaned.split(' - ');
  if (parts.length >= 2) {
    // Could be "Artist - Song" or "Song - Artist"
    // Heuristic: if first part is shorter, it's likely the artist
    const artist = parts[0].trim();
    const songName = parts.slice(1).join(' - ').trim();
    return { artist, title: songName };
  }

  // If no dash, try parentheses
  const parenMatch = cleaned.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (parenMatch) {
    return { artist: parenMatch[2].trim(), title: parenMatch[1].trim() };
  }

  // Default: unknown artist
  return { artist: 'Unknown', title: cleaned };
}

function guessGenre(title, artist) {
  const t = (title + ' ' + artist).toLowerCase();
  if (/punjabi|diljit|badshah|ap dhillon|sidhu moosewala|karan aujla/.test(t)) return 'Indian';
  if (/bollywood|arijit singh|shreya ghoshal|atif aslam|udit narayan|sonu nigam|kishore kumar|lata mangeshkar|rahat fateh ali khan|kumar sanu|alka yagnik|KK|shaan|sunidhi chauhan|sonu nigam|sukhwinder singh|sachin jigar|vishal mishra|pritam|ankit tiwari|mithoon|jeet gannguli| Rochak kohli|tanishk bagchi|mitti|bpraak|guru randhawa|karan aujla|diljit dosanjh/.test(t)) return 'Indian';
  if (/kpop|bts|blackpink|aespa|twice|ive|newjeans|stray kids|ateez|lesserafim|seventeen|red velvet|nct|exo|txt|enhypen|gi-dle|izone|woosung|jennie|lisa|rosé|jimin|jungkook|v |rm |suga |j-hope |jin /.test(t)) return 'K-Pop';
  if (/reggaeton|bad bunny|j balvin|ozuna|karol g|maluma|rauw alejandro|daddy yankee|wisin|yandel|feid|myke towers|nicky jam|luny|arcangel|don omar|becky g|natti natasha|sech|rafa|chencho|fuerza regida|natanael cano|peso pluma/.test(t)) return 'Latin';
  if (/afrobeats|burna boy|wizkid|davido|rema|fireboy|ayra star|tems|asake|omah lay|ckay|black sherif|shenseea|skillibeng/.test(t)) return 'Afrobeats';
  if (/rap|hip hop|drake|kendrick|j cole|travis scott|post malone|migos|cardi b|meg thee stallion|da baby|lil baby|glo rilla|doechii|future|21 savage|lil durk|rod wave|gunna|lil uzi|playboi carti|kanye|jay-z|eminem|nicki minaj|lil nas|jack harlow|baby keem|logic|tech n9ne|NF|joyner lucas|jID|denzel curry|coi leray|sZA|summer walker|brent faiyaz|lucky daye|6lack|snoh aalegra|party next door/.test(t)) return 'Hip Hop';
  if (/rock|metal|linkin park|imagine dragons|maroon 5|one republic|coldplay|green day|nirvana|metallica|ac\/dc|guns n|queen|bon jovi|foo fighters|the killers|arctic monkeys|twenty one pilots|fall out boy|panic at the disco|weezer|red hot chili|system of a down|rammstein|slipknot|iron maiden|black sabbath|deep purple|led zeppelin|the rolling stones|the beatles|the who|pink floyd/.test(t)) return 'Rock';
  if (/electro|edm|dubstep|house|techno|trance|alan walker|marshmello|calvin harris|david guetta|martin garrix|tiesto|deadmau5|skrillex|diplo|zedd|kygo|louis the child|synth|future bass/.test(t)) return 'Electronic';
  if (/indie|alternative|tame impala|arctic monkeys|cage the elephant|vampire weekend|mgmt|the 1975|hozier|lana del rey|phoenix|glass animals|clairo|role model|beabadoobee|laufey|men i trust|still woozy|boy pablo| rex orange county|clairo|grace|benson boone|gigi perez|sam fender/.test(t)) return 'Indie';
  if (/rnb|soul|rnb|the weeknd|sza|summer walker|brent faiyaz|6lack|snoh aalegra|party next door|daniel caesar|her|jazmine sullivan|lucky daye|jacob collier|lalah hathaway|dexter morales|jill scott|erykah badu|d'angelo|frank ocean|anderson .paak|silk sonic|bruno mars|charlie wilson|teddy swims|leon thomas/.test(t)) return 'R&B';
  if (/country|morgan wallen|luke combs|blake shelton|carrie underwood|kacey musgraves|chris stapleton|john pardi|elly langley|jelly roll|zach bryan|noah kahan|sam hunt|kane brown/.test(t)) return 'Country';
  if (/pop|taylor swift|ariana grande|billie eilish|dua lipa|olivia rodrigo|sabrina carpenter|charli xcx|chappell roan|katy perry|lady gaga|rihanna|beyonce|shakira|justin timberlake|justin bieber|bruno mars|ed sheeran|shawn mendes|niall horan|liam payne|one direction|harry styles|the kid laroi|måneskin|elton john|david bowie/.test(t)) return 'Pop';
  
  return 'Pop'; // default
}

async function scrapeTrending(existingIds) {
  const newSongs = [];
  const processedIds = new Set();
  
  console.log(`[Trending] Starting scrape with ${TRENDING_QUERIES.length} queries...`);
  
  for (let i = 0; i < TRENDING_QUERIES.length; i++) {
    const query = TRENDING_QUERIES[i];
    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const html = await fetchPage(searchUrl);
      const ids = extractVideoIds(html);
      
      for (const id of ids.slice(0, 5)) { // Top 5 per query
        if (existingIds.has(id) || processedIds.has(id)) continue;
        processedIds.add(id);
        
        // Verify the ID
        const valid = await verifyYouTubeId(id);
        if (!valid) continue;
        
        // Get title
        const title = await getSongTitle(id);
        if (!title) continue;
        
        const parsed = parseTitle(title);
        if (!parsed || parsed.title.length < 2) continue;
        
        const genre = guessGenre(parsed.title, parsed.artist);
        const duration = 180 + Math.floor(Math.random() * 120); // 3-5 min estimate
        
        newSongs.push({
          id,
          title: parsed.title,
          artist: parsed.artist,
          genre,
          duration,
        });
        
        existingIds.add(id);
      }
      
      if (i % 10 === 0) {
        console.log(`[Trending] Progress: ${i + 1}/${TRENDING_QUERIES.length} queries, found ${newSongs.length} new songs`);
      }
      
      // Small delay to be nice
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      // Skip failed queries
    }
  }
  
  console.log(`[Trending] Done. Found ${newSongs.length} new trending songs`);
  return newSongs;
}

module.exports = { scrapeTrending };

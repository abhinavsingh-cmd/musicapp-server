import { Song } from '../types/music';

const generateId = (prefix: string) => `${prefix}-${Math.random().toString(36).substr(2, 9)}`;

const audioSources = [
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
];

const hindiSongNames = [
  'Tum Hi Ho', 'Kal Ho Naa Ho', 'Chaiyya Chaiyya', 'Jai Ho', 'Maula Mere',
  'Kabira', 'Agar Tum Saath Ho', 'Tera Ban Jaunga', 'Pachtaoge', 'Vaaste',
  'Apna Bana Le', 'Phir Aur Kya Chahiye', 'O Maahi', 'Satranga', 'Soulmate',
  'Lut Gaye', 'Pasoori', 'Raataan Lambiyan', 'Kesariya', 'Mast Qalandar',
  'Dil Diyan Gallan', 'Ae Dil Hai Mushkil', 'Zaalima', 'Gerua', 'Janam Janam',
  'Senorita', 'Hawa Banke', 'Filhall', 'Toofan', 'Malang',
];

const englishSongNames = [
  'Blinding Lights', 'Shape of You', 'Bohemian Rhapsody', 'Hotel California',
  'Stairway to Heaven', 'Imagine', 'Yesterday', 'Hey Jude', 'Let It Be',
  'Billie Jean', 'Thriller', 'Smooth Criminal', 'Beat It',
  'Perfect', 'Thinking Out Loud', 'Shape of My Heart',
  'Bad Guy', 'Shake It Off', 'Love Story', 'Anti-Hero',
  'Yellow', 'Viva La Vida', 'Fix You', 'The Scientist',
  'Circles', 'Sunflower', 'Old Town Road', 'Watermelon Sugar',
  'Levitating', 'Stay',
];

export const sampleSongs: Song[] = [];

const genres = ['Bollywood', 'Hindi Pop', 'Indie', 'Electronic', 'Hip Hop', 'R&B', 'Rock', 'Pop', 'Folk', 'Classical', 'Jazz'];

const hindiArtists = ['Arijit Singh', 'Atif Aslam', 'Sonu Nigam', 'Shreya Ghoshal', 'Neha Kakkar', 'Jubin Nautiyal', 'Amit Trivedi', 'Pritam'];
const englishArtists = ['The Beatles', 'Michael Jackson', 'Ed Sheeran', 'Taylor Swift', 'Coldplay', 'The Weeknd', 'Drake', 'Dua Lipa'];

for (let i = 1; i <= 500; i++) {
  const isHindi = i % 2 === 0;
  const isBollywood = i % 5 === 0;
  const artist = isHindi
    ? hindiArtists[Math.floor(Math.random() * hindiArtists.length)]
    : englishArtists[Math.floor(Math.random() * englishArtists.length)];

  const songNames = isHindi ? hindiSongNames : englishSongNames;
  const title = songNames[i % songNames.length] || `Song ${i}`;
  const genre = genres[Math.floor(Math.random() * genres.length)];
  const releaseYear = Math.floor(Math.random() * (2024 - 1990 + 1)) + 1990;
  const duration = Math.floor(Math.random() * (300 - 120 + 1)) + 120;
  const isFavorite = Math.random() > 0.8;

  sampleSongs.push({
    id: generateId('song'),
    title,
    artist,
    album: isBollywood ? `Bollywood Album ${i}` : `Album ${i}`,
    duration,
    genre,
    coverArt: `https://picsum.photos/seed/${i}/300/300.jpg`,
    audioUrl: audioSources[i % audioSources.length],
    releaseYear,
    isFavorite,
    playCount: Math.floor(Math.random() * 50000),
    addedAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
    lyrics: `Lyrics for ${title} by ${artist}.`,
  });
}

const featuredSongs: Omit<Song, 'id'>[] = [
  {
    title: 'Tum Hi Ho',
    artist: 'Arijit Singh',
    album: 'Aashiqui 2',
    duration: 262,
    genre: 'Bollywood',
    coverArt: 'https://picsum.photos/seed/hindi1/300/300.jpg',
    audioUrl: audioSources[0],
    releaseYear: 2013,
    isFavorite: true,
    playCount: 95000,
    addedAt: new Date().toISOString(),
    lyrics: 'Hum tere bin ab reh nahi sakte, tere bina kya wajood mera...',
  },
  {
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    duration: 200,
    genre: 'Pop',
    coverArt: 'https://picsum.photos/seed/pop1/300/300.jpg',
    audioUrl: audioSources[1],
    releaseYear: 2020,
    isFavorite: true,
    playCount: 88000,
    addedAt: new Date().toISOString(),
    lyrics: "I've been tryna call, I've been on my own for long enough...",
  },
  {
    title: 'Kesariya',
    artist: 'Arijit Singh',
    album: 'Brahmastra',
    duration: 268,
    genre: 'Bollywood',
    coverArt: 'https://picsum.photos/seed/hindi2/300/300.jpg',
    audioUrl: audioSources[2],
    releaseYear: 2022,
    isFavorite: true,
    playCount: 78000,
    addedAt: new Date().toISOString(),
    lyrics: 'Kesariya tera ishq hai piya, rang jaaun jo main haath lagaaun...',
  },
  {
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    album: 'A Night at the Opera',
    duration: 354,
    genre: 'Rock',
    coverArt: 'https://picsum.photos/seed/rock1/300/300.jpg',
    audioUrl: audioSources[3],
    releaseYear: 1975,
    isFavorite: true,
    playCount: 92000,
    addedAt: new Date().toISOString(),
    lyrics: "Is this the real life? Is this just fantasy?...",
  },
  {
    title: 'Shape of You',
    artist: 'Ed Sheeran',
    album: 'Divide',
    duration: 234,
    genre: 'Pop',
    coverArt: 'https://picsum.photos/seed/indie1/300/300.jpg',
    audioUrl: audioSources[4],
    releaseYear: 2017,
    isFavorite: false,
    playCount: 85000,
    addedAt: new Date().toISOString(),
    lyrics: "The club isn't the best place to find a lover, so the bar is where I go...",
  },
  {
    title: 'Chaiyya Chaiyya',
    artist: 'Sukhwinder Singh',
    album: 'Dil Se',
    duration: 370,
    genre: 'Bollywood',
    coverArt: 'https://picsum.photos/seed/dance1/300/300.jpg',
    audioUrl: audioSources[5],
    releaseYear: 1998,
    isFavorite: false,
    playCount: 72000,
    addedAt: new Date().toISOString(),
    lyrics: 'Chaiyya chaiyya chaiyya chaiyya, chirag tere jal rahe hain...',
  },
];

featuredSongs.forEach((song) => {
  sampleSongs.push({ ...song, id: generateId('feat') });
});

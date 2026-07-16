const fs = require('fs');
const working = JSON.parse(fs.readFileSync('/tmp/working-songs.json', 'utf8'));

let lines = working.map(s => 
  `  ["${s.youtubeId}","${s.title}","${s.artist}","${s.genre}",${s.duration}]`
);

const serverContent = `const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());

const SONGS = [
${lines.join(',\n')}
];

const seen = new Set();
const songs = SONGS.filter(s => { if (seen.has(s[0])) return false; seen.add(s[0]); return true; })
  .map((s, i) => ({ id: 'yt-' + i, youtubeId: s[0], title: s[1], artist: s[2], genre: s[3], duration: s[4], coverArt: 'https://img.youtube.com/vi/' + s[0] + '/mqdefault.jpg' }));

app.get('/api/songs', (_req, res) => res.json({ songs, total: songs.length }));
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (!q) return res.json({ songs });
  res.json({ songs: songs.filter(s => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q)) });
});
app.get('/api/genre/:genre', (req, res) => {
  res.json({ songs: songs.filter(s => s.genre.toLowerCase() === req.params.genre.toLowerCase()) });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('Server: ' + songs.length + ' songs on http://localhost:' + PORT));
`;

fs.writeFileSync('server.cjs', serverContent);
console.log('Wrote server.cjs with', working.length, 'verified songs');

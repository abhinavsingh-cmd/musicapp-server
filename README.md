# Music App

A full-featured music streaming application with offline downloads, background playback, and multi-provider support. Built as a PWA and packaged for Android via Capacitor.

## Features

- **Multi-provider streaming** — JioSaavn and YouTube audio sources with a pluggable provider registry
- **Offline downloads** — songs cached in IndexedDB with progress tracking, pause/resume, and LRU eviction
- **Background playback** — foreground service on Android keeps audio playing when the app is backgrounded
- **Media Session API** — lock-screen and notification controls
- **Queue management** — shuffle, repeat (off/all/one), and autoplay with smart recommendations
- **Playlists & Albums** — create, edit, reorder (drag-and-drop), and browse
- **Search** — across providers with debounced queries
- **Charts & Trending** — live trending data with disk caching and retry/backoff
- **Lyrics** — synced (LRC) and plain-text lyric display
- **Audio effects** — 10-band equalizer, bass boost, virtualizer, stereo widening, loudness, limiter
- **Themes** — multiple color themes with persistent selection
- **Keyboard shortcuts** — play/pause, next/prev, seek, volume, shuffle
- **PWA** — installable, offline-capable, with a service worker

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, TypeScript 5.8 |
| Styling | Tailwind CSS 4 |
| State | Zustand |
| Routing | React Router 7 |
| Animation | Framer Motion |
| Drag & Drop | @dnd-kit |
| Icons | Lucide React |
| Mobile | Capacitor 8 (Android) |
| Backend | Express 5 (`server.cjs`) |
| Testing | Vitest, Playwright |

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
npm install
```

### Development

Starts the Express backend and Vite dev server concurrently:

```bash
npm run dev
```

The app is available at `http://localhost:3000`.

To run only the backend or frontend:

```bash
npm run dev:backend   # Express server only
npm run dev:frontend  # Vite dev server only
```

### Build

```bash
npm run build
```

Output is written to `dist/`.

### Preview Production Build

```bash
npm run preview
```

### Production Server

```bash
npm start
```

## Testing

### Unit Tests (Vitest)

```bash
npm test
```

### E2E Tests (Playwright)

```bash
npx playwright test
```

Smoke and diagnostic scripts are also available:

```bash
node e2e-smoke.mjs        # quick smoke test
node e2e-prod.mjs         # production environment test
node e2e-diagnostic.mjs   # detailed diagnostics
```

## Android (Capacitor)

```bash
npm run build
npx cap sync android
npx cap open android
```

Build APKs are stored in `downloads/`.

## Project Structure

```
src/
├── components/      Shared UI components (ErrorBoundary, CachedImage, etc.)
├── config/          API configuration
├── contexts/        React contexts (Auth, Layout, Toast)
├── features/        Feature modules (player, playlist, library, layout, theme)
├── hooks/           Custom React hooks
├── pages/           Route-level page components
├── providers/       Music provider integrations (JioSaavn, YouTube)
├── services/        Business logic (audio, downloads, cache, lyrics, etc.)
├── stores/          Zustand stores (audio, queue, downloads, history, etc.)
├── themes/          Theme definitions
├── types/           TypeScript type definitions
└── utils/           Utilities (logger, download manager, parsers, etc.)
```

## Deployment

- **Web**: Vercel (`.vercel/`) or Render (`render.yaml`)
- **Android**: Capacitor build → APK

## License

Private project.

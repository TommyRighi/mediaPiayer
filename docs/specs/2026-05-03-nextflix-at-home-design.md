# Nextflix at Home — Design Spec

**Date:** 2026-05-03
**Author:** Tommaso Righi
**Status:** Draft

## Overview

A self-hosted Netflix-like media streaming app running on a Raspberry Pi 3 B+, accessible from any browser via Tailscale VPN. Supports multiple users, sync-watching (Teleparty-style), manual metadata management, and both web upload and folder-based media loading.

## Constraints

- **Hardware:** Raspberry Pi 3 B+ (1GB RAM, ARM Cortex-A53)
- **No transcoding:** Direct streaming only. All media must be in browser-compatible formats (H.264 in MP4 container).
- **No public internet exposure:** Tailscale VPN for all remote access.
- **No automatic metadata fetching:** User manually uploads posters, descriptions, etc.
- **Lightweight OS:** Raspberry Pi OS Lite (headless) to conserve RAM.

---

## Architecture

A single Node.js process on the Pi serving a React frontend, video files via HTTP range requests, and WebSockets for synced watching — all accessible through Tailscale, no ports exposed to the internet.

```
┌──────────────────────────────────────────────────────────────┐
│                    Raspberry Pi 3 B+                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Nextflix Server (Node.js)                   │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │ │
│  │  │  Fastify  │  │ SQLite   │  │  /media/             │  │ │
│  │  │  HTTP API │  │   DB     │  │   movies/   series/  │  │ │
│  │  │  + WS     │  │          │  │   posters/           │  │ │
│  │  └──────────┘  └──────────┘  └──────────────────────┘  │ │
│  │       │                                                  │ │
│  │       ├── API routes (/api/*)                            │ │
│  │       ├── Static files (React SPA)                       │ │
│  │       ├── Video streaming (range requests)               │ │
│  │       ├── WebSocket (sync watching)                      │ │
│  │       └── Folder watcher (chokidar)                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                            │                                  │
└────────────────────────────┼──────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │    Tailscale    │
                    │   (VPN layer)   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
         ┌────┴────┐   ┌────┴────┐   ┌────┴────┐
         │ Laptop  │   │  Phone  │   │ Tablet  │
         │ Browser │   │ Browser │   │ Browser │
         └─────────┘   └─────────┘   └─────────┘
```

---

## Tech Stack

| Layer    | Tech                    | Why |
|----------|-------------------------|-----|
| Server   | **Fastify**             | Faster than Express, lower memory, built-in validation |
| Database | **SQLite** (better-sqlite3) | Zero config, zero separate process, sync reads |
| Auth     | **JWT** (fast-jwt)      | Stateless tokens, no DB hit per request |
| Passwords| **bcrypt**              | Standard password hashing |
| Frontend | **React + Vite**        | Netflix-like UI, builds to static files |
| Styling  | **Tailwind CSS**        | Utility-first, dark theme |
| Routing  | **React Router v6**     | SPA routing |
| Video    | HTTP **range requests** | Native HTML5 `<video>` support |
| File watch| **Chokidar**           | Detects new files in media folders |
| Upload   | **@fastify/multipart**  | Multipart form handling |
| Realtime | **@fastify/websocket**  | WebSocket for synced watching |
| UUID     | **nanoid**              | Short unique IDs |
| Access   | **Tailscale**           | VPN — not an app dependency |

---

## Database Schema

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE media (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('movie', 'series')),
  description   TEXT DEFAULT '',
  poster_path   TEXT,
  backdrop_path TEXT,
  year          INTEGER,
  genre         TEXT DEFAULT '',
  file_path     TEXT,
  file_size     INTEGER DEFAULT 0,
  duration      INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  uploaded_by   TEXT REFERENCES users(id)
);

CREATE TABLE episodes (
  id             TEXT PRIMARY KEY,
  series_id      TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  season_number  INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT DEFAULT '',
  file_path      TEXT NOT NULL,
  thumbnail_path TEXT,
  file_size      INTEGER DEFAULT 0,
  duration       INTEGER DEFAULT 0,
  UNIQUE(series_id, season_number, episode_number)
);

CREATE TABLE watch_progress (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id         TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  episode_id       TEXT REFERENCES episodes(id),
  progress_seconds INTEGER DEFAULT 0,
  completed        INTEGER DEFAULT 0,
  updated_at       TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, media_id, episode_id)
);

CREATE TABLE watch_parties (
  id            TEXT PRIMARY KEY,
  host_user_id  TEXT NOT NULL REFERENCES users(id),
  media_id      TEXT NOT NULL REFERENCES media(id),
  episode_id    TEXT REFERENCES episodes(id),
  position      INTEGER DEFAULT 0,
  is_playing    INTEGER DEFAULT 0,
  invite_code   TEXT UNIQUE NOT NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE party_members (
  id        TEXT PRIMARY KEY,
  party_id  TEXT NOT NULL REFERENCES watch_parties(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id),
  joined_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE media_assets (
  id         TEXT PRIMARY KEY,
  media_id   TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK(type IN ('poster', 'backdrop', 'logo')),
  file_path  TEXT NOT NULL
);
```

---

## API Routes

All routes prefixed with `/api`. Auth token passed as `Authorization: Bearer <token>`.

### Auth
```
POST   /api/auth/register     { email, password, displayName }
POST   /api/auth/login         { email, password } → { token, user }
GET    /api/auth/me            → current user
PATCH  /api/auth/profile       { displayName }
```

### Media
```
GET    /api/media              ?type=movie|series&genre=X&search=Y
GET    /api/media/:id          → detail + user's watch progress
GET    /api/media/:id/video    → streams video (range requests)
PATCH  /api/media/:id          { title, description, year, genre, poster... }
DELETE /api/media/:id          → deletes file + DB row
```

### Series Episodes
```
GET    /api/series/:id/episodes  → grouped by season
GET    /api/episodes/:id/video   → streams episode file
```

### Upload
```
POST   /api/upload             multipart: file + { title, type, year, ... }
GET    /api/upload/progress    SSE stream with upload progress
```

### Admin
```
POST   /api/admin/scan         triggers folder scan for new files in /media/
```

### Watch Progress
```
POST   /api/watch/progress     { mediaId, episodeId?, seconds, completed }
GET    /api/watch/history      → user's continue watching list
```

### Watch Parties
```
POST   /api/parties            { mediaId, episodeId? } → { id, inviteCode }
POST   /api/parties/join       { inviteCode } → { partyId }
WS     /api/parties/:id/ws     → WebSocket for sync
```

### WebSocket Protocol (Watch Party)

The WebSocket connects to `/api/parties/:id/ws?token=<jwt>`. Messages:

```json
// Client → Server
{ "type": "play",  "position": 42.5 }
{ "type": "pause", "position": 55.0 }
{ "type": "seek",  "position": 120.0 }

// Server → All clients
{
  "type": "sync",
  "action": "play",
  "position": 42.5,
  "userId": "abc123"
}
```

The server is the authority on state. Any client can send an action; the server broadcasts it to all other members immediately.

---

## Frontend

React SPA built with Vite + React Router. Dark theme, Netflix-inspired design.

### Color Palette
- Background: `#141414` (near-black)
- Surface: `#1f1f1f` (cards, inputs)
- Text: `#ffffff` / `#b3b3b3` (secondary)
- Accent: `#e50914` (play buttons, branding)

### Routes
```
/login              → Login/Register form
/                   → Browse (hero banner + rows)
/movie/:id          → Movie detail
/series/:id         → Series detail + episode picker
/watch/:mediaId     → Video player (movie)
/watch/:mediaId/:epId → Video player (episode)
/upload             → Drag-and-drop upload
/scene/:partyId     → Watch party room
/profile            → User settings
/admin              → Admin panel
```

### Page Components

**BrowsePage**
- Hero banner: random featured media with full-width backdrop + play button
- Rows: "Continue Watching", "Movies", "Series"
- Each row: horizontally scrollable, MediaCard components (poster + hover title)

**MediaDetailPage**
- Backdrop header with title, description, year, genre
- Play button (starts movie / latest unwatched episode)
- Episode picker for series (season tabs → episode grid)
- "Start Watch Party" button

**WatchPage**
- HTML5 `<video>` element (browser-native controls)
- Watch party overlay bar (if in party): "Watching with 3 others · Synced"
- In party mode: native controls hidden, playback driven by WebSocket sync

**UploadPage**
- Drop zone: drag video files here
- Form: title, type (movie/series), year, description, poster image
- Progress bar via SSE

**PartyRoom**
- Synced video player
- Member list
- Invite link (copy invite code)
- Chat (future feature placeholder)

**AdminPage**
- "Scan for new media" button (triggers folder scan)
- Media list with edit/delete actions

---

## Storage Layout (on Pi)

```
/home/pi/nextflix/
├── server/              # Node.js backend
│   ├── server.js        # entry point
│   ├── db.js            # SQLite setup + migrations
│   ├── routes/          # API route handlers
│   └── dist/            # built React frontend
├── frontend/            # React source (dev)
├── media/
│   ├── movies/          # movie.mp4 files
│   ├── series/          # ShowName/Season 01/episode.mp4
│   └── posters/         # uploaded poster/backdrop images
├── .env                 # JWT_SECRET, PORT
└── package.json
```

---

## Deployment

### OS Setup
- **OS:** Raspberry Pi OS Lite (64-bit, headless)
- **Enable:** SSH
- **Hostname:** `nextflix-pi`

### Dependencies
```bash
sudo apt update && sudo apt install -y git nodejs npm
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

### App Install
```bash
git clone <repo> /home/pi/nextflix
cd /home/pi/nextflix
npm install
npm run build
mkdir -p media/movies media/series media/posters
node server.js   # runs on port 3000
```

### Auto-start (systemd)
```ini
# /etc/systemd/system/nextflix.service
[Unit]
Description=Nextflix Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/nextflix
ExecStart=/usr/bin/node /home/pi/nextflix/server/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now nextflix.service
```

### Access
With Tailscale running, the app is reachable at `http://nextflix-pi:3000` from any device on your tailnet.

### Storage
External USB drive recommended for `/home/pi/nextflix/media/` to avoid wearing out the SD card with frequent writes from uploads.

---

## Future Features (Prompts for AI)

> These are prompts to feed an AI assistant to implement additional features after the core app is built.

### Subtitle Support
```
Add subtitle support to the video player. Allow users to upload .srt/.vtt subtitle files
when adding media or through the media detail page. The HTML5 <video> player should show
a subtitle track selector. Store subtitles in a new `subtitles` table (id, media_id, 
episode_id?, language, file_path) and serve them as static files.
```

### Watch Party Chat
```
Add a real-time chat to the watch party room. Use the existing WebSocket connection to
send/receive text messages. Show messages in a sidebar or overlay on the video player.
Store messages in a `party_messages` table (id, party_id, user_id, text, created_at).
Show the last 50 messages when joining a party. Include timestamps and user display names.
```

### Dark/Light Mode Toggle
```
Add a theme toggle to the navbar. Use Tailwind's dark mode class strategy (class-based,
not system-based). Store the preference in localStorage and apply on load. The light
theme should use white backgrounds (#ffffff), dark text (#141414), and a softer red accent
(#cc0a14).
```

### Keyboard Shortcuts in Player
```
Add keyboard shortcuts to the video player: Space (play/pause), Left/Right arrows (seek
±10s), Up/Down (volume), F (fullscreen), M (mute). Show a small tooltip overlay the first
time a shortcut is used per session. Disable shortcuts when in watch party mode (server
controls playback).
```

### User Roles: Admin vs Viewer
```
Add user roles to the app. New field `role` on users table (default: 'viewer', admin: 'admin').
Only admins can access /admin, upload media, edit/delete media, and trigger folder scans.
Viewers can browse, watch, create parties, and manage their own profile. Seed the first
registered user as admin.
```

### Media Recommendations Row
```
Add a "You Might Like" row on the browse page. Simple approach: pick media with the
same genre as the user's most-watched genre, excluding what they've already completed.
No ML — just genre overlap. If the user has no watch history, show random media.
```

### Mobile Responsive Layout
```
Make the frontend fully responsive. On screens < 768px: navbar becomes a bottom tab bar,
media rows show 2 posters per row instead of 5-6, hero banner reduces height by 50%,
video player uses native full-width layout, upload drop zone adapts to touch input.
```

### Series Auto-Detection from Folder Structure
```
Enhance the admin folder scanner to detect series automatically from directory structure.
Expected layout: /media/series/ShowName/Season XX/Episode_XX_title.mp4

The scan should:
1. Walk /media/series/
2. Treat each subfolder as a series (create media row if new)
3. Treat "Season XX" subfolders as season groups
4. Create episode rows from video files
5. Parse episode number from filename
6. Skip files that already match existing episodes
```

### Offline Warning
```
Show a banner at the top of the app when the browser loses internet connectivity
(detect via navigator.onLine + periodic fetch to /api/auth/me). The banner should
say "Connection lost — trying to reconnect..." with a yellow/amber style. Auto-dismiss
when connection returns. During offline, disable play buttons and show a tooltip
"You're offline."
```

### Parental Controls (PIN)
```
Add optional PIN protection for specific media. New field `pin_required` on media table
(default 0). When a viewer (non-admin) tries to play PIN-protected media, show a 4-digit
PIN input. The PIN is set per-user in their profile settings. Admins bypass the PIN.
Show a lock icon on protected media posters.
```

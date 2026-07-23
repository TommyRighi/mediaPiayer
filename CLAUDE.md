# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Architecture notes beyond AGENTS.md

**Backend module layout** (`server/`):
- `server.js` — Fastify app entry point. Registers plugins (cors, helmet, multipart, websocket, rate-limit) then all route modules under `server/routes/`, and serves the built frontend from `server/dist/` with an SPA fallback (`setNotFoundHandler` returns `index.html` for extensionless paths).
- `db.js` — `better-sqlite3` singleton via `getDb()`, schema creation/migrations run on first import.
- `auth.js` — JWT helpers. Two token kinds: normal bearer tokens (`createToken`, 7d expiry) for API calls, and short-lived media tokens (`createMediaToken`, 1h, `purpose: 'media'`) used for direct `<video>`/`<img>` URLs where an `Authorization` header can't be attached — these are passed as `?token=` query params and only accepted by `mediaAuth`, never by `authMiddleware`. `token_version` on the user row is bumped to invalidate all outstanding tokens (e.g. password change).
- `utils.js` — shared helpers including `MEDIA_DIRS` resolution (from `MEDIA_DIRS` env var or defaults to `./media`).
- `transcode.js` / `scripts/transcode.js` — ffmpeg-based transcoding and HLS generation; `resumePendingJobs()` is called at server startup to pick up interrupted jobs.
- `transmission.js` — Transmission RPC client for magnet/torrent downloads; `startPolling()` runs at startup to track download progress.
- `track-extractor.js` — ffprobe-based subtitle/audio track extraction.
- `imageProcessor.js` — `sharp`-based poster/backdrop resizing (produces `-sm`/`-md` variants alongside originals, see `media/posters/`).

**Route → concern mapping** (`server/routes/`): `auth.js` (register/login/invite codes), `media.js` (movies: browse, stream, poster/backdrop, HLS), `series.js` (TV shows/episodes), `upload.js` (multipart media upload), `watch.js` (watch progress), `parties.js` (watch parties, WebSocket sync at `/api/parties/:id/ws`), `admin.js` (user/library management), `transcode.js` (job status), `downloads.js` (torrent/magnet downloads via Transmission), `requests.js` (user media requests), `music/` (albums/tracks/playlists/favorites/YouTube downloads).

**Auth middleware variants** (`server/auth.js`), used per-route as needed:
- `authMiddleware` — requires a valid bearer token, rejects media-purpose tokens.
- `optionalAuth` — attaches `request.user` if a valid token is present, doesn't reject otherwise.
- `mediaAuth` — accepts either a bearer header or `?token=` query param; used on streaming/image endpoints.
- `adminMiddleware` — must run after `authMiddleware`; requires `request.user.role === 'admin'`.

**Frontend structure** (`frontend/src/`): `pages/` are route-level views (React Router), `components/` are shared UI (`VideoPlayer.jsx`/`AudioPlayer.jsx` wrap `hls.js`+`plyr`), `context/` holds `AuthContext` (JWT/localStorage) and `PlayerContext` (playback state). `api.js` is the single fetch client — it reads the token from `AuthContext`/localStorage and attaches `Authorization` headers automatically; use it rather than calling `fetch` directly.

**Security posture**: CSP is configured in `server.js` under `@fastify/helmet`; global rate limiting excludes streaming/asset endpoints (media/poster/backdrop/HLS/subtitles) since those are high-frequency by nature. Before making the repo public or cutting a release, see `docs/safe-release-checklist.md`.

**Docs worth knowing about**: `docs/features.md` (feature list), `docs/specs/` (design docs for larger features like torrent downloads and the "Nextflix at home" redesign).

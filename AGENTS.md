# AGENTS.md

## Quick start

```bash
npm install           # root (backend deps)
cd frontend && npm install  # frontend deps

# Dev mode:
npm run dev:all       # root — backend :3000 + frontend :5173

# Or run them separately:
npm run dev           # root — backend on :3000 with --watch
npm run dev           # frontend/ — Vite on :5173, proxies /api → :3000
```

## Architecture

- **Backend:** Fastify (CommonJS, `require`/`module.exports`) in `server/`
- **Frontend:** React 19 + Vite 8 (ESM, `import`/`export`) in `frontend/`
- **Database:** SQLite via `better-sqlite3`, auto-created at `data/mediapiayer.db` on first run
- **Static production app:** backend serves `server/dist/`, produced by the frontend build
- **Media handling:** direct file streaming plus HLS/transcoding helpers in `server/transcode.js` and `scripts/transcode.js`
- **No TypeScript** — entire project is plain JavaScript
- **No test framework** — no `npm test`, no test runners configured

## Commands

| Where | Command | Does |
|-------|---------|------|
| Root | `npm run dev` | Backend with `--watch` (auto-restart on changes) |
| Root | `npm run dev:all` | Runs backend and frontend dev servers together |
| Root | `npm start` | Backend production |
| Root | `npm run build` | Builds frontend to `server/dist/` |
| Root | `npm run deploy` | Installs deps, builds frontend, then starts backend |
| Root | `npm run transcode:start` | Starts queued/needed transcoding work |
| Root | `npm run transcode:status` | Shows transcode status |
| Root | `npm run transcode:retry` | Retries failed transcodes |
| Root | `npm run transcode:list` | Lists transcode jobs/items |
| Frontend | `npm run dev` | Vite dev server with HMR |
| Frontend | `npm run build` | Vite production build → `../server/dist/` |
| Frontend | `npm run lint` | ESLint (flat config) |
| Frontend | `npm run preview` | Vite preview server for built frontend |

## Gotchas

- **Two `npm install` steps required** — root and `frontend/` are separate projects, not a workspace monorepo
- **Module systems differ** — server uses `require()`, frontend uses `import`. Don't mix them
- **Tailwind v4 via Vite plugin** (`frontend/vite.config.js`) — no PostCSS config file exists
- **ESLint flat config** — `eslint.config.js`, not `.eslintrc.*`
- **Build output goes to `server/dist/`** — the backend serves this directory statically in production. Always build before running in production
- **Dev needs both servers** — `npm run dev:all` starts both; if running manually, Vite on port 5173 proxies `/api` to backend port 3000
- **Media files** — `media/{movies,posters,series,music}` directories are committed empty but their contents are gitignored. The admin/music scanners walk these directories
- **Auth** — JWT tokens stored in `localStorage`; API client in `frontend/src/api.js` auto-attaches `Authorization` headers
- **Video streaming** — server handles HTTP range requests for seeking and can serve HLS outputs under `/api/media/:id/hls/*` and `/api/episodes/:id/hls/*`
- **Transcoding** — root transcode scripts delegate to `scripts/transcode.js`; backend routes expose transcode status under `/api/transcode/status/:mediaId`
- **Music** — music routes live in `server/routes/music.js`, including albums, tracks, playlists, favorites, progress, uploads, scans, and YouTube download helpers
- **Watch parties** — use WebSocket upgrade on `/api/parties/:id/ws` for real-time sync

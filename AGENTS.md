# AGENTS.md

## Quick start

```bash
npm install           # root (backend deps)
cd frontend && npm install  # frontend deps

# Dev mode (run both):
npm run dev           # root — backend on :3000 with --watch
npm run dev           # frontend/ — Vite on :5173, proxies /api → :3000
```

## Architecture

- **Backend:** Fastify (CommonJS, `require`/`module.exports`) in `server/`
- **Frontend:** React 19 + Vite 8 (ESM, `import`/`export`) in `frontend/`
- **Database:** SQLite via `better-sqlite3`, auto-created at `data/nextflix.db` on first run
- **No TypeScript** — entire project is plain JavaScript
- **No test framework** — no `npm test`, no test runners configured

## Commands

| Where | Command | Does |
|-------|---------|------|
| Root | `npm run dev` | Backend with `--watch` (auto-restart on changes) |
| Root | `npm start` | Backend production |
| Root | `npm run build` | Builds frontend to `server/dist/` |
| Frontend | `npm run dev` | Vite dev server with HMR |
| Frontend | `npm run build` | Vite production build → `../server/dist/` |
| Frontend | `npm run lint` | ESLint (flat config) |

## Gotchas

- **Two `npm install` steps required** — root and `frontend/` are separate projects, not a workspace monorepo
- **Module systems differ** — server uses `require()`, frontend uses `import`. Don't mix them
- **Tailwind v4 via Vite plugin** (`frontend/vite.config.js`) — no PostCSS config file exists
- **ESLint flat config** — `eslint.config.js`, not `.eslintrc.*`
- **Build output goes to `server/dist/`** — the backend serves this directory statically in production. Always build before running in production
- **Dev needs both servers** — frontend Vite dev server (port 5173) proxies `/api` to backend (port 3000)
- **Media files** — `media/{movies,posters,series}` directories are committed empty but their contents are gitignored. The admin scanner walks these directories
- **Auth** — JWT tokens stored in `localStorage`; API client in `frontend/src/api.js` auto-attaches `Authorization` headers
- **Video streaming** — server handles HTTP range requests for seeking; no transcoding
- **Watch parties** — use WebSocket upgrade on `/api/parties/:id/ws` for real-time sync

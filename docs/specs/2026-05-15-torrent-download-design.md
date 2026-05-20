# Torrent Download via Transmission — Design Spec

**Date**: 2026-05-15  
**Status**: Approved  

## Overview

Add the ability for admins to paste a magnet link on a media detail page, which downloads the video file via Transmission-daemon, auto-imports it into the media library, and starts transcoding if needed.

## Architecture

```
Admin (browser) → POST /api/media/:id/download { magnetUri }
  → Node app → Transmission RPC (localhost only)
  → Polling (5s) tracks progress
  → On completion: auto-import file → update DB → enqueue transcode
```

## Prerequisites

Install on the Pi:
```bash
sudo apt install transmission-daemon
```

Configure `/etc/transmission-daemon/settings.json`:
- `"rpc-bind-address": "127.0.0.1"` — localhost only, no network exposure
- `"rpc-username"` / `"rpc-password"` — set strong credentials
- `"download-dir"` — point to a staging directory inside the media dir (e.g. `media/.downloads/`)
- `"rpc-whitelist-enabled": false` — not needed since bound to localhost
- `"seed-queue-enabled": true, "seed-queue-size": 0` — stop seeding immediately after download

Add to `.env`:
```
TRANSMISSION_URL=http://user:pass@127.0.0.1:9091/transmission/rpc
```

## Security Measures

1. **Transmission bound to 127.0.0.1** — no network exposure, only Node can reach it
2. **Admin-only endpoints** — all download APIs require `authMiddleware + adminMiddleware`
3. **Magnet URI strict validation** — regex: `^magnet:\?xt=urn:btih:[a-fA-F0-9]{40}(&[a-zA-Z0-9._%+-]+=[^&]+)*$`. Reject anything else. No other URI schemes.
4. **File extension allowlist** — only pick files matching `ALLOWED_EXTENSIONS` (.mp4, .mkv, .webm, .mov, .avi) during import
5. **Filename sanitization** — strip path components, reject names with `..` or `/` or `\`. Use `path.basename()` and validate.
6. **Staging directory** — downloads go to `media/.downloads/`, never directly into `media/movies/` or `media/series/`. Files are moved only after validation.
7. **Graceful degradation** — if Transmission is unreachable, API returns 503. No crash, no hanging. UI shows "Torrent download unavailable".
8. **Rate limiting** — the existing `@fastify/rate-limit` applies to all routes, including download endpoints. Admin endpoints are not allowlisted.
9. **No seeding** — set `"seed-queue-size": 0`, remove torrent immediately after import to minimize IP exposure in the swarm.
10. **Audit trail** — `downloads` table records who (`uploaded_by` matches existing pattern), when, and which magnet URI was used.

## Database Changes

### New table: `downloads`

```sql
CREATE TABLE IF NOT EXISTS downloads (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  torrent_hash TEXT NOT NULL,
  magnet_uri TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'downloading',
  progress REAL NOT NULL DEFAULT 0.0,
  download_dir TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_by TEXT REFERENCES users(id)
);
```

### New column on `media`

```sql
ALTER TABLE media ADD COLUMN download_status TEXT;
```

Values: `NULL` (no download), `'downloading'`, `'importing'`, `'completed'`, `'failed'`.

## Backend: `server/transmission.js`

```js
// Exports:
// - init()                                      — start polling loop
// - addMagnet(magnetUri, mediaId, userId)       — add torrent, track in DB
// - getStatus(mediaId)                           — get download status for a media item
// - cancelDownload(mediaId)                      — remove torrent + delete from staging
// - listDownloads()                              — list all active/recent downloads
// - isAvailable()                                — check if Transmission is reachable
```

### Polling loop

Every 5 seconds:
1. Query all `downloads` rows with `status = 'downloading'`
2. Call Transmission `torrent-get` RPC with their `torrent_hash` values
3. Update `progress` in DB
4. When `percentDone = 1.0`:
   - Set `status = 'importing'`, `media.download_status = 'importing'`
   - Scan the download dir for the largest video file matching `ALLOWED_EXTENSIONS`
   - Validate and sanitize filename
   - Move to final location (`media/movies/<mediaId>.<ext>` or series dir)
   - Update `media.file_path`
   - Remove torrent from Transmission (with `delete-local-data=false`, we moved the file)
   - If `needsTranscoding()`: set `transcode_status = 'pending'`, `enqueue()`
   - Run `extractAndStoreAll()` for audio tracks
   - Set `status = 'completed'`, `media.download_status = 'completed'`
5. On error: set `status = 'failed'`, `error = message`, `media.download_status = 'failed'`

### Magnet URI validation

```js
const MAGNET_REGEX = /^magnet:\?xt=urn:btih:[a-fA-F0-9]{40}(&[a-zA-Z0-9._%+-]+=[^&]+)*$/;
```

Only hex info hashes (v1) are accepted. Base32 hashes and `urn:btmh` (v2) are rejected for simplicity.

## API Routes: `server/routes/downloads.js`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/media/:id/download` | admin | Start download (`{ magnetUri }`) |
| GET | `/api/media/:id/download` | any auth | Get download status |
| DELETE | `/api/media/:id/download` | admin | Cancel & remove download |
| GET | `/api/downloads` | admin | List all downloads |

### POST `/api/media/:id/download`

Request body:
```json
{ "magnetUri": "magnet:?xt=urn:btih:..." }
```

Responses:
- `200` — download started, returns download record
- `400` — invalid magnet URI format
- `404` — media not found
- `409` — download already in progress for this media
- `503` — Transmission daemon unavailable

### GET `/api/media/:id/download`

Response:
```json
{
  "available": true,          // is Transmission reachable?
  "download": {               // null if no download started
    "status": "downloading",
    "progress": 0.45,
    "error": null
  }
}
```

### DELETE `/api/media/:id/download`

Removes the torrent from Transmission, deletes staging files, removes the `downloads` row, resets `media.download_status`.

## Frontend: MediaDetailPage.jsx

In edit mode, add a "Download via Magnet" section below the image upload buttons:

```
┌──────────────────────────────────────────────────┐
│ 🧲 Download via Magnet                            │
│ ┌──────────────────────────────────────┐ [Start]  │
│ │ magnet:?xt=urn:btih:a1b2c3...        │          │
│ └──────────────────────────────────────┘          │
│                                                    │
│ ⏳ Downloading 45% ████████░░░░                   │
│                                                    │
│ [Cancel]                                          │
└──────────────────────────────────────────────────┘
```

### Behavior

- **Input field**: Paste magnet URI, click "Start Download"
- **Progress bar**: Poll `/api/media/:id/download` every 3s while `status === 'downloading'`
- **Completion**: Auto-refresh the media detail, show Play button
- **Cancel button**: Calls `DELETE /api/media/:id/download`, removes torrent
- **Unavailable state**: If `available === false`, show "Torrent download is not available on this server."
- **Existing file warning**: If media already has `file_path`, show warning: "This will replace the existing video file."
- **Error state**: Show error message from `download.error`

## Auto-Import Flow

```
Admin clicks "Start Download" with magnet URI
  → Validate magnet URI format
  → Check no active download exists for this media
  → Call Transmission RPC: torrent-add
  → Insert downloads row (status: 'downloading')
  → Set media.download_status = 'downloading'

Polling detects percentDone = 1.0:
  → Set status = 'importing', media.download_status = 'importing'
  → Scan download dir for video files
  → Pick largest file with ALLOWED_EXTENSIONS
  → Validate filename (path.basename, no .. or /)
  → Move to media/movies/<mediaId>.<ext>
  → Update media.file_path, media.file_size
  → Remove torrent from Transmission
  → If needsTranscoding(): enqueue transcode
  → Run extractAndStoreAll()
  → Set status = 'completed', media.download_status = 'completed'

Error during import:
  → Set status = 'failed', error = message, media.download_status = 'failed'
  → UI shows error, admin can retry or cancel
```

## Graceful Degradation

- **Transmission not running**: `isAvailable()` returns false. POST returns 503. GET returns `{ available: false }`. UI shows "Torrent download is not available."
- **Transmission crashes mid-download**: Next poll detects RPC failure. Downloads stay in `downloading` status. When Transmission comes back, polling resumes. If media is deleted while downloading, orphan rows are cleaned on next scan.
- **Disk full during download**: Transmission handles this natively. Our import step checks disk space before moving files via `pickBestMediaDir()`.
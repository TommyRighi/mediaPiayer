const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'mediapiayer.db');

let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate();
  }
  return db;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      avatar_url    TEXT,
      role           TEXT NOT NULL DEFAULT 'viewer',
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS media (
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

    CREATE TABLE IF NOT EXISTS episodes (
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

    CREATE TABLE IF NOT EXISTS watch_progress (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_id         TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      episode_id       TEXT REFERENCES episodes(id),
      progress_seconds INTEGER DEFAULT 0,
      completed        INTEGER DEFAULT 0,
      updated_at       TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, media_id, episode_id)
    );

    CREATE TABLE IF NOT EXISTS watch_parties (
      id            TEXT PRIMARY KEY,
      host_user_id  TEXT NOT NULL REFERENCES users(id),
      media_id      TEXT NOT NULL REFERENCES media(id),
      episode_id    TEXT REFERENCES episodes(id),
      position      INTEGER DEFAULT 0,
      is_playing    INTEGER DEFAULT 0,
      invite_code   TEXT UNIQUE NOT NULL,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS party_members (
      id        TEXT PRIMARY KEY,
      party_id  TEXT NOT NULL REFERENCES watch_parties(id) ON DELETE CASCADE,
      user_id   TEXT NOT NULL REFERENCES users(id),
      joined_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id         TEXT PRIMARY KEY,
      media_id   TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      type       TEXT NOT NULL CHECK(type IN ('poster', 'backdrop', 'logo')),
      file_path  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subtitles (
      id         TEXT PRIMARY KEY,
      media_id   TEXT REFERENCES media(id) ON DELETE CASCADE,
      episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE,
      label      TEXT NOT NULL,
      language   TEXT NOT NULL,
      file_path  TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audio_tracks (
      id              TEXT PRIMARY KEY,
      media_id        TEXT REFERENCES media(id) ON DELETE CASCADE,
      episode_id      TEXT REFERENCES episodes(id) ON DELETE CASCADE,
      track_index     INTEGER NOT NULL,
      codec           TEXT NOT NULL DEFAULT 'unknown',
      language        TEXT NOT NULL DEFAULT 'und',
      label           TEXT NOT NULL,
      channels        INTEGER DEFAULT 0,
      channel_layout  TEXT DEFAULT '',
      bit_rate        INTEGER DEFAULT 0,
      sample_rate     INTEGER DEFAULT 0,
      title           TEXT,
      default_flag    INTEGER DEFAULT 0
    );
  `);

  const roleCol = db.prepare("PRAGMA table_info(users)").all().find(c => c.name === 'role');
  if (!roleCol) {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'`);
    db.exec(`UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)`);
  }

  const activeCol = db.prepare("PRAGMA table_info(users)").all().find(c => c.name === 'last_active_at');
  if (!activeCol) {
    db.exec(`ALTER TABLE users ADD COLUMN last_active_at TEXT`);
  }

  const tokenVersionCol = db.prepare("PRAGMA table_info(users)").all().find(c => c.name === 'token_version');
  if (!tokenVersionCol) {
    db.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`);
  }

  const transcodeCol = db.prepare("PRAGMA table_info(media)").all().find(c => c.name === 'transcode_status');
  if (!transcodeCol) {
    db.exec(`ALTER TABLE media ADD COLUMN transcode_status TEXT`);
  }

  const epTranscodeCol = db.prepare("PRAGMA table_info(episodes)").all().find(c => c.name === 'transcode_status');
  if (!epTranscodeCol) {
    db.exec(`ALTER TABLE episodes ADD COLUMN transcode_status TEXT`);
  }

  const audioTracksTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='audio_tracks'"
  ).get();
  if (!audioTracksTable) {
    db.exec(`
      CREATE TABLE audio_tracks (
        id              TEXT PRIMARY KEY,
        media_id        TEXT REFERENCES media(id) ON DELETE CASCADE,
        episode_id      TEXT REFERENCES episodes(id) ON DELETE CASCADE,
        track_index     INTEGER NOT NULL,
        codec           TEXT NOT NULL DEFAULT 'unknown',
        language        TEXT NOT NULL DEFAULT 'und',
        label           TEXT NOT NULL,
        channels        INTEGER DEFAULT 0,
        channel_layout  TEXT DEFAULT '',
        bit_rate        INTEGER DEFAULT 0,
        sample_rate     INTEGER DEFAULT 0,
        title           TEXT,
        default_flag    INTEGER DEFAULT 0
      )
    `);
  }

  const downloadsTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='downloads'"
  ).get();
  if (!downloadsTable) {
    db.exec(`
      CREATE TABLE downloads (
        id            TEXT PRIMARY KEY,
        media_id      TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        torrent_hash  TEXT NOT NULL,
        magnet_uri    TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'downloading',
        progress      REAL NOT NULL DEFAULT 0.0,
        download_dir  TEXT,
        error         TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        started_by    TEXT REFERENCES users(id)
      )
    `);
  }

  const downloadStatusCol = db.prepare("PRAGMA table_info(media)").all().find(c => c.name === 'download_status');
  if (!downloadStatusCol) {
    db.exec(`ALTER TABLE media ADD COLUMN download_status TEXT`);
  }

  const watchRequestsTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='watch_requests'"
  ).get();
  if (!watchRequestsTable) {
    db.exec(`
      CREATE TABLE watch_requests (
        id            TEXT PRIMARY KEY,
        created_by    TEXT NOT NULL REFERENCES users(id),
        media_id      TEXT NOT NULL REFERENCES media(id),
        episode_id    TEXT REFERENCES episodes(id),
        scheduled_at  TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        party_id      TEXT REFERENCES watch_parties(id),
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  const requestResponsesTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='request_responses'"
  ).get();
  if (!requestResponsesTable) {
    db.exec(`
      CREATE TABLE request_responses (
        id         TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES watch_requests(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id),
        response   TEXT NOT NULL CHECK(response IN ('approved', 'dismissed')),
        UNIQUE(request_id, user_id)
      )
    `);
  }

  const musicAlbumsTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='music_albums'"
  ).get();
  if (!musicAlbumsTable) {
    db.exec(`
      CREATE TABLE music_albums (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        artist      TEXT DEFAULT '',
        description TEXT DEFAULT '',
        genre       TEXT DEFAULT '',
        year        INTEGER,
        cover_path  TEXT,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE music_tracks (
        id           TEXT PRIMARY KEY,
        album_id     TEXT REFERENCES music_albums(id) ON DELETE CASCADE,
        track_number INTEGER DEFAULT 0,
        title        TEXT NOT NULL,
        artist       TEXT DEFAULT '',
        duration     REAL DEFAULT 0,
        file_path     TEXT NOT NULL,
        file_size    INTEGER DEFAULT 0,
        created_at   TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE playlists (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description  TEXT DEFAULT '',
        cover_path  TEXT,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE playlist_tracks (
        id          TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id    TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL DEFAULT 0,
        added_at    TEXT DEFAULT (datetime('now')),
        UNIQUE(playlist_id, track_id)
      );

      CREATE TABLE favorite_tracks (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id   TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, track_id)
      );

      CREATE TABLE track_progress (
        id               TEXT PRIMARY KEY,
        user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id         TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
        progress_seconds REAL NOT NULL DEFAULT 0,
        duration         REAL DEFAULT 0,
        completed        INTEGER DEFAULT 0,
        updated_at       TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, track_id)
      );

      CREATE TABLE youtube_downloads (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id),
        url         TEXT NOT NULL,
        title       TEXT DEFAULT '',
        artist      TEXT DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'pending',
        progress    REAL DEFAULT 0,
        file_path    TEXT,
        track_id    TEXT REFERENCES music_tracks(id),
        error       TEXT,
        created_at  TEXT DEFAULT (datetime('now'))
      );
    `);
  }
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };

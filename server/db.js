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
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };

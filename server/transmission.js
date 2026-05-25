const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const { needsTranscoding, enqueue } = require('./transcode');
const { extractAndStoreAll } = require('./track-extractor');
const { MEDIA_DIR, MEDIA_DIRS, pickBestMediaDir, isWithinAnyDir } = require('./utils');
const { generateAllVariants } = require('./imageProcessor');

const ALLOWED_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];
const MAGNET_REGEX = /^magnet:\?xt=urn:btih:[a-fA-F0-9]{40}(&[a-zA-Z0-9._%+-]+=[^&]+)*$/;
const POLL_INTERVAL_MS = 5000;

let transmissionUrl = null;
let csrfToken = null;
let pollingTimer = null;

function getTransmissionConfig() {
  if (!process.env.TRANSMISSION_URL) return null;
  return process.env.TRANSMISSION_URL;
}

async function rpcRequest(method, arguments_) {
  const url = getTransmissionConfig();
  if (!url) throw new Error('TRANSMISSION_URL not configured');

  const headers = { 'Content-Type': 'application/json' };
  if (csrfToken) headers['X-Transmission-Session-Id'] = csrfToken;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, arguments: arguments_ || {} }),
    });
  } catch (err) {
    csrfToken = null;
    throw new Error('Cannot connect to Transmission daemon');
  }

  if (response.status === 409) {
    csrfToken = response.headers.get('X-Transmission-Session-Id');
    headers['X-Transmission-Session-Id'] = csrfToken;
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, arguments: arguments_ || {} }),
    });
  }

  if (!response.ok) {
    throw new Error(`Transmission RPC error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.result !== 'success') {
    throw new Error(`Transmission error: ${data.result}`);
  }
  return data.arguments || {};
}

function isAvailable() {
  return !!getTransmissionConfig();
}

async function checkAvailable() {
  if (!isAvailable()) return false;
  try {
    await rpcRequest('session-get');
    return true;
  } catch {
    return false;
  }
}

function validateMagnetUri(uri) {
  if (!uri || typeof uri !== 'string') return false;
  return MAGNET_REGEX.test(uri.trim());
}

async function addMagnet(magnetUri, mediaId, userId) {
  const uri = magnetUri.trim();
  if (!validateMagnetUri(uri)) {
    throw new Error('Invalid magnet URI format. Only magnet:?xt=urn:btih:<40-char-hex-hash> is supported.');
  }

  const db = getDb();
  const media = db.prepare('SELECT id, type, title, file_path FROM media WHERE id = ?').get(mediaId);
  if (!media) throw new Error('Media not found');

  const existing = db.prepare("SELECT id FROM downloads WHERE media_id = ? AND status IN ('downloading', 'importing')").get(mediaId);
  if (existing) throw new Error('A download is already in progress for this media');

  const available = await checkAvailable();
  if (!available) throw new Error('Transmission daemon is not available');

  const result = await rpcRequest('torrent-add', { filename: uri });

  const torrent = result['torrent-added'] || result['torrent-duplicate'];
  if (!torrent || !torrent.hashString) {
    throw new Error('Failed to add torrent to Transmission');
  }

  const downloadDir = torrent.downloadDir || '';
  const { nanoid } = await import('nanoid');
  const id = nanoid();

  db.prepare(
    'INSERT INTO downloads (id, media_id, torrent_hash, magnet_uri, status, progress, download_dir, started_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, mediaId, torrent.hashString, uri, 'downloading', 0, downloadDir, userId);

  db.prepare('UPDATE media SET download_status = ? WHERE id = ?').run('downloading', mediaId);

  return { id, torrentHash: torrent.hashString, status: 'downloading' };
}

async function getDownloadStatus(mediaId) {
  const db = getDb();
  const download = db.prepare('SELECT * FROM downloads WHERE media_id = ? ORDER BY created_at DESC LIMIT 1').get(mediaId);
  return download || null;
}

async function cancelDownload(mediaId) {
  const db = getDb();
  const download = db.prepare("SELECT * FROM downloads WHERE media_id = ? AND status IN ('downloading', 'importing')").get(mediaId);
  if (!download) throw new Error('No active download for this media');

  try {
    await rpcRequest('torrent-remove', { ids: [download.torrent_hash], 'delete-local-data': true });
  } catch {}

  db.prepare('DELETE FROM downloads WHERE id = ?').run(download.id);
  db.prepare('UPDATE media SET download_status = NULL WHERE id = ?').run(mediaId);

  return { success: true };
}

async function listDownloads() {
  const db = getDb();
  return db.prepare(
    "SELECT d.*, m.title, m.type FROM downloads d JOIN media m ON d.media_id = m.id ORDER BY d.created_at DESC"
  ).all();
}

function findLargestVideoFile(dir) {
  if (!fs.existsSync(dir)) return null;

  let largestFile = null;
  let largestSize = 0;

  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ALLOWED_EXTENSIONS.includes(ext)) {
          const stat = fs.statSync(fullPath);
          if (stat.size > largestSize) {
            largestSize = stat.size;
            largestFile = fullPath;
          }
        }
      }
    }
  }

  walk(dir);
  return largestFile;
}

function sanitizeFilename(filename) {
  const base = path.basename(filename);
  if (base.includes('..') || base.includes('/') || base.includes('\\')) return null;
  return base;
}

async function importCompletedTorrent(download) {
  const db = getDb();
  const media = db.prepare('SELECT id, type, title, file_path FROM media WHERE id = ?').get(download.media_id);
  if (!media) {
    db.prepare('UPDATE downloads SET status = ?, error = ? WHERE id = ?').run('failed', 'Media record not found', download.id);
    db.prepare('UPDATE media SET download_status = ? WHERE id = ?').run('failed', download.media_id);
    return;
  }

  let torrentInfo;
  try {
    torrentInfo = await rpcRequest('torrent-get', {
      ids: [download.torrent_hash],
      fields: ['hashString', 'name', 'downloadDir', 'percentDone'],
    });
  } catch (err) {
    db.prepare('UPDATE downloads SET status = ?, error = ? WHERE id = ?').run('failed', 'Cannot connect to Transmission daemon', download.id);
    db.prepare('UPDATE media SET download_status = ? WHERE id = ?').run('failed', download.media_id);
    return;
  }

  const torrents = torrentInfo.torrents || [];
  if (torrents.length === 0) {
    db.prepare('UPDATE downloads SET status = ?, error = ? WHERE id = ?').run('failed', 'Torrent not found in Transmission', download.id);
    db.prepare('UPDATE media SET download_status = ? WHERE id = ?').run('failed', download.media_id);
    return;
  }

  const torrent = torrents[0];
  const downloadDir = torrent.downloadDir || download.download_dir || '';

  const videoFile = findLargestVideoFile(downloadDir);
  if (!videoFile) {
    db.prepare('UPDATE downloads SET status = ?, error = ? WHERE id = ?').run('failed', 'No video file found in download', download.id);
    db.prepare('UPDATE media SET download_status = ? WHERE id = ?').run('failed', download.media_id);
    try {
      await rpcRequest('torrent-remove', { ids: [download.torrent_hash], 'delete-local-data': true });
    } catch {}
    return;
  }

  const safeName = sanitizeFilename(path.basename(videoFile));
  if (!safeName) {
    db.prepare('UPDATE downloads SET status = ?, error = ? WHERE id = ?').run('failed', 'Invalid filename in download', download.id);
    db.prepare('UPDATE media SET download_status = ? WHERE id = ?').run('failed', download.media_id);
    return;
  }

  const ext = path.extname(safeName).toLowerCase();
  let destDir;
  if (media.type === 'movie') {
    destDir = path.join(MEDIA_DIR, 'movies');
  } else {
    const safeTitle = media.title.trim().replace(/[^a-zA-Z0-9]/g, '_');
    destDir = path.join(MEDIA_DIR, 'series', safeTitle);
  }

  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, `${media.id}${ext}`);

  try {
    fs.renameSync(videoFile, destPath);
  } catch (err) {
    if (err.code === 'EXDEV') {
      fs.copyFileSync(videoFile, destPath);
      fs.unlinkSync(videoFile);
    } else {
      throw err;
    }
  }

  const previousPath = media.file_path;
  const stat = fs.statSync(destPath);

  db.prepare('UPDATE media SET file_path = ?, file_size = ?, download_status = ? WHERE id = ?').run(
    destPath, stat.size, 'completed', media.id
  );

  if (previousPath && previousPath !== destPath && isWithinAnyDir(previousPath, MEDIA_DIRS) && fs.existsSync(previousPath)) {
    try { fs.unlinkSync(previousPath); } catch {}
    if (previousPath.endsWith('.m3u8')) {
      try { fs.rmSync(path.dirname(previousPath), { recursive: true, force: true }); } catch {}
    }
  }

  try {
    await rpcRequest('torrent-remove', { ids: [download.torrent_hash], 'delete-local-data': false });
  } catch {}

  db.prepare('UPDATE downloads SET status = ?, progress = ? WHERE id = ?').run('completed', 1, download.id);

  extractAndStoreAll(destPath, media.id, null).catch(() => {});

  if (needsTranscoding(destPath)) {
    db.prepare('UPDATE media SET transcode_status = ? WHERE id = ?').run('pending', media.id);
    enqueue('movie', media.id);
  }
}

async function pollDownloads() {
  const db = getDb();
  const active = db.prepare("SELECT * FROM downloads WHERE status = 'downloading'").all();

  if (active.length === 0) return;

  let available = false;
  try {
    await rpcRequest('session-get');
    available = true;
  } catch {
    for (const dl of active) {
      if (dl.status === 'downloading') {
        // leave as downloading, will retry next poll
      }
    }
    return;
  }

  const hashes = active.map(dl => dl.torrent_hash);
  let torrentInfo;
  try {
    torrentInfo = await rpcRequest('torrent-get', {
      ids: hashes,
      fields: ['hashString', 'percentDone', 'status', 'downloadDir', 'errorString'],
    });
  } catch {
    return;
  }

  const torrentMap = new Map();
  for (const t of (torrentInfo.torrents || [])) {
    torrentMap.set(t.hashString, t);
  }

  for (const dl of active) {
    const torrent = torrentMap.get(dl.torrent_hash);

    if (!torrent) {
      continue;
    }

    if (torrent.errorString && torrent.errorString !== '') {
      db.prepare('UPDATE downloads SET status = ?, error = ? WHERE id = ?').run('failed', torrent.errorString, dl.id);
      db.prepare('UPDATE media SET download_status = ? WHERE id = ?').run('failed', dl.media_id);
      continue;
    }

    const progress = Math.min(torrent.percentDone || 0, 1);
    db.prepare('UPDATE downloads SET progress = ? WHERE id = ?').run(progress, dl.id);

    if (torrent.status === 6 || progress >= 1.0) {
      db.prepare('UPDATE downloads SET status = ?, progress = ? WHERE id = ?').run('importing', 1, dl.id);
      db.prepare('UPDATE media SET download_status = ? WHERE id = ?').run('importing', dl.media_id);
      importCompletedTorrent(dl).catch((err) => {
        console.error('Import failed for', dl.media_id, err.message);
        db.prepare('UPDATE downloads SET status = ?, error = ? WHERE id = ?').run('failed', 'Import failed', dl.id);
        db.prepare('UPDATE media SET download_status = ? WHERE id = ?').run('failed', dl.media_id);
      });
    }
  }
}

function startPolling() {
  if (pollingTimer) return;
  if (!isAvailable()) return;

  pollingTimer = setInterval(() => {
    pollDownloads().catch(() => {});
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

module.exports = {
  isAvailable,
  checkAvailable,
  validateMagnetUri,
  addMagnet,
  getDownloadStatus,
  cancelDownload,
  listDownloads,
  startPolling,
  stopPolling,
  importCompletedTorrent,
};
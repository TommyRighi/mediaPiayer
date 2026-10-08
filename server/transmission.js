const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const { needsTranscoding, enqueue } = require('./transcode');
const { extractAndStoreAll } = require('./track-extractor');
const { MEDIA_DIR, MEDIA_DIRS, isWithinDir, isWithinAnyDir } = require('./utils');

const ALLOWED_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];
const MAGNET_REGEX = /^magnet:\?xt=urn:btih:[a-fA-F0-9]{40}(&[a-zA-Z0-9._%+-]+=[^&]+)*$/;
const POLL_INTERVAL_MS = 5000;

let csrfToken = null;
let pollingTimer = null;

function getTransmissionConfig() {
  if (!process.env.TRANSMISSION_URL) return null;
  return process.env.TRANSMISSION_URL;
}

async function rpcRequest(method, arguments_) {
  const configuredUrl = getTransmissionConfig();
  if (!configuredUrl) throw new Error('TRANSMISSION_URL not configured');
  const url = new URL(configuredUrl);

  const headers = { 'Content-Type': 'application/json' };
  if (url.username || url.password) {
    headers.Authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  if (csrfToken) headers['X-Transmission-Session-Id'] = csrfToken;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, arguments: arguments_ || {} }),
      signal: AbortSignal.timeout(10000),
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
      signal: AbortSignal.timeout(10000),
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

const startingMedia = new Set();
async function addMagnet(magnetUri, mediaId, userId) {
  if (startingMedia.has(mediaId)) throw new Error('A download is already in progress for this media');
  startingMedia.add(mediaId);
  try { return await startMagnet(magnetUri, mediaId, userId); }
  finally { startingMedia.delete(mediaId); }
}

async function startMagnet(magnetUri, mediaId, userId) {
  const uri = magnetUri.trim();
  if (!validateMagnetUri(uri)) {
    throw new Error('Invalid magnet URI format. Only magnet:?xt=urn:btih:<40-char-hex-hash> is supported.');
  }

  const db = getDb();
  const media = db.prepare('SELECT id, type, title, file_path FROM media WHERE id = ?').get(mediaId);
  if (!media) throw new Error('Media not found');
  if (media.type !== 'movie') throw new Error('Torrent imports currently support movies only');
  if (db.prepare("SELECT id FROM media WHERE id = ? AND transcode_status IN ('pending', 'converting')").get(mediaId)) throw new Error('Preparation is already in progress for this media');

  const existing = db.prepare("SELECT id FROM downloads WHERE media_id = ? AND status IN ('downloading', 'importing', 'cancelling')").get(mediaId);
  if (existing) throw new Error('A download is already in progress for this media');

  const available = await checkAvailable();
  if (!available) throw new Error('Transmission daemon is not available');

  const { nanoid } = await import('nanoid');
  const id = nanoid();
  const downloadDir = path.resolve(process.env.TRANSMISSION_DOWNLOAD_DIR || path.join(MEDIA_DIR, '.downloads'), id);
  fs.mkdirSync(downloadDir, { recursive: true });
  const result = await rpcRequest('torrent-add', { filename: uri, 'download-dir': downloadDir });

  if (result['torrent-duplicate']) throw new Error('This torrent is already in Transmission');

  const torrent = result['torrent-added'] || result['torrent-duplicate'];
  if (!torrent || !torrent.hashString) {
    throw new Error('Failed to add torrent to Transmission');
  }

  db.prepare(
    'INSERT INTO downloads (id, media_id, torrent_hash, magnet_uri, status, progress, download_dir, started_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, mediaId, torrent.hashString, uri, 'downloading', 0, downloadDir, userId);

  db.prepare('UPDATE media SET download_status = ? WHERE id = ?').run('downloading', mediaId);

  return { id, torrentHash: torrent.hashString, status: 'downloading' };
}

async function getDownloadStatus(mediaId) {
  const db = getDb();
  const download = db.prepare('SELECT * FROM downloads WHERE media_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(mediaId);
  return download || null;
}

async function cancelDownload(mediaId) {
  const db = getDb();
  const download = db.prepare("SELECT * FROM downloads WHERE media_id = ? AND status IN ('downloading', 'importing', 'cancelling')").get(mediaId);
  if (!download) throw new Error('No active download for this media');
  if (download.status !== 'downloading') throw new Error('Import is in progress; wait for it to finish');
  db.prepare('UPDATE downloads SET status = ? WHERE id = ?').run('cancelling', download.id);

  try {
    await rpcRequest('torrent-remove', { ids: [download.torrent_hash], 'delete-local-data': true });
  } catch {
    db.prepare('UPDATE downloads SET status = ? WHERE id = ?').run('downloading', download.id);
    throw new Error('Cannot cancel the torrent while Transmission is unavailable');
  }

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

function findLargestVideoFile(dir, files = []) {
  if (!fs.existsSync(dir)) return null;

  let largestFile = null;
  let largestSize = 0;

  for (const file of files) {
    if (typeof file.name !== 'string' || !Number.isFinite(file.length) || !Number.isFinite(file.bytesCompleted) || file.bytesCompleted < file.length) continue;
    const fullPath = path.resolve(dir, file.name);
    if (!isWithinDir(fullPath, dir) || !fs.existsSync(fullPath)) continue;
    const stat = fs.statSync(fullPath);
    if (stat.isFile() && ALLOWED_EXTENSIONS.includes(path.extname(fullPath).toLowerCase()) && stat.size === file.length && stat.size > largestSize) {
      largestSize = stat.size;
      largestFile = fullPath;
    }
  }
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
      fields: ['hashString', 'name', 'downloadDir', 'percentDone', 'files'],
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
  if (!(torrent.percentDone >= 1)) throw new Error('Torrent download is not complete');
  const downloadDir = torrent.downloadDir || download.download_dir || '';

  const videoFile = findLargestVideoFile(downloadDir, torrent.files);
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
      await fs.promises.copyFile(videoFile, destPath);
      await fs.promises.unlink(videoFile);
    } else {
      throw err;
    }
  }

  const previousPath = media.file_path;
  const stat = fs.statSync(destPath);

  // Keep playback blocked until the file has been checked for conversion.
  const convert = await needsTranscoding(destPath);
  db.prepare('UPDATE media SET file_path = ?, file_size = ?, download_status = ?, transcode_status = ? WHERE id = ?').run(
    destPath, stat.size, 'completed', convert ? 'pending' : null, media.id
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

  if (convert) {
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
    if (db.prepare('SELECT status FROM downloads WHERE id = ?').get(dl.id)?.status !== 'downloading') continue;
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

    if (progress >= 1.0) {
      db.prepare('UPDATE downloads SET status = ?, progress = ? WHERE id = ?').run('importing', 1, dl.id);
      db.prepare('UPDATE media SET download_status = ? WHERE id = ?').run('importing', dl.media_id);
      await importCompletedTorrent(dl).catch((err) => {
        console.error('Downloaded media import failed.');
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
  pollDownloads,
  findLargestVideoFile,
};

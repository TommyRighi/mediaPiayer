const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getDb } = require('../server/db');

function printHelp() {
  console.log(`
  mediaPiayer — Transcode CLI

  Usage:  node scripts/transcode.js <command>

  Commands:
    start       Scan media folders and queue incompatible files for conversion.
                (requires ffmpeg + ffprobe installed)
    status      Show conversion progress for all in-progress / pending jobs.
    retry       Retry all failed conversion jobs (resets status → pending, re-enqueues).
    list        List all media & episodes with their transcode status.
    help        Show this help.
  `);
}

async function cmdStart() {
  console.log('Scanning media folders...\n');
  const { scanMediaFolder } = require('../server/routes/admin');
  const results = await scanMediaFolder();

  console.log(`  Movies added:    ${results.movies}`);
  console.log(`  Episodes added:  ${results.episodes}`);
  console.log(`  Series added:    ${results.series}`);
  console.log(`  Subtitles added: ${results.subtitles}`);
  console.log(`  Posters found:   ${results.posters}`);
  console.log(`  Queued for conv: ${results.converted || 0}`);
  console.log('');

  if (results.converted > 0) {
    console.log('Conversion jobs queued. Make sure the server is running to process them.');
    console.log('Check progress with: node scripts/transcode.js status\n');
  } else {
    console.log('No files need conversion.\n');
  }
}

function cmdStatus() {
  const db = getDb();

  const pendingMovies = db.prepare(`
    SELECT id, title, transcode_status, file_size FROM media
    WHERE transcode_status IN ('pending', 'converting') AND type = 'movie'
  `).all();

  const pendingEps = db.prepare(`
    SELECT e.id, e.title, e.transcode_status, e.file_size, m.title AS series_title
    FROM episodes e JOIN media m ON e.series_id = m.id
    WHERE e.transcode_status IN ('pending', 'converting')
  `).all();

  if (pendingMovies.length === 0 && pendingEps.length === 0) {
    console.log('No active conversion jobs.\n');
    return;
  }

  const formatSize = (bytes) => {
    if (!bytes) return '? MB';
    return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  };

  if (pendingMovies.length > 0) {
    console.log('Movies');
    console.log('──────');
    for (const m of pendingMovies) {
      console.log(`  [${m.transcode_status.toUpperCase().padEnd(10)}] ${m.title}  (${formatSize(m.file_size)})`);
    }
    console.log('');
  }

  if (pendingEps.length > 0) {
    console.log('Episodes');
    console.log('────────');
    for (const e of pendingEps) {
      console.log(`  [${e.transcode_status.toUpperCase().padEnd(10)}] ${e.series_title} — ${e.title}  (${formatSize(e.file_size)})`);
    }
    console.log('');
  }

  console.log(`Total: ${pendingMovies.length + pendingEps.length} job(s) pending or converting.\n`);
}

function cmdRetry() {
  const db = getDb();
  const { enqueue, needsTranscoding, getVideoCodecInfo } = require('../server/transcode');

  const failedMovies = db.prepare(
    `SELECT id, title, file_path FROM media WHERE transcode_status = 'failed' AND file_path IS NOT NULL`
  ).all();

  const failedEps = db.prepare(
    `SELECT e.id, e.title, e.file_path FROM episodes e WHERE e.transcode_status = 'failed' AND e.file_path IS NOT NULL`
  ).all();

  if (failedMovies.length === 0 && failedEps.length === 0) {
    console.log('No failed jobs to retry.\n');
    return;
  }

  let retried = 0;

  for (const m of failedMovies) {
    const info = getVideoCodecInfo(m.file_path);
    if (!info) {
      console.log(`  ✗  ${m.title}  (file unreadable — may be corrupted)`);
      continue;
    }
    if (needsTranscoding(m.file_path)) {
      db.prepare("UPDATE media SET transcode_status = 'pending' WHERE id = ?").run(m.id);
      enqueue('movie', m.id);
      console.log(`  ↻  ${m.title}`);
      retried++;
    } else {
      db.prepare("UPDATE media SET transcode_status = 'completed' WHERE id = ?").run(m.id);
      console.log(`  ✓  ${m.title}  (already compatible, marked as complete)`);
    }
  }

  for (const e of failedEps) {
    const info = getVideoCodecInfo(e.file_path);
    if (!info) {
      console.log(`  ✗  ${e.title}  (file unreadable — may be corrupted)`);
      continue;
    }
    if (needsTranscoding(e.file_path)) {
      db.prepare("UPDATE episodes SET transcode_status = 'pending' WHERE id = ?").run(e.id);
      enqueue('episode', e.id);
      console.log(`  ↻  ${e.title}`);
      retried++;
    } else {
      db.prepare("UPDATE episodes SET transcode_status = 'completed' WHERE id = ?").run(e.id);
      console.log(`  ✓  ${e.title}  (already compatible, marked as complete)`);
    }
  }

  console.log(`\n${retried} job(s) re-queued. Make sure the server is running to process them.\n`);
}

function cmdList() {
  const db = getDb();

  const allMedia = db.prepare(`
    SELECT id, title, type, transcode_status, file_path, file_size FROM media
    WHERE file_path IS NOT NULL ORDER BY type, title
  `).all();

  if (allMedia.length === 0) {
    console.log('No media files in library.\n');
    return;
  }

  const formatSize = (bytes) => {
    if (!bytes) return '? MB';
    return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  };

  const statusIcon = (s) => {
    if (!s || s === 'completed') return '✓';
    if (s === 'pending') return '○';
    if (s === 'converting') return '↻';
    if (s === 'failed') return '✗';
    return '?';
  };

  console.log(`${'Status'.padEnd(6)} Type    Title`);
  console.log('────── ─────── ────────────────────────────────────');

  for (const m of allMedia) {
    const icon = statusIcon(m.transcode_status);
    const type = m.type === 'movie' ? 'Movie' : 'Series';
    console.log(`  ${icon}    ${type.padEnd(7)} ${m.title}  (${formatSize(m.file_size)})`);

    if (m.type === 'series') {
      const episodes = db.prepare(`
        SELECT id, title, transcode_status, file_size FROM episodes
        WHERE series_id = ? ORDER BY season_number, episode_number
      `).all(m.id);

      for (const ep of episodes) {
        const epIcon = statusIcon(ep.transcode_status);
        console.log(`        ${epIcon}    Eps     ${ep.title}  (${formatSize(ep.file_size)})`);
      }
    }
  }

  console.log('');
  console.log('✓ = compatible/complete  ○ = pending  ↻ = converting  ✗ = failed\n');
}

const cmd = process.argv[2];

switch (cmd) {
  case 'start':
    cmdStart().catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
    break;
  case 'status':
    cmdStatus();
    break;
  case 'retry':
    cmdRetry();
    break;
  case 'list':
    cmdList();
    break;
  case 'help':
  default:
    printHelp();
    break;
}

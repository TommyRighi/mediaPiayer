const { getDb } = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const { SUBTITLE_EXTENSIONS, IMAGE_EXTENSIONS, detectSubtitleLang, MEDIA_DIR, MEDIA_DIRS, isWithinAnyDir, setMediaDirs } = require('../utils');
const { needsTranscoding, enqueue } = require('../transcode');
const { generateAllVariants } = require('../imageProcessor');

function extractTitle(filename) {
  let name = path.basename(filename, path.extname(filename));
  return name
    .replace(/[._-]/g, ' ')
    .replace(/\b(1080p|720p|4k|2160p|WEBRip|BluRay|HDRip|DDP?5\.1|AAC2\.0|x264|x265|H264|HEVC|YIFY)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findImageInDir(dir, names) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  for (const name of names) {
    for (const ext of IMAGE_EXTENSIONS) {
      const candidate = path.join(dir, name + ext);
      if (files.includes(name + ext) && fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function findPosterForVideo(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  return findImageInDir(dir, [base, base + '-poster', 'poster', 'folder', 'cover']);
}

function findBackdropForVideo(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  return findImageInDir(dir, [base + '-backdrop', 'backdrop', 'fanart', 'background']);
}

function findSubtitlesForVideo(videoPath) {
  const dir = path.dirname(videoPath);
  if (!fs.existsSync(dir)) return [];
  const base = path.basename(videoPath, path.extname(videoPath));
  const files = fs.readdirSync(dir);
  const subtitles = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!SUBTITLE_EXTENSIONS.includes(ext)) continue;
    const fileBase = path.basename(file, ext);
    if (fileBase === base || fileBase.startsWith(base + '.')) {
      const lang = detectSubtitleLang(file);
      subtitles.push({ filePath: path.join(dir, file), label: lang.label, language: lang.code });
    }
  }
  return subtitles;
}

async function scanMediaFolder() {
  const db = getDb();
  const results = { movies: 0, episodes: 0, series: 0, subtitles: 0, posters: 0, converted: 0 };

  for (const baseDir of MEDIA_DIRS) {
    const moviesDir = path.join(baseDir, 'movies');
    if (fs.existsSync(moviesDir)) {
      const files = fs.readdirSync(moviesDir);
      for (const file of files) {
        if (/\.(mp4|mkv|webm|mov|avi)$/i.test(file)) {
          const filePath = path.join(moviesDir, file);
          const stat = fs.statSync(filePath);
          const name = path.basename(file, path.extname(file)) + path.extname(file);

          const existing = db.prepare('SELECT id FROM media WHERE file_path = ?').get(filePath);
          if (!existing) {
            const id = nanoid();
            const title = extractTitle(file);
            const posterPath = findPosterForVideo(filePath);
            const backdropPath = findBackdropForVideo(filePath);
            db.prepare(
              `INSERT INTO media (id, title, type, file_path, file_size, poster_path, backdrop_path) VALUES (?, ?, 'movie', ?, ?, ?, ?)`
            ).run(id, title, filePath, stat.size, posterPath, backdropPath);
            if (posterPath) { results.posters; generateAllVariants(posterPath, 'poster'); }
            if (backdropPath) generateAllVariants(backdropPath, 'backdrop');

            if (needsTranscoding(filePath)) {
              db.prepare('UPDATE media SET transcode_status = ? WHERE id = ?').run('pending', id);
              enqueue('movie', id);
            }
          } else {
            const media = db.prepare('SELECT poster_path, backdrop_path, transcode_status FROM media WHERE id = ?').get(existing.id);
            if (!media.poster_path || !media.backdrop_path) {
              const posterPath = media.poster_path || findPosterForVideo(filePath);
              const backdropPath = media.backdrop_path || findBackdropForVideo(filePath);
              if (posterPath !== media.poster_path || backdropPath !== media.backdrop_path) {
                db.prepare('UPDATE media SET poster_path = ?, backdrop_path = ? WHERE id = ?')
                  .run(posterPath, backdropPath, existing.id);
                if (posterPath && !media.poster_path) { results.posters++; generateAllVariants(posterPath, 'poster'); }
                if (backdropPath && !media.backdrop_path) generateAllVariants(backdropPath, 'backdrop');
              }
            }
            if (!media.transcode_status && needsTranscoding(filePath)) {
              db.prepare('UPDATE media SET transcode_status = ? WHERE id = ?').run('pending', existing.id);
              enqueue('movie', existing.id);
              results.converted++;
            }
          }

          const mediaRow = db.prepare('SELECT id FROM media WHERE file_path = ?').get(filePath);
          if (mediaRow) {
            const subs = findSubtitlesForVideo(filePath);
            for (const sub of subs) {
              const existingSub = db.prepare('SELECT id FROM subtitles WHERE media_id = ? AND file_path = ?').get(mediaRow.id, sub.filePath);
              if (!existingSub) {
                db.prepare(
                  'INSERT INTO subtitles (id, media_id, label, language, file_path) VALUES (?, ?, ?, ?, ?)'
                ).run(nanoid(), mediaRow.id, sub.label, sub.language, sub.filePath);
                results.subtitles++;
              }
            }
          }
        }
      }
    }

    const seriesDir = path.join(baseDir, 'series');
    if (fs.existsSync(seriesDir)) {
      const showFolders = fs.readdirSync(seriesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const showName of showFolders) {
        const showPath = path.join(seriesDir, showName);
        const seasonFolders = fs.readdirSync(showPath, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);

        if (seasonFolders.length === 0) continue;

        let seriesId;
        const existing = db.prepare('SELECT id, poster_path, backdrop_path FROM media WHERE title = ? AND type = ?').get(showName, 'series');
        if (existing) {
          seriesId = existing.id;
          if (!existing.poster_path || !existing.backdrop_path) {
            const posterPath = existing.poster_path || findImageInDir(showPath, ['poster', 'folder', 'cover', showName]);
            const backdropPath = existing.backdrop_path || findImageInDir(showPath, ['backdrop', 'fanart', 'background']);
            if (posterPath !== existing.poster_path || backdropPath !== existing.backdrop_path) {
              db.prepare('UPDATE media SET poster_path = ?, backdrop_path = ? WHERE id = ?')
                .run(posterPath, backdropPath, seriesId);
              if (posterPath && !existing.poster_path) { results.posters++; generateAllVariants(posterPath, 'poster'); }
              if (backdropPath && !existing.backdrop_path) generateAllVariants(backdropPath, 'backdrop');
            }
          }
        } else {
          seriesId = nanoid();
          const posterPath = findImageInDir(showPath, ['poster', 'folder', 'cover', showName]);
          const backdropPath = findImageInDir(showPath, ['backdrop', 'fanart', 'background']);
          db.prepare(
            `INSERT INTO media (id, title, type, genre, poster_path, backdrop_path) VALUES (?, ?, 'series', '', ?, ?)`
          ).run(seriesId, showName, posterPath, backdropPath);
          results.series++;
          if (posterPath) { results.posters++; generateAllVariants(posterPath, 'poster'); }
          if (backdropPath) generateAllVariants(backdropPath, 'backdrop');
        }

        for (const seasonFolder of seasonFolders) {
          const seasonMatch = seasonFolder.match(/(\d+)/);
          const seasonNum = seasonMatch ? parseInt(seasonMatch[1]) : 1;
          const seasonPath = path.join(showPath, seasonFolder);

          const episodeFiles = fs.readdirSync(seasonPath)
            .filter(f => /\.(mp4|mkv|webm|mov|avi)$/i.test(f));

          for (const epFile of episodeFiles) {
            const epPath = path.join(seasonPath, epFile);
            const stat = fs.statSync(epPath);
            const existing = db.prepare('SELECT id FROM episodes WHERE file_path = ?').get(epPath);

            if (!existing) {
              const epNum = parseInt(epFile.match(/(\d+)/)?.[0]) || episodeFiles.indexOf(epFile) + 1;
              const epId = nanoid();
              const epTitle = extractTitle(epFile) || `Episode ${epNum}`;
              db.prepare(
                `INSERT INTO episodes (id, series_id, season_number, episode_number, title, file_path, file_size)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
              ).run(epId, seriesId, seasonNum, epNum, epTitle, epPath, stat.size);
              results.episodes++;

              if (needsTranscoding(epPath)) {
                db.prepare('UPDATE episodes SET transcode_status = ? WHERE id = ?').run('pending', epId);
                enqueue('episode', epId);
              }

              const subs = findSubtitlesForVideo(epPath);
              for (const sub of subs) {
                db.prepare(
                  'INSERT INTO subtitles (id, episode_id, label, language, file_path) VALUES (?, ?, ?, ?, ?)'
                ).run(nanoid(), epId, sub.label, sub.language, sub.filePath);
                results.subtitles++;
              }
            } else {
              const subs = findSubtitlesForVideo(epPath);
              for (const sub of subs) {
                const existingSub = db.prepare('SELECT id FROM subtitles WHERE episode_id = ? AND file_path = ?').get(existing.id, sub.filePath);
                if (!existingSub) {
                  db.prepare(
                    'INSERT INTO subtitles (id, episode_id, label, language, file_path) VALUES (?, ?, ?, ?, ?)'
                  ).run(nanoid(), existing.id, sub.label, sub.language, sub.filePath);
                  results.subtitles++;
                }
              }
              const ep = db.prepare('SELECT transcode_status FROM episodes WHERE id = ?').get(existing.id);
              if (!ep.transcode_status && needsTranscoding(epPath)) {
                db.prepare('UPDATE episodes SET transcode_status = ? WHERE id = ?').run('pending', existing.id);
                enqueue('episode', existing.id);
                results.converted++;
              }
            }
          }
        }
      }
    }
  }

  return results;
}

function deleteImageVariants(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try { fs.unlinkSync(filePath); } catch {}
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.startsWith(base + '-sm') || f.startsWith(base + '-md')) {
        try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
  } catch {}
}

async function cleanMissingMedia() {
  const db = getDb();
  const results = { movies: 0, episodes: 0, series: 0 };

  const movies = db.prepare('SELECT id, file_path, poster_path, backdrop_path FROM media WHERE type = ?').all('movie');
  for (const movie of movies) {
    if (!movie.file_path || !fs.existsSync(movie.file_path)) {
      deleteImageVariants(movie.poster_path);
      deleteImageVariants(movie.backdrop_path);
      db.prepare('DELETE FROM watch_parties WHERE media_id = ?').run(movie.id);
      db.prepare('DELETE FROM media WHERE id = ?').run(movie.id);
      results.movies++;
    }
  }

  const episodes = db.prepare('SELECT id, file_path FROM episodes').all();
  for (const ep of episodes) {
    if (!ep.file_path || !fs.existsSync(ep.file_path)) {
      db.prepare('DELETE FROM watch_parties WHERE episode_id = ?').run(ep.id);
      db.prepare('DELETE FROM watch_progress WHERE episode_id = ?').run(ep.id);
      db.prepare('DELETE FROM episodes WHERE id = ?').run(ep.id);
      results.episodes++;
    }
  }

  const series = db.prepare(`
    SELECT id, poster_path, backdrop_path FROM media
    WHERE type = 'series'
    AND id NOT IN (SELECT DISTINCT series_id FROM episodes)
  `).all();
  for (const s of series) {
    deleteImageVariants(s.poster_path);
    deleteImageVariants(s.backdrop_path);
    db.prepare('DELETE FROM watch_parties WHERE media_id = ?').run(s.id);
    db.prepare('DELETE FROM media WHERE id = ?').run(s.id);
    results.series++;
  }

  return results;
}

async function adminRoutes(fastify) {
  fastify.post('/api/admin/scan', { preHandler: [authMiddleware, adminMiddleware] }, async () => {
    const results = await scanMediaFolder();
    return { success: true, ...results };
  });

  fastify.post('/api/admin/clean', { preHandler: [authMiddleware, adminMiddleware] }, async () => {
    const results = await cleanMissingMedia();
    return { success: true, ...results };
  });

  fastify.get('/api/admin/storage', { preHandler: [authMiddleware, adminMiddleware] }, async () => {
    const dirs = MEDIA_DIRS.map(dir => {
      const resolved = path.resolve(dir);
      let exists = false;
      let freeBytes = null;
      let totalBytes = null;
      try {
        const stat = fs.statSync(resolved);
        exists = stat.isDirectory();
        if (exists) {
          try {
            const diskusage = require('diskusage');
            const info = diskusage.checkSync(resolved);
            freeBytes = info.available;
            totalBytes = info.total;
          } catch {
            try {
              const { execSync } = require('child_process');
              const output = execSync(`df -k "${resolved}"`, { encoding: 'utf-8' });
              const lines = output.trim().split('\n');
              const parts = lines[lines.length - 1].split(/\s+/);
              totalBytes = parseInt(parts[1]) * 1024;
              freeBytes = parseInt(parts[3]) * 1024;
            } catch {}
          }
        }
      } catch {}

      let entries = [];
      try {
        if (exists) {
          entries = fs.readdirSync(resolved).filter(f => {
            try { return fs.statSync(path.join(resolved, f)).isDirectory(); } catch { return false; }
          });
        }
      } catch {}

      return { path: resolved, exists, freeBytes, totalBytes, entries };
    });
    return { dirs, primary: path.resolve(MEDIA_DIR) };
  });

  fastify.post('/api/admin/storage', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const { dirs } = request.body;
    if (!Array.isArray(dirs)) {
      return reply.status(400).send({ error: 'dirs must be an array of paths' });
    }
    const validated = dirs.map(d => path.resolve(d));
    for (const d of validated) {
      try {
        const stat = fs.statSync(d);
        if (!stat.isDirectory()) {
          return reply.status(400).send({ error: `${d} is not a directory` });
        }
      } catch {
        return reply.status(400).send({ error: `Directory ${d} does not exist` });
      }
    }
    const envPath = path.join(__dirname, '..', '..', '.env');
    const primary = path.resolve(MEDIA_DIR);
    const allDirs = validated.includes(primary) ? validated : [...validated, primary];
    let envContent = '';
    try {
      envContent = fs.readFileSync(envPath, 'utf-8');
    } catch {}
    const lines = envContent.split('\n').filter(l => !l.startsWith('MEDIA_DIRS='));
    lines.push(`MEDIA_DIRS=${allDirs.join(',')}`);
    fs.writeFileSync(envPath, lines.join('\n') + '\n');
    setMediaDirs(allDirs);
    return { success: true, dirs: allDirs };
  });
}

module.exports = adminRoutes;
module.exports.scanMediaFolder = scanMediaFolder;
module.exports.cleanMissingMedia = cleanMissingMedia;

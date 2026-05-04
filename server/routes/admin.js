const { getDb } = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const { SUBTITLE_EXTENSIONS, IMAGE_EXTENSIONS, detectSubtitleLang } = require('../utils');

const MEDIA_DIR = path.join(__dirname, '..', '..', 'media');

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
  const results = { movies: 0, episodes: 0, series: 0, subtitles: 0, posters: 0 };

  const moviesDir = path.join(MEDIA_DIR, 'movies');
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
          if (posterPath) results.posters++;
        } else {
          const media = db.prepare('SELECT poster_path, backdrop_path FROM media WHERE id = ?').get(existing.id);
          if (!media.poster_path || !media.backdrop_path) {
            const posterPath = media.poster_path || findPosterForVideo(filePath);
            const backdropPath = media.backdrop_path || findBackdropForVideo(filePath);
            if (posterPath !== media.poster_path || backdropPath !== media.backdrop_path) {
              db.prepare('UPDATE media SET poster_path = ?, backdrop_path = ? WHERE id = ?')
                .run(posterPath, backdropPath, existing.id);
              if (posterPath && !media.poster_path) results.posters++;
            }
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

  const seriesDir = path.join(MEDIA_DIR, 'series');
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
            if (posterPath && !existing.poster_path) results.posters++;
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
        if (posterPath) results.posters++;
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
          }
        }
      }
    }
  }

  return results;
}

async function adminRoutes(fastify) {
  fastify.post('/api/admin/scan', { preHandler: [authMiddleware, adminMiddleware] }, async () => {
    const results = await scanMediaFolder();
    return { success: true, ...results };
  });
}

module.exports = adminRoutes;

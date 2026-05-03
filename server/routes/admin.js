const { getDb } = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');

const MEDIA_DIR = path.join(__dirname, '..', '..', 'media');

function extractTitle(filename) {
  let name = path.basename(filename, path.extname(filename));
  return name
    .replace(/[._-]/g, ' ')
    .replace(/\b(1080p|720p|4k|2160p|WEBRip|BluRay|HDRip|DDP?5\.1|AAC2\.0|x264|x265|H264|HEVC|YIFY)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function scanMediaFolder() {
  const db = getDb();
  const results = { movies: 0, episodes: 0, series: 0 };

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
          db.prepare(
            `INSERT INTO media (id, title, type, file_path, file_size) VALUES (?, ?, 'movie', ?, ?)`
          ).run(id, title, filePath, stat.size);
          results.movies++;
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
      const existing = db.prepare('SELECT id FROM media WHERE title = ? AND type = ?').get(showName, 'series');
      if (existing) {
        seriesId = existing.id;
      } else {
        seriesId = nanoid();
        db.prepare(
          `INSERT INTO media (id, title, type, genre) VALUES (?, ?, 'series', '')`
        ).run(seriesId, showName);
        results.series++;
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

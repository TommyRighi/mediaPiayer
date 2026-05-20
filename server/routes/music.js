const { getDb } = require('../db');
const { authMiddleware, mediaAuth, adminMiddleware } = require('../auth');
const { MEDIA_DIRS, isWithinAnyDir } = require('../utils');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const { spawn, execFile } = require('child_process');

const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.wma', '.opus'];
const AUDIO_MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.opus': 'audio/opus',
};

function getAudioMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return AUDIO_MIME_TYPES[ext] || 'audio/mpeg';
}

function streamAudio(request, reply, filePath) {
  if (!isWithinAnyDir(filePath, MEDIA_DIRS) && !filePath.startsWith(path.join(__dirname, '..', 'media'))) {
    return reply.status(403).send({ error: 'Invalid file path' });
  }
  if (!fs.existsSync(filePath)) {
    return reply.status(404).send({ error: 'Audio file not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const contentType = getAudioMimeType(filePath);
  const etag = `"${stat.size}-${stat.mtimeMs}"`;
  const range = request.headers.range;

  const cacheHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
    'ETag': etag,
    'Last-Modified': stat.mtime.toUTCString(),
  };

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
      return reply.status(416).headers({ 'Content-Range': `bytes */${fileSize}` }).send({ error: 'Invalid range' });
    }
    const chunkSize = end - start + 1;
    reply.status(206).headers({
      ...cacheHeaders,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize,
    });
    return fs.createReadStream(filePath, { start, end, highWaterMark: 1024 * 1024 });
  }

  reply.headers({ ...cacheHeaders, 'Content-Length': fileSize });
  return fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
}

const ytDlpJobs = new Map();

function scanMusicFolder() {
  const db = getDb();
  const results = { albums: 0, tracks: 0 };

  for (const baseDir of MEDIA_DIRS) {
    const musicDir = path.join(baseDir, 'music');
    if (!fs.existsSync(musicDir)) continue;

    const entries = fs.readdirSync(musicDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const albumPath = path.join(musicDir, entry.name);
        const albumFiles = fs.readdirSync(albumPath);

        let coverPath = null;
        for (const imgName of ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.png', 'front.jpg', 'front.png']) {
          if (albumFiles.includes(imgName)) {
            coverPath = path.join(albumPath, imgName);
            break;
          }
        }

        let existingAlbum = db.prepare("SELECT id FROM music_albums WHERE title = ? AND artist = ''").get(entry.name);
        if (!existingAlbum) {
          const albumId = nanoid();
          db.prepare(
            'INSERT INTO music_albums (id, title, cover_path) VALUES (?, ?, ?)'
          ).run(albumId, entry.name, coverPath);
          results.albums++;
        } else {
          if (coverPath && !db.prepare('SELECT cover_path FROM music_albums WHERE id = ?').get(existingAlbum.id).cover_path) {
            db.prepare('UPDATE music_albums SET cover_path = ? WHERE id = ?').run(coverPath, existingAlbum.id);
          }
        }

        const album = existingAlbum || db.prepare("SELECT id FROM music_albums WHERE title = ? AND artist = ''").get(entry.name);

        for (const file of albumFiles) {
          const ext = path.extname(file).toLowerCase();
          if (!AUDIO_EXTENSIONS.includes(ext)) continue;

          const filePath = path.join(albumPath, file);
          const stat = fs.statSync(filePath);

          const existingTrack = db.prepare('SELECT id FROM music_tracks WHERE file_path = ?').get(filePath);
          if (existingTrack) continue;

          const trackId = nanoid();
          const title = path.basename(file, ext).replace(/[._-]/g, ' ').trim();
          const trackNum = parseInt((file.match(/^(\d+)/) || [])[1]) || 0;

          db.prepare(
            'INSERT INTO music_tracks (id, album_id, track_number, title, file_path, file_size) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(trackId, album.id, trackNum, title, filePath, stat.size);
          results.tracks++;
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!AUDIO_EXTENSIONS.includes(ext)) continue;

        const filePath = path.join(musicDir, entry.name);
        const stat = fs.statSync(filePath);

        const existingTrack = db.prepare('SELECT id FROM music_tracks WHERE file_path = ?').get(filePath);
        if (existingTrack) continue;

        const trackId = nanoid();
        const title = path.basename(entry.name, ext).replace(/[._-]/g, ' ').trim();

        db.prepare(
          'INSERT INTO music_tracks (id, track_number, title, file_path, file_size) VALUES (?, ?, ?, ?, ?)'
        ).run(trackId, 0, title, filePath, stat.size);
        results.tracks++;
      }
    }
  }

  return results;
}

async function musicRoutes(fastify) {

  // ===== ALBUMS =====

  fastify.get('/api/music/albums', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    const { search, genre } = request.query;
    let query = `
      SELECT a.*, COUNT(t.id) as track_count,
        COALESCE(SUM(t.duration), 0) as total_duration
      FROM music_albums a
      LEFT JOIN music_tracks t ON t.album_id = a.id
      WHERE 1=1
    `;
    const params = [];
    if (search) { query += ' AND a.title LIKE ?'; params.push(`%${search}%`); }
    if (genre) { query += ' AND a.genre = ?'; params.push(genre); }
    query += ' GROUP BY a.id ORDER BY a.created_at DESC';
    return db.prepare(query).all(...params);
  });

  fastify.get('/api/music/albums/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const album = db.prepare('SELECT * FROM music_albums WHERE id = ?').get(request.params.id);
    if (!album) return reply.status(404).send({ error: 'Album not found' });
    const tracks = db.prepare(
      'SELECT * FROM music_tracks WHERE album_id = ? ORDER BY track_number, title'
    ).all(album.id);
    return { ...album, tracks };
  });

  fastify.post('/api/music/albums', { preHandler: [authMiddleware, adminMiddleware] }, async (request) => {
    const db = getDb();
    const { title, artist, description, genre, year, cover_path } = request.body;
    if (!title) throw { statusCode: 400, message: 'Title is required' };
    const id = nanoid();
    db.prepare(
      'INSERT INTO music_albums (id, title, artist, description, genre, year, cover_path) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, title, artist || '', description || '', genre || '', year || null, cover_path || null);
    return db.prepare('SELECT * FROM music_albums WHERE id = ?').get(id);
  });

  fastify.patch('/api/music/albums/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const db = getDb();
    const album = db.prepare('SELECT * FROM music_albums WHERE id = ?').get(request.params.id);
    if (!album) return reply.status(404).send({ error: 'Album not found' });
    const { title, artist, description, genre, year, cover_path } = request.body;
    if (title !== undefined) album.title = title;
    if (artist !== undefined) album.artist = artist;
    if (description !== undefined) album.description = description;
    if (genre !== undefined) album.genre = genre;
    if (year !== undefined) album.year = year;
    if (cover_path !== undefined) album.cover_path = cover_path;
    db.prepare(
      'UPDATE music_albums SET title=?, artist=?, description=?, genre=?, year=?, cover_path=?, updated_at=datetime(\'now\') WHERE id=?'
    ).run(album.title, album.artist, album.description, album.genre, album.year, album.cover_path, album.id);
    return db.prepare('SELECT * FROM music_albums WHERE id = ?').get(album.id);
  });

  fastify.delete('/api/music/albums/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const db = getDb();
    const album = db.prepare('SELECT * FROM music_albums WHERE id = ?').get(request.params.id);
    if (!album) return reply.status(404).send({ error: 'Album not found' });
    db.prepare('DELETE FROM music_albums WHERE id = ?').run(album.id);
    return { success: true };
  });

  // ===== ALBUM COVER =====

  fastify.get('/api/music/albums/:id/cover', { preHandler: [mediaAuth] }, async (request, reply) => {
    const db = getDb();
    const album = db.prepare('SELECT cover_path FROM music_albums WHERE id = ?').get(request.params.id);
    if (!album || !album.cover_path) return reply.status(404).send({ error: 'No cover' });
    const filePath = path.resolve(album.cover_path);
    if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'Cover file not found' });
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
    reply.headers({ 'Content-Type': mimeTypes[ext] || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(filePath);
  });

  // ===== TRACKS =====

  fastify.get('/api/music/tracks', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    const { album_id, search } = request.query;
    let query = 'SELECT * FROM music_tracks WHERE 1=1';
    const params = [];
    if (album_id) { query += ' AND album_id = ?'; params.push(album_id); }
    if (search) { query += ' AND title LIKE ?'; params.push(`%${search}%`); }
    query += ' ORDER BY album_id, track_number, title';
    return db.prepare(query).all(...params);
  });

  fastify.get('/api/music/tracks/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const track = db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(request.params.id);
    if (!track) return reply.status(404).send({ error: 'Track not found' });
    return track;
  });

  fastify.get('/api/music/tracks/:id/stream', { preHandler: [mediaAuth] }, async (request, reply) => {
    const db = getDb();
    const track = db.prepare('SELECT file_path FROM music_tracks WHERE id = ?').get(request.params.id);
    if (!track) return reply.status(404).send({ error: 'Track not found' });
    return streamAudio(request, reply, track.file_path);
  });

  fastify.patch('/api/music/tracks/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const db = getDb();
    const track = db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(request.params.id);
    if (!track) return reply.status(404).send({ error: 'Track not found' });
    const { title, artist, track_number, album_id } = request.body;
    if (title !== undefined) track.title = title;
    if (artist !== undefined) track.artist = artist;
    if (track_number !== undefined) track.track_number = track_number;
    if (album_id !== undefined) track.album_id = album_id || null;
    db.prepare('UPDATE music_tracks SET title=?, artist=?, track_number=?, album_id=? WHERE id=?')
      .run(track.title, track.artist, track.track_number, track.album_id, track.id);
    return db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(track.id);
  });

  fastify.delete('/api/music/tracks/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const db = getDb();
    const track = db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(request.params.id);
    if (!track) return reply.status(404).send({ error: 'Track not found' });
    db.prepare('DELETE FROM music_tracks WHERE id = ?').run(track.id);
    return { success: true };
  });

  // ===== TRACK UPLOAD (admin) =====

  fastify.post('/api/music/tracks/upload', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const ext = path.extname(data.filename).toLowerCase();
    if (!AUDIO_EXTENSIONS.includes(ext)) {
      return reply.status(400).send({ error: 'Invalid audio file type' });
    }

    const { album_id, title, artist, track_number } = data.fields || {};
    const trackTitle = (title && title.value) || path.basename(data.filename, ext).replace(/[._-]/g, ' ').trim();
    const trackArtist = (artist && artist.value) || '';
    const trackNum = (track_number && parseInt(track_number.value)) || 0;
    const albumId = (album_id && album_id.value) || null;

    const musicDir = path.join(MEDIA_DIRS[0], 'music');
    fs.mkdirSync(musicDir, { recursive: true });

    let targetDir;
    if (albumId) {
      const album = db.prepare('SELECT * FROM music_albums WHERE id = ?').get(albumId);
      if (!album) return reply.status(404).send({ error: 'Album not found' });
      targetDir = path.dirname(album.cover_path && fs.existsSync(album.cover_path) ? album.cover_path : path.join(musicDir, album.title));
      fs.mkdirSync(targetDir, { recursive: true });
    } else {
      targetDir = path.join(musicDir, 'singles');
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const safeName = trackTitle.replace(/[/\\?%*:|"<>]/g, '_') + ext;
    const filePath = path.join(targetDir, safeName);
    const buffer = await data.toBuffer();
    fs.writeFileSync(filePath, buffer);

    const id = nanoid();
    const db = getDb();
    db.prepare(
      'INSERT INTO music_tracks (id, album_id, track_number, title, artist, file_path, file_size) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, albumId, trackNum, trackTitle, trackArtist, filePath, buffer.length);

    return db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(id);
  });

  // ===== PLAYLISTS =====

  fastify.get('/api/music/playlists', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    return db.prepare(
      `SELECT p.*, COUNT(pt.id) as track_count,
        COALESCE(SUM(t.duration), 0) as total_duration
       FROM playlists p
       LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
       LEFT JOIN music_tracks t ON t.id = pt.track_id
       WHERE p.user_id = ?
       GROUP BY p.id
       ORDER BY p.updated_at DESC`
    ).all(request.user.id);
  });

  fastify.get('/api/music/playlists/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(request.params.id);
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });
    if (playlist.user_id !== request.user.id) return reply.status(403).send({ error: 'Not your playlist' });
    const tracks = db.prepare(`
      SELECT t.*, pt.position, pt.added_at
      FROM playlist_tracks pt
      JOIN music_tracks t ON t.id = pt.track_id
      WHERE pt.playlist_id = ?
      ORDER BY pt.position
    `).all(playlist.id);
    return { ...playlist, tracks };
  });

  fastify.post('/api/music/playlists', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    const { name, description } = request.body;
    if (!name) throw { statusCode: 400, message: 'Name is required' };
    const id = nanoid();
    db.prepare(
      'INSERT INTO playlists (id, user_id, name, description) VALUES (?, ?, ?, ?)'
    ).run(id, request.user.id, name, description || '');
    return db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  });

  fastify.patch('/api/music/playlists/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(request.params.id);
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });
    if (playlist.user_id !== request.user.id) return reply.status(403).send({ error: 'Not your playlist' });
    const { name, description } = request.body;
    if (name !== undefined) playlist.name = name;
    if (description !== undefined) playlist.description = description;
    db.prepare('UPDATE playlists SET name=?, description=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(playlist.name, playlist.description, playlist.id);
    return db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlist.id);
  });

  fastify.delete('/api/music/playlists/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(request.params.id);
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });
    if (playlist.user_id !== request.user.id) return reply.status(403).send({ error: 'Not your playlist' });
    db.prepare('DELETE FROM playlists WHERE id = ?').run(playlist.id);
    return { success: true };
  });

  // ===== PLAYLIST TRACKS =====

  fastify.post('/api/music/playlists/:id/tracks', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(request.params.id);
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });
    if (playlist.user_id !== request.user.id) return reply.status(403).send({ error: 'Not your playlist' });
    const { track_ids } = request.body;
    if (!Array.isArray(track_ids)) return reply.status(400).send({ error: 'track_ids must be an array' });

    const maxPos = db.prepare('SELECT MAX(position) as max FROM playlist_tracks WHERE playlist_id = ?').get(playlist.id);
    let pos = (maxPos && maxPos.max !== null) ? maxPos.max + 1 : 0;

    const added = [];
    for (const trackId of track_ids) {
      const track = db.prepare('SELECT id FROM music_tracks WHERE id = ?').get(trackId);
      if (!track) continue;
      const existing = db.prepare('SELECT id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').get(playlist.id, trackId);
      if (existing) continue;
      const id = nanoid();
      db.prepare('INSERT INTO playlist_tracks (id, playlist_id, track_id, position) VALUES (?, ?, ?, ?)').run(id, playlist.id, trackId, pos);
      added.push(trackId);
      pos++;
    }
    db.prepare("UPDATE playlists SET updated_at=datetime('now') WHERE id=?").run(playlist.id);
    return { success: true, added };
  });

  fastify.delete('/api/music/playlists/:id/tracks/:trackId', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(request.params.id);
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });
    if (playlist.user_id !== request.user.id) return reply.status(403).send({ error: 'Not your playlist' });
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlist.id, request.params.trackId);

    const tracks = db.prepare('SELECT id, position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(playlist.id);
    const reorder = db.prepare('UPDATE playlist_tracks SET position = ? WHERE id = ?');
    for (let i = 0; i < tracks.length; i++) {
      reorder.run(i, tracks[i].id);
    }
    db.prepare("UPDATE playlists SET updated_at=datetime('now') WHERE id=?").run(playlist.id);
    return { success: true };
  });

  fastify.post('/api/music/playlists/:id/reorder', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(request.params.id);
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });
    if (playlist.user_id !== request.user.id) return reply.status(403).send({ error: 'Not your playlist' });
    const { track_ids } = request.body;
    if (!Array.isArray(track_ids)) return reply.status(400).send({ error: 'track_ids must be an array' });
    const updatePos = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?');
    for (let i = 0; i < track_ids.length; i++) {
      updatePos.run(i, playlist.id, track_ids[i]);
    }
    return { success: true };
  });

  // ===== FAVORITES =====

  fastify.get('/api/music/favorites', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    return db.prepare(`
      SELECT t.*, f.created_at as favorited_at
      FROM favorite_tracks f
      JOIN music_tracks t ON t.id = f.track_id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC
    `).all(request.user.id);
  });

  fastify.post('/api/music/favorites/:trackId', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const track = db.prepare('SELECT id FROM music_tracks WHERE id = ?').get(request.params.trackId);
    if (!track) return reply.status(404).send({ error: 'Track not found' });
    try {
      const id = nanoid();
      db.prepare('INSERT INTO favorite_tracks (id, user_id, track_id) VALUES (?, ?, ?)').run(id, request.user.id, request.params.trackId);
      return { success: true };
    } catch (e) {
      if (e.message.includes('UNIQUE')) return { success: true };
      throw e;
    }
  });

  fastify.delete('/api/music/favorites/:trackId', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    db.prepare('DELETE FROM favorite_tracks WHERE user_id = ? AND track_id = ?').run(request.user.id, request.params.trackId);
    return { success: true };
  });

  // ===== PROGRESS =====

  fastify.post('/api/music/progress', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    const { track_id, progress_seconds, duration, completed } = request.body;
    if (!track_id) throw { statusCode: 400, message: 'track_id is required' };
    const existing = db.prepare('SELECT id FROM track_progress WHERE user_id = ? AND track_id = ?').get(request.user.id, track_id);
    if (existing) {
      db.prepare(
        'UPDATE track_progress SET progress_seconds=?, duration=?, completed=?, updated_at=datetime(\'now\') WHERE id=?'
      ).run(progress_seconds, duration || 0, completed ? 1 : 0, existing.id);
    } else {
      const id = nanoid();
      db.prepare(
        'INSERT INTO track_progress (id, user_id, track_id, progress_seconds, duration, completed) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, request.user.id, track_id, progress_seconds, duration || 0, completed ? 1 : 0);
    }
    return { success: true };
  });

  fastify.get('/api/music/progress', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    return db.prepare('SELECT * FROM track_progress WHERE user_id = ?').all(request.user.id);
  });

  // ===== YOUTUBE DOWNLOAD =====

  fastify.post('/api/music/youtube/download', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const { url, title, artist } = request.body;
    if (!url) return reply.status(400).send({ error: 'URL is required' });

    const id = nanoid();
    const db = getDb();
    db.prepare(
      'INSERT INTO youtube_downloads (id, user_id, url, title, artist, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, request.user.id, url, title || '', artist || '', 'downloading');

    const musicDir = path.join(MEDIA_DIRS[0], 'music', 'youtube');
    fs.mkdirSync(musicDir, { recursive: true });

    const outputPath = path.join(musicDir, `${id}.mp3`);

    const job = { id, url, outputPath, status: 'downloading', progress: 0 };
    ytDlpJobs.set(id, job);

    const ytDlp = spawn('yt-dlp', [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--output', outputPath,
      '--newline',
      '--no-playlist',
      url,
    ]);

    ytDlp.stdout.on('data', (data) => {
      const output = data.toString();
      const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (progressMatch) {
        job.progress = parseFloat(progressMatch[1]);
        db.prepare('UPDATE youtube_downloads SET progress = ? WHERE id = ?').run(job.progress, id);
      }
    });

    ytDlp.stderr.on('data', () => {});

    ytDlp.on('close', (code) => {
      if (code === 0) {
        let finalPath = outputPath;
        if (!fs.existsSync(outputPath)) {
          const altPath = outputPath.replace(/\.mp3$/, '.webm');
          if (fs.existsSync(altPath)) finalPath = altPath;
        }

        if (fs.existsSync(finalPath)) {
          const stat = fs.statSync(finalPath);
          const trackTitle = title || db.prepare('SELECT title FROM youtube_downloads WHERE id = ?').get(id).title || 'Unknown Track';
          const trackArtist = artist || db.prepare('SELECT artist FROM youtube_downloads WHERE id = ?').get(id).artist || '';

          const trackId = nanoid();
          db.prepare(
            'INSERT INTO music_tracks (id, track_number, title, artist, file_path, file_size) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(trackId, 0, trackTitle, trackArtist, finalPath, stat.size);

          db.prepare('UPDATE youtube_downloads SET status=?, progress=100, file_path=?, track_id=? WHERE id=?')
            .run('completed', finalPath, trackId, id);
          job.status = 'completed';
          job.trackId = trackId;
        } else {
          db.prepare('UPDATE youtube_downloads SET status=?, error=? WHERE id=?').run('failed', 'Output file not found', id);
          job.status = 'failed';
        }
      } else {
        db.prepare('UPDATE youtube_downloads SET status=?, error=? WHERE id=?').run('failed', `Process exited with code ${code}`, id);
        job.status = 'failed';
      }
      ytDlpJobs.delete(id);
    });

    return { id, status: 'downloading' };
  });

  fastify.get('/api/music/youtube/status/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const db = getDb();
    const dl = db.prepare('SELECT * FROM youtube_downloads WHERE id = ?').get(request.params.id);
    if (!dl) return reply.status(404).send({ error: 'Download not found' });
    const job = ytDlpJobs.get(request.params.id);
    return { ...dl, progress: job ? job.progress : dl.progress };
  });

  fastify.get('/api/music/youtube/downloads', { preHandler: [authMiddleware, adminMiddleware] }, async () => {
    const db = getDb();
    return db.prepare('SELECT * FROM youtube_downloads ORDER BY created_at DESC LIMIT 50').all();
  });

  // ===== SCAN MUSIC =====

  fastify.post('/api/music/scan', { preHandler: [authMiddleware, adminMiddleware] }, async () => {
    const results = scanMusicFolder();
    return { success: true, ...results };
  });

  // ===== RANDOM TRACKS =====

  fastify.get('/api/music/random', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    const { limit } = request.query;
    const n = Math.min(parseInt(limit) || 20, 100);
    return db.prepare('SELECT * FROM music_tracks ORDER BY RANDOM() LIMIT ?').all(n);
  });
}

module.exports = musicRoutes;
module.exports.scanMusicFolder = scanMusicFolder;
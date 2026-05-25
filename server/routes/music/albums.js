const { getDb } = require('../../db');
const { authMiddleware, mediaAuth, adminMiddleware } = require('../../auth');
const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');

async function albumsRoutes(fastify) {

  fastify.get('/albums', { preHandler: [authMiddleware] }, async (request) => {
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

  fastify.get('/albums/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const album = db.prepare('SELECT * FROM music_albums WHERE id = ?').get(request.params.id);
    if (!album) return reply.status(404).send({ error: 'Album not found' });
    const tracks = db.prepare(
      'SELECT * FROM music_tracks WHERE album_id = ? ORDER BY track_number, title'
    ).all(album.id);
    return { ...album, tracks };
  });

  fastify.post('/albums', { preHandler: [authMiddleware, adminMiddleware] }, async (request) => {
    const db = getDb();
    const { title, artist, description, genre, year, cover_path } = request.body;
    if (!title) throw { statusCode: 400, message: 'Title is required' };
    const id = nanoid();
    db.prepare(
      'INSERT INTO music_albums (id, title, artist, description, genre, year, cover_path) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, title, artist || '', description || '', genre || '', year || null, cover_path || null);
    return db.prepare('SELECT * FROM music_albums WHERE id = ?').get(id);
  });

  fastify.patch('/albums/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
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

  fastify.delete('/albums/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const db = getDb();
    const album = db.prepare('SELECT * FROM music_albums WHERE id = ?').get(request.params.id);
    if (!album) return reply.status(404).send({ error: 'Album not found' });
    db.prepare('DELETE FROM music_albums WHERE id = ?').run(album.id);
    return { success: true };
  });

  fastify.get('/albums/:id/cover', { preHandler: [mediaAuth] }, async (request, reply) => {
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
}

module.exports = albumsRoutes;

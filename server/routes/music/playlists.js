const { getDb } = require('../../db');
const { authMiddleware } = require('../../auth');
const { nanoid } = require('nanoid');

async function playlistsRoutes(fastify) {

  fastify.get('/playlists', { preHandler: [authMiddleware] }, async (request) => {
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

  fastify.get('/playlists/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
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

  fastify.post('/playlists', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    const { name, description } = request.body;
    if (!name) throw { statusCode: 400, message: 'Name is required' };
    const id = nanoid();
    db.prepare(
      'INSERT INTO playlists (id, user_id, name, description) VALUES (?, ?, ?, ?)'
    ).run(id, request.user.id, name, description || '');
    return db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  });

  fastify.patch('/playlists/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
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

  fastify.delete('/playlists/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(request.params.id);
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });
    if (playlist.user_id !== request.user.id) return reply.status(403).send({ error: 'Not your playlist' });
    db.prepare('DELETE FROM playlists WHERE id = ?').run(playlist.id);
    return { success: true };
  });

  fastify.post('/playlists/:id/tracks', { preHandler: [authMiddleware] }, async (request, reply) => {
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

  fastify.delete('/playlists/:id/tracks/:trackId', { preHandler: [authMiddleware] }, async (request, reply) => {
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

  fastify.post('/playlists/:id/reorder', { preHandler: [authMiddleware] }, async (request, reply) => {
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
}

module.exports = playlistsRoutes;

const { getDb } = require('../db');
const { authMiddleware } = require('../auth');
const { nanoid } = require('nanoid');

async function requestRoutes(fastify) {
  fastify.post('/api/requests', { preHandler: authMiddleware }, async (request, reply) => {
    const { mediaId, episodeId, scheduledAt } = request.body || {};

    if (!mediaId) {
      return reply.status(400).send({ error: 'mediaId is required' });
    }
    if (!scheduledAt) {
      return reply.status(400).send({ error: 'scheduledAt is required' });
    }

    const scheduled = new Date(scheduledAt);
    if (isNaN(scheduled.getTime()) || scheduled <= new Date()) {
      return reply.status(400).send({ error: 'scheduledAt must be a future date' });
    }

    const db = getDb();
    const media = db.prepare('SELECT id FROM media WHERE id = ?').get(mediaId);
    if (!media) {
      return reply.status(404).send({ error: 'Media not found' });
    }

    const requestId = nanoid();
    db.prepare(
      'INSERT INTO watch_requests (id, created_by, media_id, episode_id, scheduled_at) VALUES (?, ?, ?, ?, ?)'
    ).run(requestId, request.user.id, mediaId, episodeId || null, scheduled.toISOString());

    db.prepare(
      'INSERT OR REPLACE INTO request_responses (id, request_id, user_id, response) VALUES (?, ?, ?, ?)'
    ).run(nanoid(), requestId, request.user.id, 'approved');

    const req = db.prepare(
      `SELECT wr.*, m.title AS media_title, m.type AS media_type,
              e.title AS episode_title
       FROM watch_requests wr
       JOIN media m ON wr.media_id = m.id
       LEFT JOIN episodes e ON wr.episode_id = e.id
       WHERE wr.id = ?`
    ).get(requestId);

    return { request: req };
  });

  fastify.get('/api/requests', { preHandler: authMiddleware }, async (request, reply) => {
    const db = getDb();

    db.prepare(
      `UPDATE watch_requests SET status = 'expired'
       WHERE status = 'pending' AND datetime(scheduled_at, '+1 hour') < datetime('now')`
    ).run();

    const requests = db.prepare(
      `SELECT wr.*, m.title AS media_title, m.type AS media_type,
              e.title AS episode_title,
              u.display_name AS creator_name,
              (SELECT COUNT(*) FROM request_responses rr WHERE rr.request_id = wr.id AND rr.response = 'approved') AS approved_count,
              (SELECT COUNT(*) FROM request_responses rr WHERE rr.request_id = wr.id AND rr.response = 'dismissed') AS dismissed_count,
              (SELECT rr.response FROM request_responses rr WHERE rr.request_id = wr.id AND rr.user_id = ?) AS my_response
       FROM watch_requests wr
       JOIN media m ON wr.media_id = m.id
       LEFT JOIN episodes e ON wr.episode_id = e.id
       JOIN users u ON wr.created_by = u.id
       ORDER BY wr.scheduled_at DESC
       LIMIT 100`
    ).all(request.user.id);

    return { requests };
  });

  fastify.get('/api/requests/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const db = getDb();

    const req = db.prepare(
      `SELECT wr.*, m.title AS media_title, m.type AS media_type,
              e.title AS episode_title,
              u.display_name AS creator_name,
              (SELECT COUNT(*) FROM request_responses rr WHERE rr.request_id = wr.id AND rr.response = 'approved') AS approved_count,
              (SELECT COUNT(*) FROM request_responses rr WHERE rr.request_id = wr.id AND rr.response = 'dismissed') AS dismissed_count,
              (SELECT rr.response FROM request_responses rr WHERE rr.request_id = wr.id AND rr.user_id = ?) AS my_response
       FROM watch_requests wr
       JOIN media m ON wr.media_id = m.id
       LEFT JOIN episodes e ON wr.episode_id = e.id
       JOIN users u ON wr.created_by = u.id
       WHERE wr.id = ?`
    ).get(request.user.id, request.params.id);

    if (!req) {
      return reply.status(404).send({ error: 'Request not found' });
    }

    if (req.status === 'pending' && new Date(req.scheduled_at).getTime() + 3600000 < Date.now()) {
      db.prepare('UPDATE watch_requests SET status = ? WHERE id = ?').run('expired', req.id);
      req.status = 'expired';
    }

    const responses = db.prepare(
      `SELECT rr.response, rr.user_id, u.display_name, u.avatar_url
       FROM request_responses rr
       JOIN users u ON rr.user_id = u.id
       WHERE rr.request_id = ?`
    ).all(request.params.id);

    return { request: req, responses };
  });

  fastify.delete('/api/requests/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const db = getDb();
    const req = db.prepare('SELECT * FROM watch_requests WHERE id = ?').get(request.params.id);

    if (!req) {
      return reply.status(404).send({ error: 'Request not found' });
    }
    if (req.created_by !== request.user.id && request.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Only the creator can cancel this request' });
    }

    db.prepare('UPDATE watch_requests SET status = ? WHERE id = ?').run('cancelled', req.id);
    return { success: true };
  });

  fastify.post('/api/requests/:id/respond', { preHandler: authMiddleware }, async (request, reply) => {
    const { response } = request.body || {};
    if (!['approved', 'dismissed'].includes(response)) {
      return reply.status(400).send({ error: 'response must be "approved" or "dismissed"' });
    }

    const db = getDb();
    const req = db.prepare('SELECT * FROM watch_requests WHERE id = ?').get(request.params.id);

    if (!req) {
      return reply.status(404).send({ error: 'Request not found' });
    }
    if (req.status !== 'pending') {
      return reply.status(400).send({ error: 'This request is no longer open for responses' });
    }

    db.prepare(
      'INSERT OR REPLACE INTO request_responses (id, request_id, user_id, response) VALUES (?, ?, ?, ?)'
    ).run(nanoid(), req.id, request.user.id, response);

    const approvedCount = db.prepare(
      'SELECT COUNT(*) AS count FROM request_responses WHERE request_id = ? AND response = ?'
    ).get(req.id, 'approved').count;

    return { success: true, approvedCount };
  });

  fastify.post('/api/requests/:id/activate', { preHandler: authMiddleware }, async (request, reply) => {
    const db = getDb();
    const req = db.prepare(
      `SELECT wr.*, (SELECT COUNT(*) FROM request_responses rr WHERE rr.request_id = wr.id AND rr.response = 'approved') AS approved_count
       FROM watch_requests wr WHERE wr.id = ?`
    ).get(request.params.id);

    if (!req) {
      return reply.status(404).send({ error: 'Request not found' });
    }

    if (req.status === 'expired' || req.status === 'cancelled') {
      return reply.status(400).send({ error: 'This request is no longer active' });
    }

    const scheduledTime = new Date(req.scheduled_at).getTime();
    const now = Date.now();
    if (now < scheduledTime) {
      return reply.status(400).send({ error: 'The scheduled time has not arrived yet' });
    }
    if (now > scheduledTime + 3600000) {
      db.prepare('UPDATE watch_requests SET status = ? WHERE id = ?').run('expired', req.id);
      return reply.status(400).send({ error: 'The 1-hour window has expired' });
    }

    const isApproved = db.prepare(
      'SELECT id FROM request_responses WHERE request_id = ? AND user_id = ? AND response = ?'
    ).get(req.id, request.user.id, 'approved');

    if (!isApproved) {
      return reply.status(403).send({ error: 'You must approve this request before joining' });
    }

    const { partySockets } = require('./parties');

    let partyId = req.party_id;
    if (!partyId) {
      const { nanoid: genId } = require('nanoid');
      partyId = genId();
      const inviteCode = genId(8);

      db.prepare(
        'INSERT INTO watch_parties (id, host_user_id, media_id, episode_id, invite_code) VALUES (?, ?, ?, ?, ?)'
      ).run(partyId, req.created_by, req.media_id, req.episode_id || null, inviteCode);

      db.prepare(
        'UPDATE watch_requests SET status = ?, party_id = ? WHERE id = ?'
      ).run('active', partyId, req.id);
    }

    const existingMember = db.prepare(
      'SELECT id FROM party_members WHERE party_id = ? AND user_id = ?'
    ).get(partyId, request.user.id);

    if (!existingMember) {
      db.prepare('INSERT INTO party_members (id, party_id, user_id) VALUES (?, ?, ?)').run(nanoid(), partyId, request.user.id);
    }

    const party = db.prepare(
      `SELECT wp.*, m.title AS media_title, m.type AS media_type
       FROM watch_parties wp
       JOIN media m ON wp.media_id = m.id
       WHERE wp.id = ?`
    ).get(partyId);

    const connectedCount = partySockets.has(partyId) ? partySockets.get(partyId).size : 0;
    const quorumMet = connectedCount >= req.approved_count - 1;

    return { party, approvedCount: req.approved_count, connectedCount, quorumMet };
  });
}

module.exports = requestRoutes;

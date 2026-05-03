const { getDb } = require('../db');
const { authMiddleware } = require('../auth');
const { verifyToken } = require('../auth');
const { nanoid } = require('nanoid');

const partySockets = new Map();

function generateInviteCode() {
  return nanoid(8);
}

async function partyRoutes(fastify) {
  fastify.post('/api/parties', { preHandler: authMiddleware }, async (request, reply) => {
    const { mediaId, episodeId } = request.body || {};

    if (!mediaId) {
      return reply.status(400).send({ error: 'mediaId is required' });
    }

    const db = getDb();
    const media = db.prepare('SELECT id FROM media WHERE id = ?').get(mediaId);
    if (!media) {
      return reply.status(404).send({ error: 'Media not found' });
    }

    const partyId = nanoid();
    const inviteCode = generateInviteCode();

    db.prepare(
      'INSERT INTO watch_parties (id, host_user_id, media_id, episode_id, invite_code) VALUES (?, ?, ?, ?, ?)'
    ).run(partyId, request.user.id, mediaId, episodeId || null, inviteCode);

    db.prepare('INSERT INTO party_members (id, party_id, user_id) VALUES (?, ?, ?)').run(nanoid(), partyId, request.user.id);

    const party = db.prepare('SELECT * FROM watch_parties WHERE id = ?').get(partyId);
    return { party };
  });

  fastify.post('/api/parties/join', { preHandler: authMiddleware }, async (request, reply) => {
    const { inviteCode } = request.body || {};

    if (!inviteCode) {
      return reply.status(400).send({ error: 'inviteCode is required' });
    }

    const db = getDb();
    const party = db.prepare('SELECT * FROM watch_parties WHERE invite_code = ?').get(inviteCode);
    if (!party) {
      return reply.status(404).send({ error: 'Party not found' });
    }

    const existing = db.prepare(
      'SELECT id FROM party_members WHERE party_id = ? AND user_id = ?'
    ).get(party.id, request.user.id);

    if (!existing) {
      db.prepare('INSERT INTO party_members (id, party_id, user_id) VALUES (?, ?, ?)').run(nanoid(), party.id, request.user.id);
    }

    return { party };
  });

  fastify.get('/api/parties/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const db = getDb();
    const party = db.prepare(
      `SELECT wp.*, m.title AS media_title, m.type AS media_type, m.poster_path, e.title AS episode_title
       FROM watch_parties wp
       JOIN media m ON wp.media_id = m.id
       LEFT JOIN episodes e ON wp.episode_id = e.id
       WHERE wp.id = ?`
    ).get(request.params.id);

    if (!party) {
      return reply.status(404).send({ error: 'Party not found' });
    }

    const members = db.prepare(
      `SELECT u.id, u.display_name, u.avatar_url
       FROM party_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.party_id = ?`
    ).all(party.id);

    return { party, members };
  });

  fastify.get('/api/parties/:id/ws', { websocket: true }, (socket, request) => {
    const params = new URLSearchParams(request.url.split('?')[1] || '');
    const token = params.get('token');

    if (!token) {
      socket.close(4001, 'Missing token');
      return;
    }

    let userId;
    let partyId = request.params.id;
    try {
      const payload = verifyToken(token);
      userId = payload.sub;

      const db = getDb();
      const member = db.prepare(
        'SELECT id FROM party_members WHERE party_id = ? AND user_id = ?'
      ).get(partyId, userId);

      if (!member) {
        socket.close(4003, 'Not a member of this party');
        return;
      }

      const party = db.prepare('SELECT * FROM watch_parties WHERE id = ?').get(partyId);
      if (!party) {
        socket.close(4004, 'Party not found');
        return;
      }
    } catch {
      socket.close(4001, 'Invalid token');
      return;
    }

    if (!partySockets.has(partyId)) {
      partySockets.set(partyId, new Set());
    }
    partySockets.get(partyId).add(socket);

    socket.on('message', (rawMsg) => {
      try {
        const msg = JSON.parse(rawMsg.toString());

        if (!['play', 'pause', 'seek'].includes(msg.type)) return;

        const db = getDb();
        const position = typeof msg.position === 'number' ? msg.position : 0;

        db.prepare('UPDATE watch_parties SET position = ?, is_playing = ? WHERE id = ?').run(
          position, msg.type === 'play' ? 1 : 0, partyId
        );

        const broadcast = JSON.stringify({
          type: 'sync',
          action: msg.type,
          position,
          userId,
        });

        const sockets = partySockets.get(partyId);
        if (sockets) {
          for (const client of sockets) {
            if (client !== socket && client.readyState === 1) {
              client.send(broadcast);
            }
          }
        }
      } catch {
        // ignore malformed messages
      }
    });

    socket.on('close', () => {
      const sockets = partySockets.get(partyId);
      if (sockets) {
        sockets.delete(socket);
        if (sockets.size === 0) {
          partySockets.delete(partyId);
        }
      }
    });
  });
}

module.exports = partyRoutes;

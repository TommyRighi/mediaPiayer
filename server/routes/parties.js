const { getDb } = require('../db');
const { authMiddleware } = require('../auth');
const { verifyToken } = require('../auth');
const { nanoid } = require('nanoid');

const partySockets = new Map();
const messageRateLimits = new Map();
const MSG_LIMIT = 10;
const MSG_WINDOW = 5000;

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
      `SELECT wp.*, m.title AS media_title, m.type AS media_type, m.poster_path, m.file_path AS media_file_path,
              e.title AS episode_title, e.file_path AS episode_file_path
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

    const watchRequest = db.prepare(
      `SELECT wr.*, (SELECT COUNT(*) FROM request_responses rr WHERE rr.request_id = wr.id AND rr.response = 'approved') AS approved_count
       FROM watch_requests wr WHERE wr.party_id = ?`
    ).get(party.id);

    return { party, members, request: watchRequest || null };
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

    const db2 = getDb();
    const linkedRequest = db2.prepare(
      `SELECT wr.id, (SELECT COUNT(*) FROM request_responses rr WHERE rr.request_id = wr.id AND rr.response = 'approved') AS approved_count
       FROM watch_requests wr WHERE wr.party_id = ?`
    ).get(partyId);

    if (linkedRequest) {
      const presenceMsg = JSON.stringify({
        type: 'presence',
        connectedCount: partySockets.get(partyId).size,
        approvedCount: linkedRequest.approved_count,
      });
      const sockets = partySockets.get(partyId);
      if (sockets) {
        for (const client of sockets) {
          if (client.readyState === 1) {
            client.send(presenceMsg);
          }
        }
      }
    }

    socket.on('message', (rawMsg) => {
      try {
        const msg = JSON.parse(rawMsg.toString());

        if (['play', 'pause', 'seek'].includes(msg.type)) {
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
        } else if (msg.type === 'chat') {
          const text = typeof msg.text === 'string' ? msg.text.trim() : '';
          if (!text || text.length > 500) return;

          const now = Date.now();
          const userMsgs = (messageRateLimits.get(userId) || []).filter(t => now - t < MSG_WINDOW);
          if (userMsgs.length >= MSG_LIMIT) return;
          userMsgs.push(now);
          messageRateLimits.set(userId, userMsgs);

          const db = getDb();
          const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
          const displayName = user?.display_name || 'Unknown';

          const broadcast = JSON.stringify({
            type: 'chat',
            userId,
            displayName,
            text,
            timestamp: new Date().toISOString(),
          });

          const sockets = partySockets.get(partyId);
          if (sockets) {
            for (const client of sockets) {
              if (client !== socket && client.readyState === 1) {
                client.send(broadcast);
              }
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

      const db3 = getDb();
      const linkedReq = db3.prepare(
        `SELECT (SELECT COUNT(*) FROM request_responses rr WHERE rr.request_id = wr.id AND rr.response = 'approved') AS approved_count
         FROM watch_requests wr WHERE wr.party_id = ?`
      ).get(partyId);

      if (linkedReq) {
        const remaining = partySockets.get(partyId);
        const presenceMsg = JSON.stringify({
          type: 'presence',
          connectedCount: remaining ? remaining.size : 0,
          approvedCount: linkedReq.approved_count,
        });
        if (remaining) {
          for (const client of remaining) {
            if (client.readyState === 1) {
              client.send(presenceMsg);
            }
          }
        }
      }
    });
  });
}

module.exports = partyRoutes;
module.exports.partySockets = partySockets;

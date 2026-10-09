const { nanoid } = require('nanoid');
const { getDb } = require('../../db');
const { authMiddleware, authenticate, readAuthToken } = require('../../auth');
const { getFeatures } = require('../../features');
const { guardSocket } = require('../../socket-security');
const { publicTrack } = require('../../catalog-response');
const jamSockets = new Map();
const fail = (statusCode, message) => { throw { statusCode, message }; };
const nowPosition = (jam, now = Date.now()) => Math.max(0, jam.position + (jam.is_playing ? Math.max(0, now - jam.updated_at_ms) / 1000 : 0));

function queue(id) {
  return getDb().prepare(`SELECT q.id AS entry_id,q.added_by,q.position AS queue_position,t.*,u.display_name AS added_by_name
    FROM music_jam_queue q JOIN music_tracks t ON t.id=q.track_id LEFT JOIN users u ON u.id=q.added_by
    WHERE q.jam_id=? ORDER BY q.position,q.id`).all(id).map(publicTrack);
}
function requireJam(id, userId) {
  const db = getDb();
  const jam = db.prepare('SELECT * FROM music_jams WHERE id=? AND closed=0').get(id);
  if (!jam) fail(404, 'This Jam has ended or no longer exists.');
  if (!db.prepare('SELECT 1 FROM music_jam_members WHERE jam_id=? AND user_id=?').get(id,userId)) fail(403, 'Join this Jam first.');
  return jam;
}
function touch(jam, changes = {}) {
  const db = getDb();
  const updated = { ...jam, position: nowPosition(jam), updated_at_ms: Date.now(), ...changes };
  db.prepare('UPDATE music_jams SET current_entry_id=?,position=?,is_playing=?,updated_at_ms=?,shared_controls=?,revision=revision+1,closed=? WHERE id=?')
    .run(updated.current_entry_id,updated.position,updated.is_playing,updated.updated_at_ms,updated.shared_controls,updated.closed,jam.id);
}
function advance(jam, items, index) {
  const next = items[index + 1];
  touch(jam, { current_entry_id: next?.entry_id || jam.current_entry_id, position: next ? 0 : items[index]?.duration || nowPosition(jam), is_playing: next && !['pending','converting','failed'].includes(next.playback_status) ? 1 : 0 });
}
function pauseForPreparation(trackId) {
  const rooms = getDb().prepare('SELECT j.* FROM music_jams j JOIN music_jam_queue q ON q.id=j.current_entry_id WHERE q.track_id=? AND j.closed=0 AND j.is_playing=1').all(trackId);
  for (const jam of rooms) { touch(jam,{ is_playing:0 }); broadcast(jam.id); }
}
function settle(id) {
  let jam = getDb().prepare('SELECT * FROM music_jams WHERE id=?').get(id);
  if (!jam || jam.closed) return jam;
  const items = queue(id);
  const index = items.findIndex(item => item.entry_id === jam.current_entry_id);
  if (jam.current_entry_id && index < 0) touch(jam, { current_entry_id: items[0]?.entry_id || null, position: 0, is_playing: 0 });
  else if (jam.is_playing && items[index]?.duration > 0 && nowPosition(jam) >= items[index].duration) advance(jam, items, index);
  return getDb().prepare('SELECT * FROM music_jams WHERE id=?').get(id);
}
function snapshot(id) {
  const jam = settle(id);
  if (!jam || jam.closed) return { type: 'closed', id };
  const serverTime = Date.now();
  return { type: 'state', jam: { ...jam, position: nowPosition(jam,serverTime) }, serverTime, queue: queue(id),
    members: getDb().prepare('SELECT u.id,u.display_name FROM music_jam_members m JOIN users u ON u.id=m.user_id WHERE m.jam_id=?').all(id) };
}
function broadcast(id) {
  const payload = JSON.stringify(snapshot(id));
  for (const socket of jamSockets.get(id) || []) if (socket.readyState === 1) socket.send(payload);
}
async function jamsRoutes(fastify) {
  const prefix = '/api/music/jams';
  // A restart pauses rooms; it must not skip through music while the server was down.
  getDb().prepare('UPDATE music_jams SET is_playing=0,updated_at_ms=?,revision=revision+1 WHERE closed=0').run(Date.now());
  const hooks = [authMiddleware, async (request, reply) => {
    if (!getFeatures().socialEnabled) return reply.code(403).send({ error: 'Enable shared listening in administrator Settings first.' });
  }];
  const timer = setInterval(() => {
    for (const [id, sockets] of jamSockets) {
      for (const socket of sockets) {
        try { authenticate(socket.authToken); if (!getFeatures().socialEnabled) throw Error('disabled'); }
        catch { socket.close(4001,'Session expired or shared listening disabled'); }
      }
      broadcast(id);
    }
  }, 2000);
  timer.unref();
  fastify.addHook('onClose', async () => { clearInterval(timer); for (const sockets of jamSockets.values()) for (const socket of sockets) socket.close(1001,'Server shutting down'); jamSockets.clear(); });

  fastify.post(prefix, { preHandler: hooks }, async request => {
    const tracks = request.body?.trackIds;
    if (!Array.isArray(tracks) || !tracks.length || tracks.length > 200 || tracks.some(id => typeof id !== 'string')) fail(400,'Choose between 1 and 200 tracks.');
    const db = getDb();
    for (const id of tracks) if (!db.prepare('SELECT id FROM music_tracks WHERE id=?').get(id)) fail(404,'Track not found');
    const id = nanoid(), invite = nanoid(16), entries = tracks.map(() => nanoid());
    db.transaction(() => {
      db.prepare('INSERT INTO music_jams (id,host_user_id,invite_code,current_entry_id,updated_at_ms) VALUES (?,?,?,?,?)').run(id,request.user.id,invite,entries[0],Date.now());
      db.prepare('INSERT INTO music_jam_members VALUES (?,?)').run(id,request.user.id);
      tracks.forEach((track, index) => db.prepare('INSERT INTO music_jam_queue VALUES (?,?,?,?,?)').run(entries[index],id,track,request.user.id,index));
    })();
    return snapshot(id);
  });
  fastify.post(prefix + '/join', { preHandler: hooks }, async request => {
    const code = request.body?.code;
    if (typeof code !== 'string' || code.length > 100) fail(400,'Enter a valid invitation code.');
    const db = getDb();
    const jam = db.prepare('SELECT id FROM music_jams WHERE invite_code=? AND closed=0').get(code);
    if (!jam) fail(404,'This invitation is invalid or the Jam has ended.');
    if (db.prepare('SELECT COUNT(*) AS count FROM music_jam_members WHERE jam_id=?').get(jam.id).count >= 30 && !db.prepare('SELECT 1 FROM music_jam_members WHERE jam_id=? AND user_id=?').get(jam.id,request.user.id)) fail(409,'This Jam is full.');
    db.prepare('INSERT OR IGNORE INTO music_jam_members VALUES (?,?)').run(jam.id,request.user.id);
    broadcast(jam.id); return snapshot(jam.id);
  });
  fastify.get(prefix + '/:id', { preHandler: hooks }, async request => { requireJam(request.params.id,request.user.id); return snapshot(request.params.id); });
  fastify.post(prefix + '/:id/queue', { preHandler: hooks }, async request => {
    const jam = requireJam(request.params.id,request.user.id), db = getDb();
    const trackId = request.body?.trackId;
    if (typeof trackId !== 'string' || !db.prepare('SELECT id FROM music_tracks WHERE id=?').get(trackId)) fail(404,'Track not found');
    if (queue(jam.id).length >= 200) fail(409,'The Jam queue is full.');
    const position = db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM music_jam_queue WHERE jam_id=?').get(jam.id).n;
    const entry = nanoid();
    db.prepare('INSERT INTO music_jam_queue VALUES (?,?,?,?,?)').run(entry,jam.id,trackId,request.user.id,position);
    touch(jam, jam.current_entry_id ? {} : { current_entry_id: entry,position:0 });
    broadcast(jam.id); return snapshot(jam.id);
  });
  fastify.post(prefix + '/:id/control', { preHandler: hooks }, async request => {
    const jam = requireJam(request.params.id,request.user.id), host = jam.host_user_id === request.user.id;
    const { action, position, entryId, revision, sharedControls } = request.body || {};
    if (!host && (!jam.shared_controls || ['settings','remove','move'].includes(action))) fail(403,'Only the host can use these controls.');
    if (!Number.isInteger(revision) || revision !== jam.revision) fail(409,'The Jam changed. Try the action again.');
    const items = queue(jam.id), index = items.findIndex(t => t.entry_id === jam.current_entry_id);
    if (action === 'settings') {
      if (typeof sharedControls !== 'boolean') fail(400,'Invalid control setting');
      touch(jam,{ shared_controls: sharedControls ? 1 : 0 });
    } else if (action === 'play' || action === 'pause') {
      if (action === 'play' && ['pending','converting','failed'].includes(items[index]?.playback_status)) fail(409,'Prepare this audio before starting playback.');
      const restart = action === 'play' && items[index]?.duration > 0 && nowPosition(jam) >= items[index].duration;
      touch(jam,{ is_playing: action === 'play' && index >= 0 ? 1 : 0, ...(restart ? { position:0 } : {}) });
    }
    else if (action === 'seek') {
      if (!Number.isFinite(position) || position < 0 || position > 86400 || (items[index]?.duration > 0 && position > items[index].duration)) fail(400,'Invalid playback position');
      touch(jam,{ position });
    } else if (action === 'next' || action === 'ended') {
      if (action === 'ended' && (!host || entryId !== jam.current_entry_id || !jam.is_playing)) fail(409,'This track is no longer playing.');
      advance(jam,items,index);
    } else if (action === 'previous') {
      const previous = items[Math.max(0,index-1)];
      touch(jam,{ current_entry_id: previous?.entry_id || null, position:0, is_playing: previous && !['pending','converting','failed'].includes(previous.playback_status) ? jam.is_playing : 0 });
    }
    else if (action === 'select') {
      if (!items.some(item => item.entry_id === entryId)) fail(404,'Queue entry not found');
      if (['pending','converting','failed'].includes(items.find(item => item.entry_id === entryId).playback_status)) fail(409,'Prepare this audio before starting playback.');
      touch(jam,{ current_entry_id: entryId,position:0,is_playing:1 });
    } else if (action === 'remove' || action === 'move') {
      const target = items.find(item => item.entry_id === entryId);
      if (!target) fail(404,'Queue entry not found');
      if (action === 'remove') {
        getDb().prepare('DELETE FROM music_jam_queue WHERE id=?').run(entryId);
        const remaining = items.filter(item => item.entry_id !== entryId);
        touch(jam, entryId === jam.current_entry_id ? { current_entry_id: remaining[Math.min(index,remaining.length-1)]?.entry_id || null,position:0,is_playing:0 } : {});
      } else {
        if (!Number.isInteger(position) || position < 0 || position >= items.length) fail(400,'Invalid queue position');
        const reordered = items.filter(item => item.entry_id !== entryId); reordered.splice(position,0,target);
        getDb().transaction(() => { reordered.forEach((item,i) => getDb().prepare('UPDATE music_jam_queue SET position=? WHERE id=?').run(i,item.entry_id)); touch(jam); })();
      }
    } else fail(400,'Unknown Jam action');
    broadcast(jam.id); return snapshot(jam.id);
  });
  fastify.post(prefix + '/:id/leave', { preHandler: hooks }, async request => {
    const jam = requireJam(request.params.id,request.user.id);
    if (jam.host_user_id === request.user.id) touch(jam,{ closed:1,is_playing:0 });
    else getDb().prepare('DELETE FROM music_jam_members WHERE jam_id=? AND user_id=?').run(jam.id,request.user.id);
    broadcast(jam.id);
    for (const socket of jamSockets.get(jam.id) || []) if (jam.host_user_id === request.user.id || socket.authUserId === request.user.id) socket.close(4003,'Left Jam');
    return { success:true };
  });
  // HTTP mutations are origin checked by securityHooks; sockets carry no commands.
  fastify.get(prefix + '/:id/ws', { websocket:true }, (socket, request) => {
    try {
      if (!getFeatures().socialEnabled) throw Error('disabled');
      const token = readAuthToken(request), user = authenticate(token);
      requireJam(request.params.id,user.id);
      socket.authToken = token; socket.authUserId = user.id; socket.authSessionId = user.sessionId;
    } catch { socket.close(4001,'Join with a valid account first'); return; }
    const id = request.params.id;
    const allowMessage = guardSocket(socket, socket.authUserId, `jam:${id}`);
    if (!allowMessage) return;
    if (!jamSockets.has(id)) jamSockets.set(id,new Set());
    const sockets = jamSockets.get(id); sockets.add(socket);
    socket.send(JSON.stringify(snapshot(id)));
    socket.on('message', data => {
      if (!allowMessage(data)) return;
      // Only bounded clock pings are accepted; state changes use the authenticated API.
      if (data.length > 1024) { socket.close(1009,'Message too large'); return; }
      try { const msg=JSON.parse(data.toString()); if (msg.type==='ping' && Number.isFinite(msg.sentAt)) socket.send(JSON.stringify({ type:'pong',sentAt:msg.sentAt,serverTime:Date.now() })); } catch { /* Ignore malformed pings. */ }
    });
    socket.on('close', () => { sockets.delete(socket); if (!sockets.size) jamSockets.delete(id); });
  });
}
module.exports = jamsRoutes;
module.exports.jamSockets = jamSockets;
module.exports.snapshot = snapshot;
module.exports.nowPosition = nowPosition;
module.exports.pauseForPreparation = pauseForPreparation;

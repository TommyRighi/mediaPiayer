const MAX_PAYLOAD = 4096;
const websocketOptions = { options: { maxPayload: MAX_PAYLOAD } };
const accounts = new Map();
const rooms = new Map();
const sockets = new Set();

function closeSocket(socket, code, reason) {
  socket.close(code, reason);
  const timer = setTimeout(() => socket.terminate(), 1000);
  timer.unref();
  socket.once('close', () => clearTimeout(timer));
}

function guardSocket(socket, userId, roomId) {
  const account = accounts.get(userId) || { sockets: new Set(), messages: [] };
  const room = rooms.get(roomId) || new Set();
  if (account.sockets.size >= 4 || room.size >= 64 || sockets.size >= 256) {
    closeSocket(socket, 1008, 'Connection limit reached');
    return null;
  }
  accounts.set(userId, account); rooms.set(roomId, room);
  account.sockets.add(socket); room.add(socket); sockets.add(socket);
  socket.on('error', () => {});
  socket.once('close', () => {
    account.sockets.delete(socket); room.delete(socket); sockets.delete(socket);
    if (!account.sockets.size) accounts.delete(userId);
    if (!room.size) rooms.delete(roomId);
  });
  return data => {
    if (socket.readyState !== 1) return false;
    if (!require('./features').getFeatures().socialEnabled) {
      closeSocket(socket, 4003, 'Shared listening and watching disabled');
      return false;
    }
    try { require('./auth').authenticate(socket.authToken); }
    catch { closeSocket(socket, 4001, 'Session revoked'); return false; }
    if (data.length > MAX_PAYLOAD) {
      closeSocket(socket, 1009, 'Message too large');
      return false;
    }
    const now = Date.now();
    account.messages = account.messages.filter(time => now - time < 5000);
    if (account.messages.length >= 30) {
      closeSocket(socket, 1008, 'Message rate limit reached');
      return false;
    }
    account.messages.push(now);
    return true;
  };
}

function closeSocialSockets() {
  for (const socket of sockets) closeSocket(socket, 4003, 'Shared listening and watching disabled');
}

module.exports = { websocketOptions, guardSocket, closeSocialSockets, closeSocket };

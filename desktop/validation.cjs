const { URL } = require('node:url');
function validateTarget(value) {
  if (typeof value !== 'string' || value.length > 250) throw new Error('Inserisci l’indirizzo HTTPS del Raspberry.');
  const u = new URL(value);
  if (u.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ts\.net$/.test(u.hostname) || u.username || u.password || u.port || !['', '/'].includes(u.pathname) || u.search || u.hash) throw new Error('Usa l’indirizzo https://dispositivo.rete.ts.net fornito dall’amministratore.');
  return u.origin;
}
function validateAuthKey(value) {
  if (typeof value !== 'string' || value.length > 256 || (value && !/^tskey-auth-[a-zA-Z0-9-]+$/.test(value))) throw new Error('La chiave di collegamento non è valida.');
  return value;
}
function validAuthURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'login.tailscale.com' && !u.username && !u.password && !u.port; } catch { return false; }
}
module.exports = { validateTarget, validateAuthKey, validAuthURL };

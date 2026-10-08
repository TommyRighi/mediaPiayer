const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediapiayer-downloads-'));
process.env.DATABASE_PATH = path.join(temp, 'test.db');
process.env.MEDIA_DIRS = temp;
process.env.TRANSMISSION_DOWNLOAD_DIR = temp;
process.env.TRANSMISSION_URL = 'http://chief:secret@127.0.0.1:9091/transmission/rpc';
process.env.JWT_SECRET = 'download-tests-secret-longer-than-thirty-two-characters';
process.env.ENABLE_DOWNLOADS = 'true';
const { getDb } = require('../server/db');
const db = getDb();
const { createToken } = require('../server/auth');
for (const role of ['admin','viewer']) db.prepare('INSERT INTO users(id,email,password_hash,display_name,role) VALUES(?,?,?,?,?)').run(role, `${role}@example.invalid`, 'unused', role, role);
const headers = role => ({ authorization: `Bearer ${createToken({ id: role })}` });
require('../server/utils').MEDIA_DIR = temp;
const transcode = require('../server/transcode');
let conversionCheck = async () => false;
transcode.needsTranscoding = file => conversionCheck(file);
require('../server/track-extractor').extractAndStoreAll = async () => {};
const transmission = require('../server/transmission');
const originalFetch = global.fetch;
let torrent = null;
let added = 0;
let failRemove = false;
global.fetch = async (url, options) => {
  assert.equal(new URL(url).username, '');
  assert.equal(options.headers.Authorization, `Basic ${Buffer.from('chief:secret').toString('base64')}`);
  const { method, arguments: args } = JSON.parse(options.body);
  let result = {};
  if (method === 'torrent-add') {
    added++;
    torrent = { hashString: 'a'.repeat(40), downloadDir: args['download-dir'], percentDone: 0.4, status: 6, files: [] };
    result = { 'torrent-added': torrent };
  }
  if (method === 'torrent-get') result = { torrents: torrent ? [torrent] : [] };
  if (method === 'torrent-remove') {
    if (failRemove) throw new Error('Offline');
    torrent = null;
  }
  return { ok: true, status: 200, json: async () => ({ result: 'success', arguments: result }) };
};
const app = require('fastify')();
require('../server/security').securityHooks(app);
app.register(require('../server/routes/downloads'));
app.register(require('../server/routes/media'));
after(async () => { global.fetch = originalFetch; await app.close(); db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
const magnetUri = `magnet:?xt=urn:btih:${'a'.repeat(40)}`;

test('only the administrator can start, inspect and cancel torrents', async () => {
  for (const request of [
    { method: 'POST', url: '/api/downloads', payload: { title: 'Test movie', magnetUri } },
    { url: '/api/downloads' },
    { url: '/api/media/film/download' },
    { method: 'POST', url: '/api/media/film/download', payload: { magnetUri } },
    { method: 'DELETE', url: '/api/media/film/download' },
  ]) assert.equal((await app.inject({ ...request, headers: headers('viewer') })).statusCode, 403);
  assert.equal(added, 0);
  const started = await app.inject({ method: 'POST', url: '/api/downloads', headers: headers('admin'), payload: { title: ' Test movie ', magnetUri } });
  assert.equal(started.statusCode, 201);
  const id = started.json().mediaId;
  assert.equal(db.prepare('SELECT title FROM media WHERE id=?').get(id).title, 'Test movie');
  assert.ok(torrent.downloadDir.startsWith(temp + path.sep));
  failRemove = true;
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/media/${id}/download`, headers: headers('admin') })).statusCode, 409);
  assert.equal(db.prepare('SELECT status FROM downloads WHERE media_id=?').get(id).status, 'downloading');
  failRemove = false;
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/media/${id}/download`, headers: headers('admin') })).statusCode, 200);
});

test('playback is blocked until download and import complete, including HLS', async () => {
  db.prepare('INSERT INTO media(id,title,type,file_path,download_status) VALUES(?,?,?,?,?)').run('film', 'Fixture', 'movie', path.join(temp,'old.mp4'), 'downloading');
  for (const status of ['downloading','importing']) {
    db.prepare('UPDATE media SET download_status=? WHERE id=?').run(status,'film');
    for (const suffix of ['video','hls/master.m3u8']) assert.equal((await app.inject({ url: `/api/media/film/${suffix}`, headers: headers('viewer') })).statusCode, 409);
  }
  db.prepare('UPDATE media SET download_status=?, transcode_status=? WHERE id=?').run('completed','pending','film');
  for (const suffix of ['video','hls/master.m3u8']) assert.equal((await app.inject({ url: `/api/media/film/${suffix}`, headers: headers('viewer') })).statusCode, 503);
});

test('seeding status alone never imports an incomplete torrent', async () => {
  db.prepare('UPDATE media SET download_status=NULL,transcode_status=NULL WHERE id=?').run('film');
  await transmission.addMagnet(magnetUri,'film','admin');
  assert.equal(torrent.status, 6);
  await transmission.pollDownloads();
  assert.equal(db.prepare('SELECT status FROM downloads WHERE media_id=?').get('film').status,'downloading');
  assert.equal(db.prepare('SELECT download_status FROM media WHERE id=?').get('film').download_status,'downloading');
  await transmission.cancelDownload('film');
});

test('import selection ignores unrelated, incomplete and escaping files', () => {
  fs.writeFileSync(path.join(temp,'correct.mp4'),'right');
  fs.writeFileSync(path.join(temp,'unrelated.mp4'),'much larger unrelated file');
  fs.writeFileSync(path.join(temp,'partial.mp4'),'partial file');
  const selected = transmission.findLargestVideoFile(temp, [
    { name: 'correct.mp4', length: 5, bytesCompleted: 5 },
    { name: 'partial.mp4', length: 12, bytesCompleted: 2 },
    { name: '../outside.mp4', length: 100, bytesCompleted: 100 },
  ]);
  assert.equal(selected,path.join(temp,'correct.mp4'));
  assert.equal(transmission.findLargestVideoFile(temp,[]),null);
});


test('a complete download is published only after the conversion check', async () => {
  await transmission.addMagnet(magnetUri,'film','admin');
  fs.mkdirSync(torrent.downloadDir,{ recursive: true });
  fs.writeFileSync(path.join(torrent.downloadDir,'movie.mp4'),'fixture video');
  torrent.files = [{ name: 'movie.mp4', length: 13, bytesCompleted: 13 }];
  torrent.percentDone = 1;
  let releaseCheck;
  let notifyEntered;
  const entered = new Promise(resolve => { notifyEntered = resolve; });
  conversionCheck = () => new Promise(resolve => { releaseCheck = resolve; notifyEntered(); });
  const polling = transmission.pollDownloads();
  await entered;
  assert.equal(db.prepare('SELECT download_status FROM media WHERE id=?').get('film').download_status,'importing');
  assert.equal((await app.inject({ url: '/api/media/film/video', headers: headers('viewer') })).statusCode,409);
  releaseCheck(false);
  await polling;
  const media = db.prepare('SELECT * FROM media WHERE id=?').get('film');
  assert.equal(media.download_status,'completed');
  assert.equal(media.transcode_status,null);
  assert.equal(fs.readFileSync(media.file_path,'utf8'),'fixture video');
  assert.equal(db.prepare('SELECT status FROM downloads WHERE media_id=?').get('film').status,'completed');
  assert.equal((await app.inject({ url: '/api/media/film/video', headers: headers('viewer') })).statusCode,200);
});

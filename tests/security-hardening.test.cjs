const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediapiayer-hardening-'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(temp, 'test.db'), MEDIA_DIRS: temp,
  JWT_SECRET: 'hardening-fixture-key-with-more-than-thirty-two-bytes',
  PUBLIC_ORIGIN: 'https://pi.example.ts.net', SOCIAL_ENABLED: 'true',
});
const { getDb } = require('../server/db');
const { createToken } = require('../server/auth');
const { setFeatures } = require('../server/features');
const { websocketOptions } = require('../server/socket-security');
const db = getDb();
db.prepare('INSERT INTO users(id,email,password_hash,display_name,role,history_enabled) VALUES(?,?,?,?,?,1)').run('viewer','viewer@example.invalid','unused','Viewer','viewer');
const headers = { authorization: `Bearer ${createToken({ id: 'viewer', token_version: 0 })}` };
db.prepare('INSERT INTO media(id,title,type,file_path,poster_path,backdrop_path) VALUES(?,?,?,?,?,?)').run('movie','Movie','movie',path.join(temp,'movie.mp4'),path.join(temp,'poster.jpg'),path.join(temp,'backdrop.jpg'));
db.prepare("INSERT INTO media(id,title,type) VALUES('series','Series','series')").run();
db.prepare('INSERT INTO episodes(id,series_id,season_number,episode_number,title,file_path,thumbnail_path) VALUES(?,?,1,1,?,?,?)').run('episode','series','Episode',path.join(temp,'episode.m3u8'),path.join(temp,'thumb.jpg'));
db.prepare('INSERT INTO music_albums(id,title,cover_path) VALUES(?,?,?)').run('album','Album',path.join(temp,'album.jpg'));
db.prepare('INSERT INTO music_tracks(id,album_id,title,file_path,cover_path,playback_path) VALUES(?,?,?,?,?,?)').run('track','album','Track',path.join(temp,'track.flac'),path.join(temp,'track.jpg'),path.join(temp,'prepared.mp3'));
db.prepare('INSERT INTO playlists(id,user_id,name,cover_path) VALUES(?,?,?,?)').run('playlist','viewer','Playlist',path.join(temp,'playlist.jpg'));
db.prepare('INSERT INTO playlist_tracks(id,playlist_id,track_id,position) VALUES(?,?,?,0)').run('entry','playlist','track');
db.prepare('INSERT INTO favorite_tracks(id,user_id,track_id) VALUES(?,?,?)').run('favorite','viewer','track');
db.prepare("INSERT INTO watch_progress(id,user_id,media_id,progress_seconds) VALUES('progress','viewer','movie',10)").run();
db.prepare("INSERT INTO user_watchlist(user_id,media_id) VALUES('viewer','movie')").run();
const app = require('fastify')();
require('../server/security').securityHooks(app);
app.register(require('@fastify/websocket'), websocketOptions);
for (const route of ['media','series','watch','watchlist','parties','music/index']) app.register(require('../server/routes/' + route));
const listening = app.listen({ host: '127.0.0.1', port: 0 });
after(async () => { await app.close(); db.close(); fs.rmSync(temp, { recursive: true, force: true }); });

function noPaths(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert.ok(!key.endsWith('_path'), `Unexpected private field ${key}`);
    if (typeof item === 'string') assert.ok(!item.includes(temp), 'Private directory exposed');
    noPaths(item);
  }
}
async function party() {
  const response = await app.inject({ method: 'POST', url: '/api/parties', headers, payload: { mediaId: 'movie' } });
  assert.equal(response.statusCode, 200);
  return response.json().party;
}
async function socket(t, url) {
  const origin = await listening;
  const ws = new WebSocket(origin.replace('http:', 'ws:') + url, { headers: { ...headers, origin: process.env.PUBLIC_ORIGIN } });
  await once(ws, 'open');
  t.after(async () => {
    if (ws.readyState === WebSocket.CLOSED) return;
    const closed = once(ws, 'close'); ws.terminate(); await closed;
  });
  return ws;
}

test('catalog, history, playlist and Jam responses omit server paths and retain playback metadata', async () => {
  for (const url of ['/api/media','/api/media/movie','/api/media/series','/api/series/series/episodes','/api/watch/history','/api/watchlist','/api/music/tracks','/api/music/tracks/track','/api/music/albums','/api/music/albums/album','/api/music/playlists','/api/music/playlists/playlist','/api/music/favorites','/api/music/random']) {
    const response = await app.inject({ url, headers });
    assert.equal(response.statusCode, 200, url); noPaths(response.json());
  }
  const track = (await app.inject({ url: '/api/music/tracks/track', headers })).json();
  assert.equal(track.audio_format, 'flac'); assert.equal(track.has_playback, true); assert.equal(track.has_cover, true);
  const movie = (await app.inject({ url: '/api/media/movie', headers })).json().media;
  assert.equal(movie.has_file, true); assert.equal(movie.has_poster, true); assert.equal(movie.has_backdrop, true);
  const series = (await app.inject({ url: '/api/media/series', headers })).json().media;
  assert.equal(series.seasons[1][0].hls_available, true);
  const jam = await app.inject({ method: 'POST', url: '/api/music/jams', headers, payload: { trackIds: ['track'] } });
  assert.equal(jam.statusCode, 200); noPaths(jam.json());
});

test('disabling social closes already connected party and Jam sockets immediately', { timeout: 3000 }, async t => {
  const room = await party();
  const jam = (await app.inject({ method: 'POST', url: '/api/music/jams', headers, payload: { trackIds: ['track'] } })).json();
  const partyWs = await socket(t, `/api/parties/${room.id}/ws`);
  const jamWs = await socket(t, `/api/music/jams/${jam.jam.id}/ws`);
  const partyClosed = once(partyWs, 'close'), jamClosed = once(jamWs, 'close');
  setFeatures({ socialEnabled: false });
  assert.equal((await partyClosed)[0], 4003); assert.equal((await jamClosed)[0], 4003);
  assert.equal((await app.inject({ url: `/api/parties/${room.id}`, headers })).statusCode, 403);
  setFeatures({ socialEnabled: true });
});

test('social changes outside the settings endpoint also block commands on existing sockets', { timeout: 3000 }, async t => {
  const room = await party();
  const ws = await socket(t, `/api/parties/${room.id}/ws`);
  db.prepare("UPDATE app_settings SET value='false' WHERE name='socialEnabled'").run();
  const closed = once(ws, 'close'); ws.send(JSON.stringify({ type: 'seek', position: 123 }));
  assert.equal((await closed)[0], 4003);
  assert.equal(db.prepare('SELECT position FROM watch_parties WHERE id=?').get(room.id).position, 0);
  setFeatures({ socialEnabled: true });
});

test('the WebSocket receiver rejects oversized frames before party or Jam handlers process them', { timeout: 3000 }, async t => {
  const room = await party();
  const jam = (await app.inject({ method: 'POST', url: '/api/music/jams', headers, payload: { trackIds: ['track'] } })).json();
  for (const url of [`/api/parties/${room.id}/ws`, `/api/music/jams/${jam.jam.id}/ws`]) {
    const ws = await socket(t, url); const closed = once(ws, 'close');
    ws.send('x'.repeat(8192)); assert.equal((await closed)[0], 1009);
  }
});

test('message limits are shared by an account across its sockets', { timeout: 3000 }, async t => {
  const room = await party();
  const a = await socket(t, `/api/parties/${room.id}/ws`), b = await socket(t, `/api/parties/${room.id}/ws`);
  const closed = once(a, 'close');
  const processed = new Promise(resolve => {
    const handler = data => {
      if (JSON.parse(data).position !== 29) return;
      b.off('message', handler); resolve();
    };
    b.on('message', handler);
  });
  // One socket sends all commands; the other cannot bypass the same account budget.
  for (let i = 0; i < 30; i++) a.send(JSON.stringify({ type: 'seek', position: i }));
  await processed;
  const otherClosed = once(b, 'close'); b.send(JSON.stringify({ type: 'seek', position: 999 }));
  assert.equal((await otherClosed)[0], 1008);
  a.send(JSON.stringify({ type: 'seek', position: 1000 })); assert.equal((await closed)[0], 1008);
  assert.equal(db.prepare('SELECT position FROM watch_parties WHERE id=?').get(room.id).position, 29);
});

test('connection caps apply across parties and Jams for the same account', { timeout: 3000 }, async t => {
  const room = await party();
  for (let i = 0; i < 4; i++) await socket(t, `/api/parties/${room.id}/ws`);
  const jam = (await app.inject({ method: 'POST', url: '/api/music/jams', headers, payload: { trackIds: ['track'] } })).json();
  const rejected = await socket(t, `/api/music/jams/${jam.jam.id}/ws`);
  assert.equal((await once(rejected, 'close'))[0], 1008);
});

test('example JWT secrets fail startup even when longer than 32 bytes', () => {
  for (const secret of ['', 'CHANGE_ME_to_a_long_random_hex_string', 'nextflix-dev-secret-change-in-production', 'replace-with-a-long-random-string']) {
    const result = spawnSync(process.execPath, ['-e', "require('./server/auth')"], { cwd: path.join(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: secret }, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /JWT_SECRET/);
  }
  execFileSync(process.execPath, ['-e', "require('./server/auth')"], { cwd: path.join(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production' } });
});

test('environment variants, backup databases and private keys are ignored while env templates remain trackable', () => {
  const files = ['.env.production','.env.staging','backup.sqlite','backup.sqlite3','backup.sql','secrets.pem','secrets.key','identity.p12','identity.pfx'];
  const result = execFileSync('git', ['check-ignore','--no-index','--stdin'], { cwd: path.join(__dirname, '..'), input: files.join('\n') + '\n', encoding: 'utf8' });
  assert.deepEqual(result.trim().split('\n'), files);
  for (const file of ['.env.example','deploy/mediapiayer.env.example']) assert.equal(spawnSync('git', ['check-ignore','--no-index',file], { cwd: path.join(__dirname, '..') }).status, 1);
});

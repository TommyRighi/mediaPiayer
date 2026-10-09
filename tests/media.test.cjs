const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediapiayer-test-'));
process.env.DATABASE_PATH = path.join(root, 'test.db');
process.env.MEDIA_DIRS = root;
process.env.JWT_SECRET = 'test-only-secret-never-used-in-production';
const Fastify = require('fastify');
const { getDb } = require('../server/db');
const { createToken, createMediaToken } = require('../server/auth');
const db = getDb();
const user = { id: 'test-user', email: 'test@example.invalid', token_version: 0 };
db.prepare('INSERT INTO users (id,email,password_hash,display_name,role) VALUES (?,?,?,?,?)').run(user.id, user.email, 'unused', 'Test', 'admin');
db.prepare('UPDATE users SET history_enabled = 1 WHERE id = ?').run(user.id);
const headers = { authorization: `Bearer ${createToken(user)}` };
const app = Fastify();
app.register(require('@fastify/websocket'));
app.register(require('../server/routes/auth'));
app.register(require('../server/routes/media'));
app.register(require('../server/routes/watch'));
app.register(require('../server/routes/parties'));
app.register(require('../server/routes/transcode'));
after(async () => { await app.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });

function movie(id, file = null) {
  db.prepare('INSERT INTO media (id,title,type,file_path,duration) VALUES (?,?,?,?,?)').run(id, id, 'movie', file, 120);
}

test('catalog pagination is stable and bounded, including genre search', async () => {
  for (let i = 0; i < 40; i++) movie(`catalog-${String(i).padStart(2, '0')}`);
  const first = (await app.inject({ url: '/api/media?limit=10', headers })).json();
  const second = (await app.inject({ url: '/api/media?limit=10&offset=10', headers })).json();
  assert.equal(first.media.length, 10); assert.equal(first.hasMore, true);
  assert.equal(new Set([...first.media, ...second.media].map(m => m.id)).size, 20);
  db.prepare('UPDATE media SET genre=? WHERE id=?').run('Adventure', first.media[0].id);
  const search = (await app.inject({ url: '/api/media?search=Adventure', headers })).json();
  assert.equal(search.media.length, 1);
});

test('catalog filters cover the whole library and combine with stable sorting', async () => {
  const insert = db.prepare('INSERT INTO media (id,title,type,genre,year) VALUES (?,?,?,?,?)');
  insert.run('filter-z', 'Zulu', 'movie', 'Drama, Mystery', 2020);
  insert.run('filter-a', 'alpha', 'movie', 'Drama', 2023);
  insert.run('filter-b', 'Bravo', 'movie', 'Drama', 2023);
  insert.run('filter-unknown', 'Unknown', 'movie', 'Drama', null);
  const options = (await app.inject({ url: '/api/media/filters', headers })).json();
  assert.ok(options.genres.includes('Mystery'));
  assert.deepEqual(options.years, [2023, 2020]);
  assert.equal((await app.inject({ url: '/api/media/filters' })).statusCode, 401);
  const filtered = (await app.inject({ url: '/api/media?genre=Drama&year=2023&sort=title&limit=1', headers })).json();
  assert.deepEqual(filtered.media.map(item => item.id), ['filter-a']);
  assert.equal(filtered.hasMore, true);
  const next = (await app.inject({ url: '/api/media?genre=Drama&year=2023&sort=title&limit=1&offset=1', headers })).json();
  assert.deepEqual(next.media.map(item => item.id), ['filter-b']);
  const ascending = (await app.inject({ url: '/api/media?genre=Drama&sort=year-asc', headers })).json();
  assert.deepEqual(ascending.media.map(item => item.year), [2020, 2023, 2023, null]);
  const descending = (await app.inject({ url: '/api/media?genre=Drama&sort=year-desc', headers })).json();
  assert.deepEqual(descending.media.map(item => item.year), [2023, 2023, 2020, null]);
  assert.equal((await app.inject({ url: '/api/media?sort=__proto__', headers })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/media?year=invalid', headers })).json().media.length, 0);
});

test('ready filter excludes unavailable movies and requires a playable series episode', async () => {
  movie('ready-film', path.join(root, 'ready.mp4'));
  db.prepare('UPDATE media SET file_size=100 WHERE id=?').run('ready-film');
  const insert = db.prepare('INSERT INTO media (id,title,type) VALUES (?,?,?)');
  insert.run('ready-show', 'Ready show', 'series');
  insert.run('pending-show', 'Pending show', 'series');
  const episode = db.prepare("INSERT INTO episodes (id,series_id,season_number,episode_number,title,file_path,file_size,transcode_status) VALUES (?,?,1,1,'Episode',?,100,?)");
  episode.run('ready-episode', 'ready-show', path.join(root, 'episode.mp4'), null);
  episode.run('pending-episode', 'pending-show', path.join(root, 'pending.mp4'), 'paused');
  for (const status of ['pending', 'converting', 'paused', 'failed']) {
    movie(`not-ready-${status}`, path.join(root, `${status}.mp4`));
    db.prepare('UPDATE media SET file_size=100, transcode_status=? WHERE id=?').run(status, `not-ready-${status}`);
  }
  movie('downloading-film', path.join(root, 'download.mp4'));
  db.prepare("UPDATE media SET file_size=100, download_status='downloading' WHERE id='downloading-film'").run();
  const result = (await app.inject({ url: '/api/media?ready=1&sort=title', headers })).json();
  assert.deepEqual(result.media.map(item => item.id).sort(), ['ready-film', 'ready-show']);
});

test('native HLS child requests authenticate using the media cookie', async () => {
  const dir = path.join(root, 'hls'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'master.m3u8'), '#EXTM3U\nplaylist.m3u8\n');
  fs.writeFileSync(path.join(dir, 'playlist.m3u8'), '#EXTM3U\nsegment.ts\n');
  fs.writeFileSync(path.join(dir, 'segment.ts'), 'test-segment');
  movie('hls-test', path.join(dir, 'master.m3u8'));
  const response = await app.inject({ url: '/api/auth/media-token', headers });
  const cookie = response.headers['set-cookie'].split(';')[0];
  assert.match(response.headers['set-cookie'], /HttpOnly/);
  assert.equal((await app.inject({ url: '/api/media/hls-test/hls/segment.ts' })).statusCode, 401);
  const segment = await app.inject({ url: '/api/media/hls-test/hls/segment.ts', headers: { cookie } });
  assert.equal(segment.statusCode, 200); assert.equal(segment.body, 'test-segment');
  const rejected = await app.inject({ url: '/api/media', headers: { authorization: `Bearer ${createMediaToken(user)}` } });
  assert.equal(rejected.statusCode, 401);
});

test('deleting a title with a watch request removes dependencies and files', async () => {
  const file = path.join(root, 'delete.mp4'); fs.writeFileSync(file, 'fixture'); movie('delete-test', file);
  db.prepare('INSERT INTO watch_requests (id,created_by,media_id,scheduled_at) VALUES (?,?,?,?)').run('request', user.id, 'delete-test', '2030-01-01');
  const response = await app.inject({ method: 'DELETE', url: '/api/media/delete-test', headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(fs.existsSync(file), false);
  assert.equal(db.prepare('SELECT id FROM watch_requests WHERE id=?').get('request'), undefined);
});

test('active conversion cannot be deleted', async () => {
  const file = path.join(root, 'active.mp4'); fs.writeFileSync(file, 'fixture'); movie('active-test', file);
  db.prepare('UPDATE media SET transcode_status=? WHERE id=?').run('converting', 'active-test');
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/media/active-test', headers })).statusCode, 409);
  assert.equal(fs.existsSync(file), true);
});

test('history includes the duration required for resume progress bars', async () => {
  db.prepare('UPDATE users SET history_enabled=1 WHERE id=?').run(user.id);
  await app.inject({ method: 'POST', url: '/api/watch/progress', headers, payload: { mediaId: 'catalog-00', seconds: 60, duration: 120 } });
  const result = (await app.inject({ url: '/api/watch/history', headers })).json();
  assert.equal(result.history[0].duration, 120);
});

test('playback activity exposes a paused conversion and releases it', async () => {
  const background = require('../server/background');
  await app.inject({ method: 'POST', url: '/api/watch/activity', headers, payload: { sessionId: 'test', playing: true } });
  const result = (await app.inject({ url: '/api/transcode/status/active-test', headers })).json();
  assert.equal(result.status, 'paused'); assert.equal(result.reason, 'playback');
  await app.inject({ method: 'POST', url: '/api/watch/activity', headers, payload: { sessionId: 'test', playing: false } });
  assert.equal(background.pauseReason(), null);
});

test('revoked and media-purpose tokens cannot connect to a party socket', async () => {
  const party = (await app.inject({ method: 'POST', url: '/api/parties', headers, payload: { mediaId: 'catalog-00' } })).json().party;
  for (const token of [createMediaToken(user), createToken({ ...user, token_version: 99 })]) {
    const client = await app.injectWS(`/api/parties/${party.id}/ws?token=${token}`);
    const code = await new Promise(resolve => client.on('close', resolve));
    assert.equal(code, 4001);
  }
});

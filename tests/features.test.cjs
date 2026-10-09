const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediapiayer-features-'));
process.env.DATABASE_PATH = path.join(temp, 'test.db');
process.env.MEDIA_DIRS = temp;
process.env.JWT_SECRET = 'test-feature-secret-longer-than-thirty-two-characters';
process.env.SOCIAL_ENABLED = 'false';
process.env.ENABLE_DOWNLOADS = 'false';
const { getDb } = require('../server/db');
const { getFeatures } = require('../server/features');
const { createToken } = require('../server/auth');
const db = getDb();
for (const role of ['admin', 'viewer']) db.prepare('INSERT INTO users(id,email,password_hash,display_name,role) VALUES(?,?,?,?,?)').run(role, `${role}@example.invalid`, 'unused', role, role);
const headers = role => ({ authorization: `Bearer ${createToken({ id: role, token_version: 0 })}` });
const app = require('fastify')();
require('../server/security').securityHooks(app);
app.register(require('@fastify/multipart'));
app.register(require('../server/routes/music/index'));
app.register(require('../server/routes/watchlist'));
app.register(require('../server/routes/upload'));
app.register(require('../server/routes/admin'));
app.register(require('../server/routes/auth'));
app.register(require('../server/routes/requests'));
after(async () => { await app.close(); db.close(); fs.rmSync(temp, { recursive: true, force: true }); });

test('feature settings require admin, persist and control calendar access', async () => {
  assert.deepEqual(getFeatures(), { socialEnabled: false, downloadsEnabled: false });
  assert.equal((await app.inject({ url: '/api/requests', headers: headers('viewer') })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: headers('viewer'), payload: { socialEnabled: true } })).statusCode, 403);
  for (const payload of [{ socialEnabled: 'true' }, { arbitrary: true }, {}, []]) {
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: headers('admin'), payload })).statusCode, 400);
  }
  const saved = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: headers('admin'), payload: { socialEnabled: true } });
  assert.equal(saved.statusCode, 200);
  assert.equal(db.prepare('SELECT value FROM app_settings WHERE name=?').get('socialEnabled').value, 'true');
  assert.equal((await app.inject({ url: '/api/auth/config' })).json().socialEnabled, true);
  assert.equal((await app.inject({ url: '/api/requests', headers: headers('viewer') })).statusCode, 200);
  db.prepare('INSERT INTO media(id,title,type) VALUES(?,?,?)').run('film', 'Fixture film', 'movie');
  const created = await app.inject({ method: 'POST', url: '/api/requests', headers: headers('viewer'), payload: { mediaId: 'film', scheduledAt: new Date(Date.now() + 3600000).toISOString() } });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().request.media_title, 'Fixture film');
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/requests/${created.json().request.id}`, headers: headers('viewer') })).statusCode, 200);
  await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: headers('admin'), payload: { socialEnabled: false } });
  assert.equal((await app.inject({ url: '/api/requests', headers: headers('viewer') })).statusCode, 403);
});

test('music administration uploads duplicate filenames safely and reorders a personal playlist', async () => {
  const albumResult = await app.inject({ method: 'POST', url: '/api/music/albums', headers: headers('admin'), payload: { title: 'Fixture album' } });
  assert.equal(albumResult.statusCode, 200);
  const album = albumResult.json();
  const upload = async content => {
    const boundary = 'feature-upload-boundary';
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="album_id"\r\n\r\n${album.id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="same.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n${content}\r\n--${boundary}--\r\n`;
    const response = await app.inject({ method: 'POST', url: '/api/music/tracks/upload', headers: { ...headers('admin'), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    assert.equal(response.statusCode, 200);
    return response.json();
  };
  const first = await upload('first fixture audio');
  const second = await upload('second fixture audio');
  const firstPath = db.prepare('SELECT file_path FROM music_tracks WHERE id=?').get(first.id).file_path;
  const secondPath = db.prepare('SELECT file_path FROM music_tracks WHERE id=?').get(second.id).file_path;
  assert.notEqual(firstPath, secondPath);
  assert.equal(first.file_path, undefined);
  assert.equal(second.file_path, undefined);
  assert.equal(fs.readFileSync(firstPath, 'utf8'), 'first fixture audio');
  assert.equal(fs.readFileSync(secondPath, 'utf8'), 'second fixture audio');
  const edited = await app.inject({ method: 'PATCH', url: `/api/music/tracks/${first.id}`, headers: headers('admin'), payload: { title: 'Edited fixture', artist: 'Fixture artist', track_number: 1 } });
  assert.equal(edited.json().title, 'Edited fixture');
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/music/tracks/${first.id}`, headers: headers('viewer'), payload: { title: 'Forbidden' } })).statusCode, 403);
  const playlist = (await app.inject({ method: 'POST', url: '/api/music/playlists', headers: headers('viewer'), payload: { name: 'Fixture playlist' } })).json();
  await app.inject({ method: 'POST', url: `/api/music/playlists/${playlist.id}/tracks`, headers: headers('viewer'), payload: { track_ids: [first.id, second.id] } });
  const reordered = await app.inject({ method: 'POST', url: `/api/music/playlists/${playlist.id}/reorder`, headers: headers('viewer'), payload: { track_ids: [second.id, first.id] } });
  assert.equal(reordered.statusCode, 200);
  const result = (await app.inject({ url: `/api/music/playlists/${playlist.id}`, headers: headers('viewer') })).json();
  assert.deepEqual(result.tracks.map(track => track.id), [second.id, first.id]);
});

test('watchlists stay personal, adding is idempotent and deleted titles are removed', async () => {
  const add = () => app.inject({ method: 'PUT', url: '/api/watchlist/film', headers: headers('viewer') });
  assert.equal((await add()).statusCode, 200);
  assert.equal((await add()).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/watchlist', headers: headers('viewer') })).json().media.length, 1);
  assert.equal((await app.inject({ url: '/api/watchlist', headers: headers('admin') })).json().media.length, 0);
  await app.inject({ method: 'DELETE', url: '/api/watchlist/film', headers: headers('admin') });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_watchlist').get().n, 1);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/watchlist/missing', headers: headers('viewer') })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/watchlist' })).statusCode, 401);
  await app.inject({ method: 'DELETE', url: '/api/watchlist/film', headers: headers('viewer') });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_watchlist').get().n, 0);
  db.prepare('INSERT INTO media(id,title,type) VALUES(?,?,?)').run('temporary-film', 'Deleted fixture', 'movie');
  await app.inject({ method: 'PUT', url: '/api/watchlist/temporary-film', headers: headers('viewer') });
  db.prepare('DELETE FROM media WHERE id=?').run('temporary-film');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_watchlist').get().n, 0);
});

test('cover upload requires admin and replacing it refreshes image variants', async () => {
  const sharp = require('sharp');
  const upload = async (color, role) => {
    const boundary = 'cover-fixture-boundary';
    const image = await sharp({ create: { width: 600, height: 900, channels: 3, background: color } }).png().toBuffer();
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nposter\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover.png"\r\nContent-Type: image/png\r\n\r\n`), image, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return app.inject({ method: 'POST', url: '/api/media/film/image', headers: { ...headers(role), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
  };
  assert.equal((await upload('#ff0000', 'viewer')).statusCode, 403);
  const first = await upload('#ff0000', 'admin');
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().media.poster_path, undefined);
  assert.equal(first.json().media.has_poster, true);
  const original = db.prepare('SELECT poster_path FROM media WHERE id=?').get('film').poster_path;
  const { variantPath } = require('../server/imageProcessor');
  assert.ok(fs.existsSync(variantPath(original, 'sm')));
  const second = await upload('#0000ff', 'admin');
  assert.equal(second.statusCode, 200);
  const replacement = db.prepare('SELECT poster_path FROM media WHERE id=?').get('film').poster_path;
  assert.notEqual(original, replacement);
  assert.equal(fs.existsSync(original), false);
  assert.equal(fs.existsSync(variantPath(original, 'sm')), false);
  const stats = await sharp(variantPath(replacement, 'sm')).stats();
  assert.ok(stats.channels[2].mean > 200);
  assert.ok(stats.channels[0].mean < 10);
});

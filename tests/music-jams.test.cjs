const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'mediapiayer-jams-test-'));
process.env.DATABASE_PATH = path.join(root,'test.db');
process.env.MEDIA_DIRS = root;
process.env.JWT_SECRET = 'jam-test-secret-with-more-than-thirty-two-bytes';
process.env.SOCIAL_ENABLED = 'true';
const { getDb } = require('../server/db');
const { createToken, createMediaToken, revokeSessions } = require('../server/auth');
const { setFeatures } = require('../server/features');
const db = getDb();
const tokens = {};
for (const id of ['host','guest','outsider']) {
  db.prepare('INSERT INTO users(id,email,password_hash,display_name,role) VALUES(?,?,?,?,?)').run(id,`${id}@example.invalid`,'unused',id,'viewer');
  tokens[id] = createToken({ id,token_version:0 });
}
for (const id of ['a','b','c']) {
  fs.writeFileSync(path.join(root,`${id}.mp3`),'audio-fixture');
  db.prepare('INSERT INTO music_tracks(id,title,artist,duration,file_path,file_size) VALUES(?,?,?,?,?,?)').run(id,`Song ${id}`,'Fixture artist',120,path.join(root,`${id}.mp3`),13);
}
const app = require('fastify')();
require('../server/security').securityHooks(app);
app.register(require('@fastify/websocket'));
app.register(require('../server/routes/music/index'));
const headers = id => ({ authorization:`Bearer ${tokens[id]}` });
const inject = (method,url,user='host',payload) => app.inject({ method,url,headers:headers(user),payload });
const create = async () => (await inject('POST','/api/music/jams','host',{ trackIds:['a','b'] })).json();
const control = (state,action,user='host',extra={}) => inject('POST',`/api/music/jams/${state.jam.id}/control`,user,{ action,revision:state.jam.revision,...extra });
after(async () => { await app.close(); db.close(); fs.rmSync(root,{recursive:true,force:true}); });

test('Jam invitations, membership and playback permissions are enforced', async () => {
  const state = await create();
  assert.equal(state.jam.is_playing,0);
  assert.equal((await inject('GET',`/api/music/jams/${state.jam.id}`,'outsider')).statusCode,403);
  assert.equal((await inject('POST','/api/music/jams/join','guest',{ code:'invalid' })).statusCode,404);
  assert.equal((await inject('POST','/api/music/jams/join','guest',{ code:state.jam.invite_code })).statusCode,200);
  assert.equal((await control(state,'play','guest')).statusCode,403);
  const playing = (await control(state,'play')).json();
  assert.equal(playing.jam.is_playing,1);
  const added = (await inject('POST',`/api/music/jams/${state.jam.id}/queue`,'guest',{ trackId:'c' })).json();
  assert.equal(added.queue.at(-1).id,'c');
  assert.equal((await control(playing,'pause')).statusCode,409);
  const shared = (await control(added,'settings','host',{ sharedControls:true })).json();
  const paused = (await control(shared,'pause','guest')).json();
  assert.equal(paused.jam.is_playing,0);
  assert.equal((await control(paused,'settings','guest',{ sharedControls:false })).statusCode,403);
  assert.equal((await control(paused,'seek','guest',{ position:NaN })).statusCode,400);
  const invalidOrigin = await app.inject({ method:'POST',url:`/api/music/jams/${state.jam.id}/queue`,headers:{ ...headers('guest'),origin:'https://evil.example' },payload:{ trackId:'a' } });
  assert.equal(invalidOrigin.statusCode,403);
});

test('server time supports late joins, stale ended events cannot skip twice, and queue edits retain the current song', async () => {
  let state = await create();
  state = (await control(state,'play')).json();
  db.prepare('UPDATE music_jams SET position=30,updated_at_ms=? WHERE id=?').run(Date.now()-5000,state.jam.id);
  state = (await inject('POST','/api/music/jams/join','guest',{ code:state.jam.invite_code })).json();
  assert.ok(state.jam.position >= 35 && state.jam.position < 36);
  const first = state.jam.current_entry_id;
  state = (await control(state,'move','host',{ entryId:state.queue[1].entry_id,position:0 })).json();
  assert.equal(state.jam.current_entry_id,first);
  state = (await control(state,'remove','host',{ entryId:state.queue[0].entry_id })).json();
  assert.equal(state.jam.current_entry_id,first);
  const old = state;
  state = (await control(state,'ended','host',{ entryId:first })).json();
  assert.equal(state.jam.is_playing,0);
  assert.equal((await control(old,'ended','host',{ entryId:first })).statusCode,409);
  state = (await control(state,'remove','host',{ entryId:first })).json();
  assert.equal(state.jam.current_entry_id,null);
  state = (await inject('POST',`/api/music/jams/${state.jam.id}/queue`,'guest',{ trackId:'c' })).json();
  assert.equal(state.jam.current_entry_id,state.queue[0].entry_id);
});

test('server advances known-duration tracks without a connected host and closes ended rooms', async () => {
  let state = await create();
  state = (await control(state,'play')).json();
  db.prepare('UPDATE music_jams SET position=119,updated_at_ms=? WHERE id=?').run(Date.now()-2000,state.jam.id);
  state = (await inject('GET',`/api/music/jams/${state.jam.id}`)).json();
  assert.equal(state.jam.current_entry_id,state.queue[1].entry_id);
  assert.ok(state.jam.position < 1);
  await inject('POST','/api/music/jams/join','guest',{ code:state.jam.invite_code });
  assert.equal((await inject('POST',`/api/music/jams/${state.jam.id}/leave`,'guest')).statusCode,200);
  assert.equal((await inject('GET',`/api/music/jams/${state.jam.id}`,'guest')).statusCode,403);
  assert.equal((await inject('POST',`/api/music/jams/${state.jam.id}/leave`)).statusCode,200);
  assert.equal((await inject('POST','/api/music/jams/join','guest',{ code:state.jam.invite_code })).statusCode,404);
});

test('audio preparation pauses all affected rooms and blocks playback until ready', async () => {
  let state = await create();
  state = (await control(state,'play')).json();
  db.prepare("UPDATE music_tracks SET playback_status='pending' WHERE id='a'").run();
  require('../server/routes/music/jams').pauseForPreparation('a');
  state = (await inject('GET',`/api/music/jams/${state.jam.id}`)).json();
  assert.equal(state.jam.is_playing,0);
  assert.equal((await control(state,'play')).statusCode,409);
  state = (await control(state,'next')).json();
  assert.equal(state.jam.is_playing,1);
  state = (await control(state,'previous')).json();
  assert.equal(state.jam.is_playing,0);
  assert.equal((await control(state,'select','host',{entryId:state.queue[0].entry_id})).statusCode,409);
  db.prepare("UPDATE music_tracks SET playback_status='ready' WHERE id='a'").run();
  assert.equal((await control(state,'play')).json().jam.is_playing,1);
  db.prepare("UPDATE music_tracks SET playback_status=NULL WHERE id='a'").run();
});

test('Jam sockets use account sessions, deliver shared state and close on logout', async () => {
  const state = await create();
  const ws = await app.injectWS(`/api/music/jams/${state.jam.id}/ws`,{ headers:headers('host') });
  const update = new Promise(resolve => ws.once('message',data => resolve(JSON.parse(data))));
  await control(state,'play');
  assert.equal((await update).jam.is_playing,1);
  const closed = new Promise(resolve => ws.once('close',resolve));
  revokeSessions('host');
  assert.equal(await closed,4001);
  const token = createMediaToken({ id:'guest',token_version:0 });
  const rejected = await app.injectWS(`/api/music/jams/${state.jam.id}/ws`,{ headers:{ authorization:`Bearer ${token}` } });
  assert.equal(await new Promise(resolve => rejected.once('close',resolve)),4001);
});

test('social disabling applies to Jam APIs as well as existing sockets', async () => {
  setFeatures({ socialEnabled:false });
  assert.equal((await inject('POST','/api/music/jams','guest',{ trackIds:['a'] })).statusCode,403);
  setFeatures({ socialEnabled:true });
});

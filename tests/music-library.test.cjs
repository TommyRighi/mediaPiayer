const { test,after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const ffmpegAvailable = spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status === 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(),'mediapiayer-audio-test-'));
process.env.DATABASE_PATH = path.join(root,'test.db');process.env.MEDIA_DIRS=root;process.env.JWT_SECRET='audio-test-secret-of-more-than-thirty-two-bytes';
const { getDb } = require('../server/db');
const { createToken } = require('../server/auth');
const { audioFixture } = require('./audio-fixture.cjs');
const { importAudio } = require('../server/music-library');
const db=getDb();
db.prepare('INSERT INTO users(id,email,password_hash,display_name,role) VALUES(?,?,?,?,?)').run('admin','audio@example.invalid','unused','Audio','admin');
const headers={ authorization:`Bearer ${createToken({id:'admin',token_version:0})}` };
const app=require('fastify')();app.register(require('@fastify/websocket'));app.register(require('@fastify/multipart'));app.register(require('../server/routes/music/index'));
after(async()=>{await app.close();db.close();fs.rmSync(root,{recursive:true,force:true});});

test('audio import reads real tags, duration and embedded covers and search includes artists and albums',async()=>{
  const picture=await require('sharp')({create:{width:16,height:16,channels:3,background:'#246d64'}}).png().toBuffer();
  const file=path.join(root,'untitled.wav');fs.writeFileSync(file,audioFixture({picture}));
  const { track }=await importAudio(file);
  assert.equal(track.title,'Tagged song');assert.equal(track.artist,'Tagged artist');assert.equal(track.track_number,3);assert.equal(track.duration,2);
  assert.ok(fs.existsSync(track.cover_path));
  const album=db.prepare('SELECT * FROM music_albums WHERE id=?').get(track.album_id);
  assert.equal(album.title,'Tagged album');assert.equal(album.year,2024);assert.equal(album.genre,'Jazz');
  for(const search of ['Tagged artist','Tagged album'])assert.equal((await app.inject({url:`/api/music/tracks?search=${encodeURIComponent(search)}`,headers})).json()[0].id,track.id);
  const cover=await app.inject({url:`/api/music/tracks/${track.id}/cover`,headers});assert.equal(cover.statusCode,200);assert.match(cover.headers['content-type'],/image\/jpeg/);
  assert.equal((await app.inject({url:`/api/music/tracks/${track.id}/cover`})).statusCode,401);
  const range=await app.inject({url:`/api/music/tracks/${track.id}/stream`,headers:{...headers,range:'bytes=0-9'}});assert.equal(range.statusCode,206);assert.equal(range.rawPayload.length,10);
  db.prepare('UPDATE music_tracks SET title=? WHERE id=?').run('Manually edited',track.id);
  assert.equal((await importAudio(file)).track.title,'Manually edited');
});

test('recursive music scans ignore symlinks and preparation folders and do not duplicate tracks',async()=>{
  const directory=path.join(root,'music','Artist','Album');fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'nested.wav'),audioFixture({ title:'Nested song',album:'Nested album' }));
  const hidden=path.join(root,'music','.prepared');fs.mkdirSync(hidden,{recursive:true});fs.writeFileSync(path.join(hidden,'skip.wav'),audioFixture());
  fs.symlinkSync(path.join(root,'untitled.wav'),path.join(directory,'linked.wav'));
  const { scanMusicFolder }=require('../server/routes/music/_common');
  assert.equal((await scanMusicFolder()).tracks,1);assert.equal((await scanMusicFolder()).tracks,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM music_tracks WHERE title='Nested song'").get().n,1);
});

test('audio preparation uses the shared scheduler, publishes a separate MP3 and keeps the original',async()=>{
  const background=require('../server/background'),prepare=require('../server/music-prepare');
  const originalSpawn=background.spawnBackground;
  let calls=0;
  background.spawnBackground=async(command,args)=>{
    calls++;assert.equal(command,'ffmpeg');assert.ok(args.includes('libmp3lame'));fs.writeFileSync(args.at(-1),'prepared MP3 fixture');
    const child=new EventEmitter();child.stdout={resume(){}};child.stderr={resume(){}};setImmediate(()=>child.emit('close',0));return child;
  };
  try {
    const file=path.join(root,'original.wav');const original=audioFixture();fs.writeFileSync(file,original);
    const {track}=await importAudio(file);
    prepare.queuePreparation(track.id);prepare.queuePreparation(track.id);
    const deadline=Date.now()+3000;
    let row;
    do {await new Promise(resolve=>setTimeout(resolve,10));row=db.prepare('SELECT * FROM music_tracks WHERE id=?').get(track.id);}while(row.playback_status!=='ready'&&Date.now()<deadline);
    assert.equal(row.playback_status,'ready');assert.equal(calls,1);assert.equal(fs.readFileSync(file).compare(original),0);
    const result=await app.inject({url:`/api/music/tracks/${track.id}/stream`,headers});assert.equal(result.body,'prepared MP3 fixture');assert.equal(result.headers['content-type'],'audio/mpeg');
  }finally{background.spawnBackground=originalSpawn;}
});

test('real FFmpeg prepares audio that metadata readers can decode and supports retry', {skip:!ffmpegAvailable,timeout:15000}, async()=>{
  const file=path.join(root,'real-conversion.wav');const original=audioFixture();fs.writeFileSync(file,original);
  const {track}=await importAudio(file);
  const prepare=require('../server/music-prepare');
  async function waitReady(){
    const deadline=Date.now()+5000;
    let row;
    do {await new Promise(resolve=>setTimeout(resolve,30));row=db.prepare('SELECT * FROM music_tracks WHERE id=?').get(track.id);}while(['pending','converting'].includes(row.playback_status)&&Date.now()<deadline);
    assert.equal(row.playback_status,'ready',row.playback_error);return row;
  }
  prepare.queuePreparation(track.id);
  let row=await waitReady();
  const metadata=await require('../server/music-library').readAudioMetadata(row.playback_path);
  assert.ok(metadata.duration>=2&&metadata.duration<2.5);
  assert.equal(fs.readFileSync(file).compare(original),0);
  prepare.queuePreparation(track.id,true);row=await waitReady();
  assert.equal(row.playback_status,'ready');
});

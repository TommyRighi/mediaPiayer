const fs = require('node:fs');
const path = require('node:path');
const { getDb } = require('./db');
const background = require('./background');
const { MEDIA_DIRS, isWithinAnyDir } = require('./utils');
let running = false;
let stopped = false;

function queuePreparation(id, retry = false) {
  const db = getDb();
  const track = db.prepare('SELECT * FROM music_tracks WHERE id=?').get(id);
  if (!track) throw { statusCode: 404, message: 'Track not found' };
  if (!isWithinAnyDir(track.file_path, MEDIA_DIRS) || !fs.existsSync(track.file_path)) throw { statusCode: 404, message: 'Audio file unavailable' };
  if (retry || track.playback_status !== 'ready' || !track.playback_path || !fs.existsSync(track.playback_path)) {
    const result = db.prepare("UPDATE music_tracks SET playback_status='pending',playback_error=NULL WHERE id=? AND COALESCE(playback_status,'') NOT IN ('pending','converting')").run(id);
    if (result.changes) require('./routes/music/jams').pauseForPreparation(id);
  }
  void drain();
  return db.prepare('SELECT * FROM music_tracks WHERE id=?').get(id);
}
async function drain() {
  if (running || stopped) return;
  running = true;
  try {
    while (!stopped && !background.isShuttingDown()) {
      const track = getDb().prepare("SELECT * FROM music_tracks WHERE playback_status='pending' ORDER BY created_at LIMIT 1").get();
      if (!track) break;
      let temporary;
      try {
        if (!isWithinAnyDir(track.file_path, MEDIA_DIRS)) throw new Error('Invalid audio path');
        const directory = path.join(MEDIA_DIRS[0], 'music', '.prepared');
        fs.mkdirSync(directory, { recursive: true });
        const output = path.join(directory, `${track.id}.mp3`);
        temporary = output + '.partial.mp3';
        // Shares the same resource-aware process queue as video preparation.
        const child = await background.spawnBackground('ffmpeg', ['-y','-nostdin','-i',track.file_path,'-vn','-threads','1','-c:a','libmp3lame','-b:a','192k',temporary]);
        getDb().prepare("UPDATE music_tracks SET playback_status='converting' WHERE id=?").run(track.id);
        await new Promise((resolve, reject) => {
          child.stdout.resume(); child.stderr.resume();
          child.once('error', reject);
          child.once('close', code => code === 0 ? resolve() : reject(new Error('Audio preparation failed. Check FFmpeg and retry.')));
        });
        if (stopped || background.isShuttingDown()) break;
        if (!getDb().prepare('SELECT id FROM music_tracks WHERE id=?').get(track.id)) { fs.rmSync(temporary, { force: true }); continue; }
        fs.renameSync(temporary, output);
        getDb().prepare("UPDATE music_tracks SET playback_path=?,playback_status='ready',playback_error=NULL WHERE id=?").run(output,track.id);
      } catch {
        if (temporary) fs.rmSync(temporary, { force: true });
        if (stopped || background.isShuttingDown()) break;
        getDb().prepare("UPDATE music_tracks SET playback_status='failed',playback_error=? WHERE id=?").run('Unable to prepare audio. Install a working FFmpeg and retry.',track.id);
      }
    }
  } finally { running = false; }
}
function resume() { stopped = false; getDb().prepare("UPDATE music_tracks SET playback_status='pending' WHERE playback_status='converting'").run(); void drain(); }
function stop() { stopped = true; }
module.exports = { queuePreparation, resume, stop };

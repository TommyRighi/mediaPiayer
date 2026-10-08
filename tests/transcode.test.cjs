const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

test('real ffmpeg converts a short video and audio to playable HLS manifests', { skip: !ffmpeg, timeout: 45000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediapiayer-encode-'));
  process.env.DATABASE_PATH = path.join(root, 'db.sqlite');
  process.env.MEDIA_DIRS = root;
  const input = path.join(root, 'sample.mp4');
  const generated = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=10:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', '-shortest', input], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const { getDb } = require('../server/db');
  const db = getDb();
  const background = require('../server/background');
  try {
    db.prepare('INSERT INTO media(id,type,title,file_path,transcode_status) VALUES(?,?,?,?,?)').run('encode', 'movie', 'Encode fixture', path.join(root, 'missing.mp4'), 'pending');
    const transcode = require('../server/transcode');
    const failedJob = transcode.enqueue('movie', 'encode');
    const deadline = Date.now() + 40000;
    while (['pending', 'converting'].includes(failedJob.status) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    assert.equal(failedJob.status, 'failed');
    db.prepare("UPDATE media SET file_path=?, transcode_status='pending' WHERE id=?").run(input, 'encode');
    transcode.resumePendingJobs();
    const status = () => db.prepare('SELECT transcode_status FROM media WHERE id=?').get('encode').transcode_status;
    while (['pending', 'converting'].includes(status()) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    assert.equal(status(), 'completed');
    const file = db.prepare('SELECT file_path FROM media WHERE id=?').get('encode').file_path;
    const manifest = fs.readFileSync(file, 'utf8');
    assert.match(manifest, /#EXT-X-STREAM-INF/);
    for (const line of manifest.split('\n').filter(line => line && !line.startsWith('#'))) assert.ok(fs.existsSync(path.join(path.dirname(file), line)), line);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.ok(Number(probe.stdout.trim()) > 0);
  } finally { background.shutdown(); db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

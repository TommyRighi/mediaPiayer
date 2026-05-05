const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

const jobs = new Map();
const queue = [];
let processing = false;

function getVideoCodecInfo(filePath) {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries stream=codec_name,codec_type -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8', timeout: 15000 }
    ).trim();
    const lines = output.split('\n').filter(Boolean);
    let videoCodec = 'unknown';
    let audioCodec = 'unknown';
    for (const line of lines) {
      const [codec, type] = line.split(',');
      if (type === 'video' && videoCodec === 'unknown') videoCodec = codec;
      if (type === 'audio' && audioCodec === 'unknown') audioCodec = codec;
    }
    return { videoCodec, audioCodec };
  } catch (err) {
    return { videoCodec: 'unknown', audioCodec: 'unknown' };
  }
}

function getDuration(filePath) {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8', timeout: 15000 }
    ).trim();
    const duration = parseFloat(output);
    return isNaN(duration) ? 0 : Math.round(duration);
  } catch {
    return 0;
  }
}

function needsTranscoding(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const { videoCodec, audioCodec } = getVideoCodecInfo(filePath);
  return videoCodec !== 'h264' || (audioCodec !== 'aac' && audioCodec !== 'unknown');
}

function transcodeFile(inputPath, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-max_muxing_queue_size', '1024',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args);

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (timeMatch && onProgress) {
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const seconds = parseInt(timeMatch[3], 10);
        onProgress(hours * 3600 + minutes * 60 + seconds);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

function updateJobStatus(job, dbStatus) {
  const db = getDb();
  if (job.type === 'movie') {
    db.prepare('UPDATE media SET transcode_status = ? WHERE id = ?').run(dbStatus, job.mediaId);
  } else if (job.type === 'episode') {
    db.prepare('UPDATE episodes SET transcode_status = ? WHERE id = ?').run(dbStatus, job.episodeId);
  }
}

async function processMovie(job) {
  const db = getDb();
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(job.mediaId);
  if (!media || !media.file_path) {
    job.status = 'failed';
    return;
  }

  const inputPath = media.file_path;
  const dir = path.dirname(inputPath);
  const outputPath = path.join(dir, `${job.mediaId}_h264.mp4`);

  job.inputPath = inputPath;
  job.outputPath = outputPath;
  job.duration = getDuration(inputPath);

  await transcodeFile(inputPath, outputPath, (seconds) => {
    job.progress = job.duration > 0 ? Math.min(99, Math.round((seconds / job.duration) * 100)) : 0;
  });

  const stat = fs.statSync(outputPath);

  db.prepare('UPDATE media SET file_path = ?, file_size = ?, transcode_status = ? WHERE id = ?')
    .run(outputPath, stat.size, 'completed', job.mediaId);

  try { fs.unlinkSync(inputPath); } catch {}

  job.progress = 100;
  job.status = 'completed';
}

async function processEpisode(job) {
  const db = getDb();
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(job.episodeId);
  if (!episode || !episode.file_path) {
    job.status = 'failed';
    return;
  }

  const inputPath = episode.file_path;
  const dir = path.dirname(inputPath);
  const outputPath = path.join(dir, `${job.episodeId}_h264.mp4`);

  job.inputPath = inputPath;
  job.outputPath = outputPath;
  job.duration = getDuration(inputPath);

  await transcodeFile(inputPath, outputPath, (seconds) => {
    job.progress = job.duration > 0 ? Math.min(99, Math.round((seconds / job.duration) * 100)) : 0;
  });

  const stat = fs.statSync(outputPath);

  db.prepare('UPDATE episodes SET file_path = ?, file_size = ?, transcode_status = ? WHERE id = ?')
    .run(outputPath, stat.size, 'completed', job.episodeId);

  try { fs.unlinkSync(inputPath); } catch {}

  job.progress = 100;
  job.status = 'completed';
}

async function doProcessJob(job) {
  job.status = 'converting';
  updateJobStatus(job, 'converting');

  try {
    if (job.type === 'movie') {
      await processMovie(job);
    } else if (job.type === 'episode') {
      await processEpisode(job);
    }
  } catch (err) {
    job.status = 'failed';
    updateJobStatus(job, 'failed');
    console.error(`Transcode failed for ${job.inputPath || job.mediaId || job.episodeId}:`, err.message);
    return;
  }

  const fileSize = job.type === 'movie'
    ? getDb().prepare('SELECT file_size FROM media WHERE id = ?').get(job.mediaId)?.file_size
    : getDb().prepare('SELECT file_size FROM episodes WHERE id = ?').get(job.episodeId)?.file_size;

  if (fileSize > 0) {
    jobs.delete(job.id);
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const jobId = queue.shift();
    const job = jobs.get(jobId);
    if (!job) continue;
    await doProcessJob(job);
  }

  processing = false;
}

function enqueue(type, id) {
  const existing = [...jobs.values()].find(
    j => (type === 'movie' && j.mediaId === id) || (type === 'episode' && j.episodeId === id)
  );
  if (existing) return existing;

  const job = {
    id: `${type}_${id}_${Date.now()}`,
    type,
    mediaId: type === 'movie' ? id : null,
    episodeId: type === 'episode' ? id : null,
    status: 'pending',
    progress: 0,
    inputPath: null,
    outputPath: null,
    duration: 0,
  };

  jobs.set(job.id, job);
  queue.push(job.id);
  processQueue();
  return job;
}

function getStatus(mediaId, episodeId) {
  let job;
  if (episodeId) {
    job = [...jobs.values()].find(j => j.episodeId === episodeId);
  } else {
    job = [...jobs.values()].find(j => j.mediaId === mediaId);
  }
  if (!job) return null;
  return { status: job.status, progress: job.progress };
}

function resumePendingJobs() {
  const db = getDb();

  const pendingMovies = db.prepare('SELECT id FROM media WHERE transcode_status = ? AND type = ?').all('pending', 'movie');
  for (const m of pendingMovies) {
    enqueue('movie', m.id);
  }

  const pendingEpisodes = db.prepare('SELECT id FROM episodes WHERE transcode_status = ?').all('pending');
  for (const e of pendingEpisodes) {
    enqueue('episode', e.id);
  }
}

module.exports = { needsTranscoding, getDuration, getVideoCodecInfo, enqueue, getStatus, resumePendingJobs };

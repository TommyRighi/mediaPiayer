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
    return null;
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

function getResolution(filePath) {
  try {
    const output = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8', timeout: 15000 }
    ).trim();
    const [width, height] = output.split(',').map(Number);
    return { width: width || 0, height: height || 0 };
  } catch {
    return { width: 0, height: 0 };
  }
}

const ALL_RENDITIONS = [
  { name: '480p',  width: 854,  height: 480,  videoBitrate: '800k',  maxrate: '856k',   bufsize: '1200k', audioBitrate: '96k' },
  { name: '720p',  width: 1280, height: 720,  videoBitrate: '2500k', maxrate: '2675k',  bufsize: '4000k', audioBitrate: '128k' },
  { name: '1080p', width: 1920, height: 1080, videoBitrate: '5000k', maxrate: '5350k',  bufsize: '8000k', audioBitrate: '192k' },
];

function getRenditions(sourceHeight) {
  return ALL_RENDITIONS.filter(r => sourceHeight >= r.height);
}

function needsTranscoding(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const info = getVideoCodecInfo(filePath);
  if (!info) return false;
  const { videoCodec, audioCodec } = info;
  return videoCodec !== 'h264' || (audioCodec !== 'aac' && audioCodec !== 'unknown');
}

function hasHLS(hlsDir) {
  return fs.existsSync(path.join(hlsDir, 'master.m3u8'));
}

function transcodeToHLS(inputPath, outputDir, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outputDir, { recursive: true });

    const sourceRes = getResolution(inputPath);
    const renditions = getRenditions(sourceRes.height);

    if (renditions.length === 0) {
      renditions.push({
        name: 'orig', width: sourceRes.width, height: sourceRes.height,
        videoBitrate: '1500k', maxrate: '1605k', bufsize: '2400k', audioBitrate: '128k',
      });
      renditions[0].origScale = true;
    }

    const filterParts = [];
    const mapParts = [];
    const codecParts = [];

    for (let i = 0; i < renditions.length; i++) {
      const r = renditions[i];
      if (r.origScale) {
        filterParts.push(`[0:v]copy[v${i}out]`);
      } else {
        filterParts.push(
          `[v${i}]scale=w=${r.width}:h=${r.height}:force_original_aspect_ratio=decrease,pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2[v${i}out]`
        );
      }
      mapParts.push(`[v${i}out]`, `-c:v:${i}`, 'libx264',
        `-b:v:${i}`, r.videoBitrate, `-maxrate:v:${i}`, r.maxrate, `-bufsize:v:${i}`, r.bufsize,
        '-preset', 'fast', '-crf', '23');
      mapParts.push('-map', 'a:0', `-c:a:${i}`, 'aac', `-b:a:${i}`, r.audioBitrate, '-ac', '2');
    }

    const splitCount = renditions.length;
    const splitFilter = `[0:v]split=${splitCount}${renditions.map((_, i) => `[v${i}]`).join('')}`;

    const varStreamMap = renditions.map((r, i) => `v:${i},a:${i},name:${r.name}`).join(' ');

    const args = [
      '-y',
      '-i', inputPath,
      '-filter_complex', `${splitFilter};${filterParts.join(';')}`,
      ...mapParts,
      '-f', 'hls',
      '-hls_time', '6',
      '-hls_list_size', '0',
      '-hls_playlist_type', 'vod',
      '-hls_segment_filename', path.join(outputDir, '%v', 'segment_%03d.ts'),
      '-var_stream_map', varStreamMap,
      '-master_pl_name', 'master.m3u8',
      '-max_muxing_queue_size', '1024',
      path.join(outputDir, '%v', 'playlist.m3u8'),
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

function getHlsDirForMedia(mediaId) {
  const { MEDIA_DIR } = require('./utils');
  return path.join(MEDIA_DIR, 'hls', 'movies', mediaId);
}

function getHlsDirForEpisode(episodeId) {
  const { MEDIA_DIR } = require('./utils');
  return path.join(MEDIA_DIR, 'hls', 'episodes', episodeId);
}

async function processMovie(job) {
  const db = getDb();
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(job.mediaId);
  if (!media || !media.file_path) {
    job.status = 'failed';
    return;
  }

  const inputPath = media.file_path;
  const hlsDir = getHlsDirForMedia(job.mediaId);

  job.inputPath = inputPath;
  job.outputPath = path.join(hlsDir, 'master.m3u8');
  job.duration = getDuration(inputPath);

  await transcodeToHLS(inputPath, hlsDir, (seconds) => {
    job.progress = job.duration > 0 ? Math.min(99, Math.round((seconds / job.duration) * 100)) : 0;
  });

  db.prepare('UPDATE media SET file_path = ?, file_size = ?, transcode_status = ? WHERE id = ?')
    .run(job.outputPath, 0, 'completed', job.mediaId);

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
  const hlsDir = getHlsDirForEpisode(job.episodeId);

  job.inputPath = inputPath;
  job.outputPath = path.join(hlsDir, 'master.m3u8');
  job.duration = getDuration(inputPath);

  await transcodeToHLS(inputPath, hlsDir, (seconds) => {
    job.progress = job.duration > 0 ? Math.min(99, Math.round((seconds / job.duration) * 100)) : 0;
  });

  db.prepare('UPDATE episodes SET file_path = ?, file_size = ?, transcode_status = ? WHERE id = ?')
    .run(job.outputPath, 0, 'completed', job.episodeId);

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

  jobs.delete(job.id);
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

  const stuckMovies = db.prepare(
    "SELECT id FROM media WHERE transcode_status IN ('pending', 'converting') AND type = 'movie'"
  ).all();
  for (const m of stuckMovies) {
    db.prepare("UPDATE media SET transcode_status = 'pending' WHERE id = ?").run(m.id);
    enqueue('movie', m.id);
  }

  const stuckEps = db.prepare(
    "SELECT id FROM episodes WHERE transcode_status IN ('pending', 'converting')"
  ).all();
  for (const e of stuckEps) {
    db.prepare("UPDATE episodes SET transcode_status = 'pending' WHERE id = ?").run(e.id);
    enqueue('episode', e.id);
  }
}

module.exports = { needsTranscoding, hasHLS, getHlsDirForMedia, getHlsDirForEpisode, getDuration, getVideoCodecInfo, enqueue, getStatus, resumePendingJobs };

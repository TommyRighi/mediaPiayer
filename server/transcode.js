const { spawn, execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const { probeAudioTracks, langFromCode } = require('./track-extractor');

const jobs = new Map();
const queue = [];
let processing = false;

async function getVideoCodecInfo(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_name,codec_type', '-of', 'csv=p=0', filePath
    ], { encoding: 'utf-8', timeout: 15000 });
    const output = stdout.trim();
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

async function getDuration(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath
    ], { encoding: 'utf-8', timeout: 15000 });
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? 0 : Math.round(duration);
  } catch {
    return 0;
  }
}

async function getResolution(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', filePath
    ], { encoding: 'utf-8', timeout: 15000 });
    const [width, height] = stdout.trim().split(',').map(Number);
    return { width: width || 0, height: height || 0 };
  } catch {
    return { width: 0, height: 0 };
  }
}

function verifyEncoderWorks(encoder, extraArgs = []) {
  try {
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=black:s=320x240:d=1',
      '-frames:v', '1', ...extraArgs, '-c:v', encoder, '-f', 'null', '-',
    ], { encoding: 'utf-8', timeout: 8000, stdio: ['ignore', 'ignore', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function detectHardwareEncoder() {
  try {
    const encoders = execFileSync('ffmpeg', ['-encoders'], { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (encoders.includes('h264_videotoolbox') && verifyEncoderWorks('h264_videotoolbox')) return 'h264_videotoolbox';
    if (encoders.includes('h264_nvenc') && verifyEncoderWorks('h264_nvenc')) return 'h264_nvenc';
    if (encoders.includes('h264_vaapi') && verifyEncoderWorks('h264_vaapi', ['-pix_fmt', 'yuv420p'])) return 'h264_vaapi';
    if (encoders.includes('h264_v4l2m2m') || encoders.includes('v4l2m2m')) {
      try {
        const devs = fs.readdirSync('/dev').filter(f => f.startsWith('video'));
        if (devs.length > 0 && verifyEncoderWorks('h264_v4l2m2m', ['-pix_fmt', 'yuv420p'])) {
          return 'h264_v4l2m2m';
        }
      } catch {}
    }
    if (encoders.includes('h264_omx') && verifyEncoderWorks('h264_omx')) return 'h264_omx';
  } catch {}
  return 'libx264';
}

const HW_ENCODER = detectHardwareEncoder();

// Low-resource hosts (e.g. Raspberry Pi) can't afford multiple concurrent
// software x264 encodes in one ffmpeg process — it will OOM or run far
// slower than realtime. Detect a low-power host and cap software fallback
// to a single low rendition.
function isLowResourceHost() {
  try {
    const os = require('os');
    const totalMemGB = os.totalmem() / (1024 ** 3);
    const cpuCount = os.cpus().length;
    // Memory is the real OOM signal (a Pi 3 B has 1GB). Also treat a
    // low-memory + low-core box as constrained. Deliberately NOT triggered
    // by core count alone, so a capable 4-core/large-RAM host is unaffected.
    return totalMemGB <= 2 || (totalMemGB <= 4 && cpuCount <= 4);
  } catch {
    return false;
  }
}

const LOW_RESOURCE_HOST = HW_ENCODER === 'libx264' && isLowResourceHost();

console.log(`Transcode: using encoder ${HW_ENCODER}${LOW_RESOURCE_HOST ? ' (low-resource host: capping to single rendition)' : ''}`);

const ALL_RENDITIONS = [
  { name: '480p',  width: 854,  height: 480,  videoBitrate: '1200k', maxrate: '1600k', bufsize: '2400k' },
  { name: '720p',  width: 1280, height: 720,  videoBitrate: '3000k', maxrate: '4000k', bufsize: '6000k' },
  { name: '1080p', width: 1920, height: 1080, videoBitrate: '6000k', maxrate: '8000k', bufsize: '12000k' },
];

const AUDIO_BITRATES = { stereo: '128k', surround: '192k' };

function getRenditions(sourceHeight) {
  const candidates = ALL_RENDITIONS.filter(r => sourceHeight >= r.height);
  if (HW_ENCODER === 'h264_v4l2m2m' || HW_ENCODER === 'h264_omx') {
    const capped = Math.min(sourceHeight, 720);
    return candidates.filter(r => r.height <= capped).slice(-1);
  }
  if (LOW_RESOURCE_HOST) {
    // Software encoding on a low-resource host: never run more than one
    // rendition concurrently, and prefer the lowest available quality.
    const capped = Math.min(sourceHeight, 480);
    const low = candidates.filter(r => r.height <= capped);
    return (low.length > 0 ? low : candidates).slice(0, 1);
  }
  return candidates;
}

async function needsTranscoding(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const info = await getVideoCodecInfo(filePath);
  if (!info) return false;
  const { videoCodec, audioCodec } = info;
  return videoCodec !== 'h264' || (audioCodec !== 'aac' && audioCodec !== 'unknown');
}

function hasHLS(hlsDir) {
  return fs.existsSync(path.join(hlsDir, 'master.m3u8'));
}

function buildVideoEncoderArgs(encoder, streamIdx, bitrate, maxrate, bufsize) {
  if (encoder === 'h264_videotoolbox') {
    return [
      `-c:v:${streamIdx}`, 'h264_videotoolbox',
      `-b:v:${streamIdx}`, bitrate,
      '-realtime', '1',
      '-allow_sw', '1',
    ];
  }
  if (encoder === 'h264_nvenc') {
    return [
      `-c:v:${streamIdx}`, 'h264_nvenc',
      `-b:v:${streamIdx}`, bitrate,
      `-maxrate:v:${streamIdx}`, maxrate,
      `-bufsize:v:${streamIdx}`, bufsize,
      '-preset', 'p1',
      '-rc', 'vbr',
      '-spatial-aq', '1',
      '-temporal-aq', '1',
    ];
  }
  if (encoder === 'h264_v4l2m2m') {
    return [
      `-c:v:${streamIdx}`, 'h264_v4l2m2m',
      `-b:v:${streamIdx}`, bitrate,
      '-pix_fmt', 'yuv420p',
      '-num_capture_buffers', '64',
    ];
  }
  if (encoder === 'h264_omx') {
    return [
      `-c:v:${streamIdx}`, 'h264_omx',
      `-b:v:${streamIdx}`, bitrate,
      '-profile:v', 'high',
    ];
  }
  return [
    `-c:v:${streamIdx}`, 'libx264',
    `-b:v:${streamIdx}`, bitrate,
    `-maxrate:v:${streamIdx}`, maxrate,
    `-bufsize:v:${streamIdx}`, bufsize,
    '-preset', 'veryfast',
    '-crf', '23',
    '-threads', '0',
    '-tune', 'fastdecode',
  ];
}

async function transcodeToHLS(inputPath, outputDir, mediaId, episodeId, onProgress) {
  fs.mkdirSync(outputDir, { recursive: true });

  const sourceRes = await getResolution(inputPath);
  const renditions = getRenditions(sourceRes.height);

  if (renditions.length === 0) {
    renditions.push({
      name: 'orig', width: sourceRes.width, height: sourceRes.height,
      videoBitrate: '2000k', maxrate: '2500k', bufsize: '4000k',
    });
    renditions[0].origScale = true;
  }

  const audioTracks = await probeAudioTracks(inputPath);
  const hasAudioTracks = audioTracks.length > 0;

  return new Promise((resolve, reject) => {
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
      mapParts.push('-map', `[v${i}out]`);

      const encArgs = buildVideoEncoderArgs(HW_ENCODER, i, r.videoBitrate, r.maxrate, r.bufsize);
      mapParts.push(...encArgs);
    }

    const audioGroupId = 'aac';
    for (let i = 0; i < audioTracks.length; i++) {
      const track = audioTracks[i];
      const channels = track.channels || 2;
      const bitrate = channels > 2 ? AUDIO_BITRATES.surround : AUDIO_BITRATES.stereo;
      mapParts.push('-map', `0:a:${i}`);
      mapParts.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, bitrate, '-ac', String(Math.min(channels, 6)));
    }

    const splitCount = renditions.length;
    const splitFilter = `[0:v]split=${splitCount}${renditions.map((_, i) => `[v${i}]`).join('')}`;

    const varStreamMapParts = [];
    for (let i = 0; i < renditions.length; i++) {
      varStreamMapParts.push(`v:${i},ag:${audioGroupId},name:${renditions[i].name}`);
    }
    for (let i = 0; i < audioTracks.length; i++) {
      const track = audioTracks[i];
      const lang = langFromCode(track.language);
      const defFlag = i === 0 ? ',default:1' : '';
      varStreamMapParts.push(
        `a:${i},ag:${audioGroupId},language:${lang.code},name:audio_${lang.code}${defFlag}`
      );
    }
    const varStreamMap = varStreamMapParts.join(' ');

    const args = [
      '-y',
      '-i', inputPath,
      '-filter_complex', `${splitFilter};${filterParts.join(';')}`,
      ...mapParts,
      '-f', 'hls',
      '-hls_time', '6',
      '-hls_list_size', '0',
      '-hls_playlist_type', 'vod',
      '-hls_flags', 'independent_segments',
      '-hls_segment_filename', path.join(outputDir, '%v', 'segment_%03d.ts'),
      '-var_stream_map', varStreamMap,
      '-master_pl_name', 'master.m3u8',
      '-max_muxing_queue_size', '4096',
      path.join(outputDir, '%v', 'playlist.m3u8'),
    ];

    if (hasAudioTracks) {
      args.push('-map_metadata', '-1');
    }

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
        const masterPath = path.join(outputDir, 'master.m3u8');
        if (fs.existsSync(masterPath)) {
          try {
            patchMasterPlaylist(masterPath, audioTracks);
          } catch (e) {
            console.error('Failed to patch master playlist:', e.message);
          }
        }
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

function patchMasterPlaylist(masterPath, audioTracks) {
  let content = fs.readFileSync(masterPath, 'utf-8');
  const lines = content.split('\n');

  if (audioTracks.length <= 1) return;

  for (let i = 0; i < audioTracks.length; i++) {
    const track = audioTracks[i];
    const lang = langFromCode(track.language);
    const isDefault = i === 0 ? 'YES' : 'NO';
    const channels = track.channels || 2;
    const name = track.channels > 2
      ? `${lang.label} ${channels}.1`
      : lang.label;

    const audioMediaTag = [
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",',
      `LANGUAGE="${lang.code}",`,
      `NAME="${name}",`,
      `AUTOSELECT=YES,`,
      `DEFAULT=${isDefault},`,
      `CHANNELS="${channels}",`,
      `URI="audio_${lang.code}/playlist.m3u8"`,
    ].join('');

    const insertIdx = lines.findIndex(l => l.startsWith('#EXT-X-STREAM-INF'));
    if (insertIdx >= 0) {
      lines.splice(insertIdx, 0, audioMediaTag);
    }
  }

  fs.writeFileSync(masterPath, lines.join('\n'), 'utf-8');
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
  job.duration = await getDuration(inputPath);

  await transcodeToHLS(inputPath, hlsDir, job.mediaId, null, (seconds) => {
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
  job.duration = await getDuration(inputPath);

  await transcodeToHLS(inputPath, hlsDir, null, job.episodeId, (seconds) => {
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

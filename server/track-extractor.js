const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const { nanoid } = require('nanoid');
const { LANG_MAP, MEDIA_DIRS, isWithinAnyDir } = require('./utils');

async function probeStreams(filePath) {
  try {
    const { stdout: output } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_type,codec_name,channels,channel_layout,bit_rate,sample_rate:stream_tags=language,title',
      '-of', 'json',
      filePath,
    ], { encoding: 'utf-8', timeout: 15000 });
    const data = JSON.parse(output);
    return (data.streams || []).map((s, i) => ({
      index: s.index !== undefined ? s.index : i,
      codec_type: s.codec_type,
      codec_name: s.codec_name || 'unknown',
      channels: s.channels || 0,
      channel_layout: s.channel_layout || '',
      bit_rate: s.bit_rate ? parseInt(s.bit_rate) : 0,
      sample_rate: s.sample_rate ? parseInt(s.sample_rate) : 0,
      language: (s.tags && s.tags.language) || null,
      title: (s.tags && s.tags.title) || null,
    }));
  } catch (err) {
    console.error(`probeStreams failed for ${filePath}:`, err.message);
    return [];
  }
}

async function probeAudioTracks(filePath) {
  const streams = await probeStreams(filePath);
  return streams.filter(s => s.codec_type === 'audio');
}

async function probeSubtitleStreams(filePath) {
  const streams = await probeStreams(filePath);
  return streams.filter(s => s.codec_type === 'subtitle');
}

function langFromCode(code) {
  if (!code) return { label: 'Unknown', code: 'und' };
  const key = code.toLowerCase();
  if (LANG_MAP[key]) return LANG_MAP[key];
  return { label: code.toUpperCase(), code: key };
}

function audioTrackLabel(track, index) {
  if (track.title) return track.title;
  const lang = langFromCode(track.language);
  const ch = track.channels > 0 ? ` ${track.channels}.${track.channels > 2 ? '1' : '0'}` : '';
  const codec = track.codec_name ? ` (${track.codec_name.toUpperCase()})` : '';
  if (track.language) {
    return `${lang.label}${ch}${codec}`;
  }
  return `Track ${index + 1}${ch}${codec}`;
}

function extractSubtitle(inputPath, streamIndex, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-map', `0:s:${streamIndex}`,
      '-c:s', 'srt',
      outputPath,
    ];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-200)}`));
      }
    });
    proc.on('error', reject);
  });
}

function storeAudioTrack(mediaId, episodeId, track, index) {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM audio_tracks WHERE media_id = ? AND episode_id IS ? AND track_index = ?'
  ).get(mediaId, episodeId || null, index);
  if (existing) return;

  const lang = langFromCode(track.language);
  const label = audioTrackLabel(track, index);
  const id = nanoid();

  db.prepare(
    `INSERT INTO audio_tracks (id, media_id, episode_id, track_index, codec, language, label, channels, channel_layout, bit_rate, sample_rate, title, default_flag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    mediaId,
    episodeId || null,
    index,
    track.codec_name || 'unknown',
    lang.code,
    label,
    track.channels || 0,
    track.channel_layout || '',
    track.bit_rate || 0,
    track.sample_rate || 0,
    track.title || null,
    0
  );
}

async function extractAndStoreAll(filePath, mediaId, episodeId) {
  const results = { audioTracks: 0, subtitles: 0 };

  const streams = await probeStreams(filePath);
  if (!streams.length) return results;

  const audioStreams = streams.filter(s => s.codec_type === 'audio');
  for (let i = 0; i < audioStreams.length; i++) {
    try {
      storeAudioTrack(mediaId, episodeId, audioStreams[i], i);
      results.audioTracks++;
    } catch (err) {
      console.error(`Failed to store audio track ${i} for ${mediaId}:`, err.message);
    }
  }

  const subtitleStreams = streams.filter(s => s.codec_type === 'subtitle');
  if (subtitleStreams.length > 0) {
    const db = getDb();
    const fileDir = path.dirname(filePath);
    const fileBase = path.basename(filePath, path.extname(filePath));

    for (let i = 0; i < subtitleStreams.length; i++) {
      const stream = subtitleStreams[i];
      const lang = langFromCode(stream.language);
      const trackIdx = i;
      let mappedIdx = 0;

      const audioCount = audioStreams.length;
      for (let j = 0; j < streams.length; j++) {
        if (streams[j].codec_type === 'subtitle') {
          if (j - audioCount === trackIdx) {
            break;
          }
          mappedIdx++;
        }
      }

      const subId = nanoid();
      const subExt = '.srt';
      const subFileName = `${fileBase}.${lang.code}${subExt}`;
      const subOutputPath = path.join(fileDir, subFileName);

      try {
        let useStreamIdx = mappedIdx;

        if (mappedIdx > 0) {
          const subStreamsOnly = streams.filter(s => s.codec_type === 'subtitle');
          useStreamIdx = subStreamsOnly.findIndex(s => s === stream);
          if (useStreamIdx < 0) useStreamIdx = mappedIdx;
        }

        const extractIdx = (() => {
          let count = 0;
          for (const s of streams) {
            if (s.codec_type === 'subtitle') {
              if (count === trackIdx) return s.index;
              count++;
            }
          }
          return useStreamIdx;
        })();

        if (fs.existsSync(subOutputPath)) {
          const alreadyInDb = db.prepare(
            'SELECT id FROM subtitles WHERE media_id = ? AND episode_id IS ? AND file_path = ?'
          ).get(mediaId, episodeId || null, subOutputPath);
          if (alreadyInDb) continue;
        }

        await extractSubtitle(filePath, extractIdx, subOutputPath);

        const existingSub = db.prepare(
          'SELECT id FROM subtitles WHERE media_id = ? AND episode_id IS ? AND file_path = ?'
        ).get(mediaId, episodeId || null, subOutputPath);

        if (!existingSub) {
          db.prepare(
            'INSERT INTO subtitles (id, media_id, episode_id, label, language, file_path) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(subId, mediaId, episodeId || null, lang.label, lang.code, subOutputPath);
          results.subtitles++;
        }
      } catch (err) {
        console.error(`Failed to extract subtitle stream ${i} (ffmpeg index ${extractIdx}) for ${filePath}:`, err.message);
      }
    }
  }

  return results;
}

module.exports = {
  probeStreams,
  probeAudioTracks,
  probeSubtitleStreams,
  extractSubtitle,
  extractAndStoreAll,
  storeAudioTrack,
  langFromCode,
};

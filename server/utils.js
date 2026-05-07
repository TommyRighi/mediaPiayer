const path = require('path');
const fs = require('fs');

function isWithinDir(filePath, dir) {
  const resolved = path.resolve(filePath);
  const resolvedDir = path.resolve(dir);
  return resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir;
}

function isWithinAnyDir(filePath, dirs) {
  return dirs.some(dir => isWithinDir(filePath, dir));
}

const VIDEO_MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
};

function getVideoMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_MIME_TYPES[ext] || 'video/mp4';
}

async function streamVideo(request, reply, filePath) {
  if (!isWithinAnyDir(filePath, MEDIA_DIRS)) {
    return reply.status(403).send({ error: 'Invalid file path' });
  }
  if (!fs.existsSync(filePath)) {
    return reply.status(404).send({ error: 'Video file not found on disk' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const contentType = getVideoMimeType(filePath);
  const etag = `"${stat.size}-${stat.mtimeMs}"`;
  const range = request.headers.range;

  const cacheHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
    'ETag': etag,
    'Last-Modified': stat.mtime.toUTCString(),
  };

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
      return reply.status(416).headers({ 'Content-Range': `bytes */${fileSize}` }).send({ error: 'Invalid range' });
    }
    const chunkSize = end - start + 1;

    reply.status(206).headers({
      ...cacheHeaders,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize,
    });

    return fs.createReadStream(filePath, { start, end, highWaterMark: 1024 * 1024 });
  }

  reply.headers({
    ...cacheHeaders,
    'Content-Length': fileSize,
  });

  return fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
}

const SUBTITLE_EXTENSIONS = ['.srt', '.vtt'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

const SUBTITLE_MIME_TYPES = {
  '.srt': 'text/plain',
  '.vtt': 'text/vtt',
};

const IMAGE_MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const LANG_MAP = {
  'it': { label: 'Italiano', code: 'it' },
  'ita': { label: 'Italiano', code: 'it' },
  'en': { label: 'English', code: 'en' },
  'eng': { label: 'English', code: 'en' },
  'es': { label: 'Español', code: 'es' },
  'spa': { label: 'Español', code: 'es' },
  'fr': { label: 'Français', code: 'fr' },
  'fra': { label: 'Français', code: 'fr' },
  'de': { label: 'Deutsch', code: 'de' },
  'deu': { label: 'Deutsch', code: 'de' },
  'pt': { label: 'Português', code: 'pt' },
  'por': { label: 'Português', code: 'pt' },
  'ja': { label: '日本語', code: 'ja' },
  'jpn': { label: '日本語', code: 'ja' },
  'zh': { label: '中文', code: 'zh' },
  'zho': { label: '中文', code: 'zh' },
  'ko': { label: '한국어', code: 'ko' },
  'kor': { label: '한국어', code: 'ko' },
  'ar': { label: 'العربية', code: 'ar' },
  'ara': { label: 'العربية', code: 'ar' },
  'ru': { label: 'Русский', code: 'ru' },
  'rus': { label: 'Русский', code: 'ru' },
};

function getSubtitleMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SUBTITLE_MIME_TYPES[ext] || 'text/plain';
}

function getImageMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
}

function srtToVtt(srtContent) {
  const lines = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let vtt = 'WEBVTT\n\n';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (/^\d+$/.test(line) && i + 1 < lines.length && lines[i + 1].includes('-->')) {
      const timestamp = lines[i + 1].replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      vtt += line + '\n' + timestamp + '\n';
      i += 2;
      while (i < lines.length && lines[i].trim() !== '') {
        vtt += lines[i] + '\n';
        i++;
      }
      vtt += '\n';
    } else {
      i++;
    }
  }
  return vtt;
}

function detectSubtitleLang(filename) {
  const base = path.basename(filename, path.extname(filename));
  const parts = base.split(/[._-]/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].toLowerCase();
    if (LANG_MAP[part]) return LANG_MAP[part];
  }
  return { label: 'Unknown', code: 'und' };
}

function getDiskFree(baseDir) {
  try {
    const diskusage = require('diskusage');
    return diskusage.checkSync(baseDir).available;
  } catch {
    try {
      const { execSync } = require('child_process');
      const output = execSync(`df -k "${path.resolve(baseDir)}"`, { encoding: 'utf-8' });
      const lines = output.trim().split('\n');
      const parts = lines[lines.length - 1].split(/\s+/);
      return parseInt(parts[3]) * 1024;
    } catch {
      return null;
    }
  }
}

function pickBestMediaDir(estimatedSize, subFolder) {
  const buffer = estimatedSize * 0.1;
  const needed = estimatedSize + buffer;
  for (const dir of MEDIA_DIRS) {
    const free = getDiskFree(dir);
    if (free === null || free >= needed) {
      const target = path.join(dir, subFolder);
      fs.mkdirSync(target, { recursive: true });
      return dir;
    }
  }
  const fallback = MEDIA_DIRS[0];
  const target = path.join(fallback, subFolder);
  fs.mkdirSync(target, { recursive: true });
  return fallback;
}

const MEDIA_DIR = path.join(__dirname, '..', 'media');

const MEDIA_DIRS = process.env.MEDIA_DIRS
  ? process.env.MEDIA_DIRS.split(',').map(p => path.resolve(p.trim()))
  : [MEDIA_DIR];

function setMediaDirs(dirs) {
  MEDIA_DIRS.length = 0;
  MEDIA_DIRS.push(...dirs);
  process.env.MEDIA_DIRS = dirs.join(',');
}

const { IMAGE_SIZES } = require('./imageProcessor');

module.exports = {
  isWithinDir, isWithinAnyDir, getVideoMimeType, streamVideo, MEDIA_DIR, MEDIA_DIRS,
  getDiskFree, pickBestMediaDir, setMediaDirs,
  SUBTITLE_EXTENSIONS, IMAGE_EXTENSIONS,
  getSubtitleMimeType, getImageMimeType, srtToVtt,
  detectSubtitleLang, LANG_MAP,
  IMAGE_SIZES,
};
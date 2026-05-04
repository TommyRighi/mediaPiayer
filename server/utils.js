const path = require('path');
const fs = require('fs');

function isWithinDir(filePath, dir) {
  const resolved = path.resolve(filePath);
  const resolvedDir = path.resolve(dir);
  return resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir;
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
  if (!isWithinDir(filePath, MEDIA_DIR)) {
    return reply.status(403).send({ error: 'Invalid file path' });
  }
  if (!fs.existsSync(filePath)) {
    return reply.status(404).send({ error: 'Video file not found on disk' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const contentType = getVideoMimeType(filePath);
  const range = request.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
      return reply.status(416).headers({ 'Content-Range': `bytes */${fileSize}` }).send({ error: 'Invalid range' });
    }
    const chunkSize = end - start + 1;

    reply.status(206).headers({
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });

    return fs.createReadStream(filePath, { start, end });
  }

  reply.headers({
    'Content-Length': fileSize,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  });

  return fs.createReadStream(filePath);
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

const MEDIA_DIR = path.join(__dirname, '..', 'media');

module.exports = {
  isWithinDir, getVideoMimeType, streamVideo, MEDIA_DIR,
  SUBTITLE_EXTENSIONS, IMAGE_EXTENSIONS,
  getSubtitleMimeType, getImageMimeType, srtToVtt,
  detectSubtitleLang, LANG_MAP,
};
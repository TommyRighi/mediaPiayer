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

const MEDIA_DIR = path.join(__dirname, '..', 'media');

module.exports = { isWithinDir, getVideoMimeType, streamVideo, MEDIA_DIR };
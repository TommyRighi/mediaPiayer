const path = require('path');
const fs = require('fs');
const { getDb } = require('../../db');
const { MEDIA_DIRS, isWithinAnyDir } = require('../../utils');

const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.wma', '.opus'];
const AUDIO_MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.opus': 'audio/opus',
};

function getAudioMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return AUDIO_MIME_TYPES[ext] || 'audio/mpeg';
}

function streamAudio(request, reply, filePath) {
  if (!isWithinAnyDir(filePath, MEDIA_DIRS)) {
    return reply.status(403).send({ error: 'Invalid file path' });
  }
  if (!fs.existsSync(filePath)) {
    return reply.status(404).send({ error: 'Audio file not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const contentType = getAudioMimeType(filePath);
  const etag = `"${stat.size}-${stat.mtimeMs}"`;
  const range = request.headers.range;

  const cacheHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType,
    'Cache-Control': 'private, no-store',
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
    return fs.createReadStream(filePath, { start, end, highWaterMark: 64 * 1024 });
  }

  reply.headers({ ...cacheHeaders, 'Content-Length': fileSize });
  return fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
}

let scanning = null;
async function scanMusicFolder() {
  if (scanning) return scanning;
  scanning = (async () => {
    const { importAudio } = require('../../music-library');
    const results = { albums: 0, tracks: 0 };
    const before = getDb().prepare('SELECT COUNT(*) AS count FROM music_albums').get().count;
    async function walk(directory, depth = 0) {
      if (depth > 8 || !isWithinAnyDir(directory, MEDIA_DIRS)) return;
      for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(filePath, depth + 1);
        else if (entry.isFile() && AUDIO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
          const folder = path.basename(directory);
          const coverPath = ['cover.jpg','cover.png','folder.jpg','front.jpg'].map(name => path.join(directory,name)).find(file => fs.existsSync(file));
          const result = await importAudio(filePath, { albumTitle: depth > 0 && !['singles','music'].includes(folder.toLowerCase()) ? folder : null, coverPath });
          if (result.added) results.tracks++;
        }
      }
    }
    for (const baseDir of MEDIA_DIRS) {
      const directory = path.join(baseDir, 'music');
      if (fs.existsSync(directory)) await walk(directory);
    }
    results.albums = getDb().prepare('SELECT COUNT(*) AS count FROM music_albums').get().count - before;
    return results;
  })();
  try { return await scanning; } finally { scanning = null; }
}

module.exports = {
  AUDIO_EXTENSIONS,
  AUDIO_MIME_TYPES,
  getAudioMimeType,
  streamAudio,
  scanMusicFolder,
};

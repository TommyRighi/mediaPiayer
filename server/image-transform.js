const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
let queue = Promise.resolve();
// The distribution's WebP encoder executes unsupported instructions on ARMv6.
const UPLOAD_IMAGE_FORMAT = os.machine() === 'armv6l' ? 'jpeg' : 'webp';

// ARMv6 cannot run sharp's prebuilt ARMv7 binaries. Use the system ffmpeg
// for this host, while retaining sharp on the other supported architectures.
async function transformImage(input, target, options = {}) {
  const { width, height, format = 'jpeg', quality = 85, rotate = false, limitInputPixels = 20000000 } = options;
  const backend = options.backend || process.env.IMAGE_BACKEND || (os.machine() === 'armv6l' ? 'ffmpeg' : 'sharp');
  if (backend === 'sharp') {
    const sharp = require('sharp');
    if (os.totalmem() <= 2 * 1024 ** 3 || os.cpus().length <= 4) sharp.concurrency(1);
    let image = sharp(input, { limitInputPixels });
    if (rotate) image = image.rotate();
    if (width || height) image = image.resize(width, height, { fit: 'inside', withoutEnlargement: true });
    return image[format]({ quality }).toFile(target);
  }
  if (backend !== 'ffmpeg') throw new Error('Unsupported image backend');
  const work = async () => {
    let temporary;
    try {
      let source = input;
      if (Buffer.isBuffer(input)) {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mediapiayer-image-'));
        source = path.join(temporary, 'input');
        await fs.writeFile(source, input, { mode: 0o600 });
      }
      source = path.resolve(source);
      const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', source], { timeout: 20000, maxBuffer: 65536 });
      const dimensions = JSON.parse(stdout).streams?.[0];
      if (!dimensions?.width || !dimensions?.height || dimensions.width * dimensions.height > limitInputPixels) throw new Error('Invalid or oversized image');
      const args = ['-v', 'error', '-nostdin', '-y', '-threads', '1'];
      if (!rotate) args.push('-noautorotate');
      args.push('-i', source, '-frames:v', '1', '-threads', '1', '-filter_threads', '1');
      if (width || height) {
        const scale = Math.min(1, width ? width / dimensions.width : 1, height ? height / dimensions.height : 1);
        args.push('-vf', `scale=${Math.max(1, Math.round(dimensions.width * scale))}:${Math.max(1, Math.round(dimensions.height * scale))}`);
      }
      if (format === 'webp') args.push('-c:v', 'libwebp', '-quality', String(quality), '-f', 'webp');
      else if (format === 'jpeg') args.push('-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2');
      else throw new Error('Unsupported image format');
      args.push(path.resolve(target));
      await run('ffmpeg', args, { timeout: 30000, maxBuffer: 65536 });
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    }
  };
  const result = queue.then(work);
  queue = result.catch(() => {});
  return result;
}

module.exports = { transformImage, UPLOAD_IMAGE_FORMAT };

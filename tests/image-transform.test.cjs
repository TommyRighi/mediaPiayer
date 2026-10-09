const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
function fixture(width, height) {
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.alloc(width * height * 3, 80)]);
}
async function metadata(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', file]);
  return JSON.parse(stdout).streams[0];
}
const { transformImage, UPLOAD_IMAGE_FORMAT } = require('../server/image-transform');
const available = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const directory = fs.mkdtemp(path.join(os.tmpdir(), 'mediapiayer-image-test-'));
after(async () => fs.rm(await directory, { recursive: true, force: true }));

test('ARMv6 image backend creates JPEG covers from embedded image buffers', { skip: !available }, async () => {
  const input = fixture(80, 40);
  const target = path.join(await directory, 'cover.jpg');
  await transformImage(input, target, { backend: 'ffmpeg', width: 20, height: 20 });
  const result = await metadata(target);
  assert.equal(result.codec_name, 'mjpeg');
  assert.equal(result.width, 20);
  assert.equal(result.height, 10);
  await assert.rejects(transformImage(input, target, { backend: 'ffmpeg', limitInputPixels: 10 }), /oversized/);
});

test('image backend creates uploads in the host format without enlarging variants', { skip: !available }, async () => {
  const input = path.join(await directory, 'input.ppm');
  const target = path.join(await directory, UPLOAD_IMAGE_FORMAT === 'jpeg' ? 'upload.jpg' : 'upload.webp');
  await fs.writeFile(input, fixture(16, 8));
  await transformImage(input, target, { backend: 'ffmpeg', format: UPLOAD_IMAGE_FORMAT, rotate: true, width: 400 });
  const result = await metadata(target);
  assert.equal(result.codec_name, UPLOAD_IMAGE_FORMAT === 'jpeg' ? 'mjpeg' : 'webp');
  assert.equal(result.width, 16);
  assert.equal(result.height, 8);
});

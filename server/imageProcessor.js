const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Cap libvips concurrency on low-memory/low-core hosts (e.g. Raspberry Pi)
// so image processing doesn't contend with concurrent ffmpeg transcodes
// for all CPU cores at once.
if (os.totalmem() / (1024 ** 3) <= 2 || os.cpus().length <= 4) {
  sharp.concurrency(1);
}

const IMAGE_SIZES = {
  poster: {
    sm: 200,
    md: 400,
  },
  backdrop: {
    sm: 400,
    md: 800,
  },
};

const QUALITY = 85;

function variantPath(originalPath, size) {
  if (size === 'original') return originalPath;
  const dir = path.dirname(originalPath);
  const ext = path.extname(originalPath);
  const base = path.basename(originalPath, ext);
  return path.join(dir, `${base}-${size}${ext}`);
}

async function generateVariant(originalPath, size, imageType) {
  const width = IMAGE_SIZES[imageType]?.[size];
  if (!width) return null;

  const targetPath = variantPath(originalPath, size);

  if (fs.existsSync(targetPath)) return targetPath;
  if (!fs.existsSync(originalPath)) return null;

  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const originalExt = path.extname(originalPath).toLowerCase();

  try {
    if (originalExt === '.gif') {
      fs.copyFileSync(originalPath, targetPath);
      return targetPath;
    }

    await sharp(originalPath)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: QUALITY })
      .toFile(targetPath);

    return targetPath;
  } catch {
    fs.copyFileSync(originalPath, targetPath);
    return targetPath;
  }
}

async function generateAllVariants(originalPath, imageType) {
  if (!originalPath || !fs.existsSync(originalPath)) return;
  const sizes = Object.keys(IMAGE_SIZES[imageType] || {});
  for (const size of sizes) {
    await generateVariant(originalPath, size, imageType).catch(() => {});
  }
}

module.exports = { variantPath, generateVariant, generateAllVariants, IMAGE_SIZES };

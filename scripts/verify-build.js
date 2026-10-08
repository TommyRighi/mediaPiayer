const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const assets = path.join(__dirname,'../server/dist/assets');
let count = 0;
for (const file of fs.readdirSync(assets)) {
  if (!file.endsWith('.gz')) continue;
  const original = fs.readFileSync(path.join(assets,file.slice(0,-3)));
  assert.deepEqual(zlib.gunzipSync(fs.readFileSync(path.join(assets,file))),original,`${file} must match the final build`);
  assert.deepEqual(zlib.brotliDecompressSync(fs.readFileSync(path.join(assets,file.slice(0,-3)+'.br'))),original);
  count++;
}
assert.ok(count > 0,'Compressed assets are missing');
console.log(`Verified gzip and Brotli for ${count} final assets.`);

const path = require('path');

function isWithinDir(filePath, dir) {
  const resolved = path.resolve(filePath);
  const resolvedDir = path.resolve(dir);
  return resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir;
}

module.exports = { isWithinDir };
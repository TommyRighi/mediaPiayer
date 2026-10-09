// Node 20.19 adds synchronous require() support for the ESM dependencies.
function supportsNode(version) {
  const [major, minor] = version.split('.').map(Number);
  return (major === 20 && minor >= 19) || major >= 22;
}

module.exports = { supportsNode };

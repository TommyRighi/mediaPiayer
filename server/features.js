const { getDb } = require('./db');

function getFeatures() {
  const db = getDb();
  const values = Object.fromEntries(db.prepare('SELECT name, value FROM app_settings').all().map(row => [row.name, row.value]));
  return {
    socialEnabled: (values.socialEnabled ?? process.env.SOCIAL_ENABLED) === 'true',
    downloadsEnabled: (values.downloadsEnabled ?? process.env.ENABLE_DOWNLOADS) === 'true',
  };
}

function setFeatures(values) {
  const db = getDb();
  db.transaction(() => {
    const save = db.prepare('INSERT INTO app_settings (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value');
    for (const [name, value] of Object.entries(values)) save.run(name, String(value));
  })();
  if (!getFeatures().socialEnabled) require('./socket-security').closeSocialSockets();
  return getFeatures();
}

module.exports = { getFeatures, setFeatures };

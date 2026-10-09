const { test } = require('node:test');
const assert = require('node:assert/strict');

test('player preferences stay per account and survive unavailable or corrupt storage', async () => {
  const { readPlayerPreferences, savePlayerPreferences, findPreferredAudioTrack } = await import('../frontend/src/playerPreferences.js');
  const values = new Map();
  global.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    savePlayerPreferences('alice', { audioLanguage: 'ita', subtitlesEnabled: true, subtitleLanguage: 'en' });
    savePlayerPreferences('alice', { autoNext: false });
    assert.deepEqual(readPlayerPreferences('alice'), { audioLanguage: 'ita', subtitlesEnabled: true, subtitleLanguage: 'en', autoNext: false });
    assert.equal(readPlayerPreferences('bob').subtitlesEnabled, false);
    assert.equal(readPlayerPreferences('bob').autoNext, true);
    values.set('player-preferences:alice', '{broken');
    assert.equal(readPlayerPreferences('alice').autoNext, true);
    values.set('player-preferences:alice', JSON.stringify({ autoNext: 'false', subtitlesEnabled: 'true' }));
    assert.equal(readPlayerPreferences('alice').autoNext, true);
    assert.equal(readPlayerPreferences('alice').subtitlesEnabled, false);
    assert.equal(findPreferredAudioTrack([{ lang: 'eng' }, { lang: 'ITA' }], 'ita'), 1);
    assert.equal(findPreferredAudioTrack([{ lang: 'eng' }], 'ita'), -1);
    global.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
    assert.doesNotThrow(() => savePlayerPreferences('alice', { autoNext: false }));
    assert.equal(readPlayerPreferences('alice').autoNext, true);
  } finally { delete global.localStorage; }
});

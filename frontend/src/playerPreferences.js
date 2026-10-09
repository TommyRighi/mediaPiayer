const defaults = { audioLanguage: '', subtitlesEnabled: false, subtitleLanguage: 'auto', autoNext: true };

export function readPlayerPreferences(userId) {
  try {
    const value = JSON.parse(localStorage.getItem(`player-preferences:${userId}`));
    return {
      audioLanguage: typeof value?.audioLanguage === 'string' ? value.audioLanguage : defaults.audioLanguage,
      subtitleLanguage: typeof value?.subtitleLanguage === 'string' ? value.subtitleLanguage : defaults.subtitleLanguage,
      subtitlesEnabled: typeof value?.subtitlesEnabled === 'boolean' ? value.subtitlesEnabled : defaults.subtitlesEnabled,
      autoNext: typeof value?.autoNext === 'boolean' ? value.autoNext : defaults.autoNext,
    };
  } catch { return { ...defaults }; }
}

export function savePlayerPreferences(userId, changes) {
  try {
    localStorage.setItem(`player-preferences:${userId}`, JSON.stringify({ ...readPlayerPreferences(userId), ...changes }));
  } catch { /* Playback remains usable when browser storage is unavailable. */ }
}

export function findPreferredAudioTrack(tracks, language) {
  if (!language) return -1;
  const normalized = language.toLowerCase();
  return tracks.findIndex(track => (track.lang || track.language || track.name || '').toLowerCase() === normalized);
}

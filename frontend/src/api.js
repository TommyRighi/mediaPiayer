const BASE = '/api';

let mediaReady = false;
// Sessions live in HttpOnly cookies. Remove credentials left by older builds.
localStorage.removeItem('token');
localStorage.removeItem('mediaToken');

async function request(method, path, body, options = {}) {
  const headers = {};

  Object.assign(headers, options.headers);
  const opts = { method, ...options, headers };
  if (body && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data.error || 'Unable to complete the request. Please try again.');
    error.status = res.status;
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('auth-expired'));
    throw error;
  }
  return data;
}

export const api = {
  auth: {
    logout: () => request('POST', '/auth/logout'),
    config: () => request('GET', '/auth/config'),
    privacy: historyEnabled => request('PATCH', '/auth/privacy', { historyEnabled }),
    clearHistory: () => request('DELETE', '/auth/history'),
    sessions: () => request('GET', '/auth/sessions'),
    revokeAll: () => request('POST', '/auth/revoke-all'),
    revokeSession: id => request('DELETE', `/auth/sessions/${id}`),
    invite: () => request('POST', '/auth/invites'),
    register: (email, password, displayName, inviteCode) =>
      request('POST', '/auth/register', { email, password, displayName, inviteCode }),
    login: (email, password) => request('POST', '/auth/login', { email, password }),
    me: () => request('GET', '/auth/me'),
    updateProfile: (data) => request('PATCH', '/auth/profile', data),
    online: () => request('GET', '/auth/online'),
    mediaToken: () => request('GET', '/auth/media-token'),
    changePassword: (currentPassword, newPassword) =>
      request('POST', '/auth/change-password', { currentPassword, newPassword }),
  },
  media: {
    subtitleUrl: (id) => `${BASE}/subtitles/${id}`,
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request('GET', `/media${q ? '?' + q : ''}`);
    },
    get: (id, background = false) => request('GET', `/media/${id}`, null, background ? { headers: { 'X-Background-Request': '1' } } : {}),
    update: (id, data) => request('PATCH', `/media/${id}`, data),
    delete: (id) => request('DELETE', `/media/${id}`),
    videoUrl: (id) => `${BASE}/media/${id}/video`,
    episodeVideoUrl: (id) => `${BASE}/episodes/${id}/video`,
    hlsUrl: (id) => `${BASE}/media/${id}/hls/master.m3u8`,
    episodeHlsUrl: (id) => `${BASE}/episodes/${id}/hls/master.m3u8`,
    posterUrl: (id, size) => `${BASE}/media/${id}/poster${size ? '?size=' + encodeURIComponent(size) : ''}`,
    backdropUrl: (id, size) => `${BASE}/media/${id}/backdrop${size ? '?size=' + encodeURIComponent(size) : ''}`,
    subtitles: (id) => request('GET', `/media/${id}/subtitles`),
    episodeSubtitles: (id) => request('GET', `/episodes/${id}/subtitles`),
    audioTracks: (id) => request('GET', `/media/${id}/audio-tracks`),
    episodeAudioTracks: (id) => request('GET', `/episodes/${id}/audio-tracks`),
  },
  watchlist: {
    list: () => request('GET', '/watchlist'),
    add: id => request('PUT', `/watchlist/${id}`),
    remove: id => request('DELETE', `/watchlist/${id}`),
  },
  series: {
    episodes: (id) => request('GET', `/series/${id}/episodes`),
  },
  watch: {
    activity: (sessionId, playing) => request('POST', '/watch/activity', { sessionId, playing }, { keepalive: true }),
    progress: (mediaId, episodeId, seconds, completed, duration) =>
      request('POST', '/watch/progress', { mediaId, episodeId, seconds, completed, duration }, { keepalive: true }),
    history: () => request('GET', '/watch/history'),
  },
  parties: {
    create: (mediaId, episodeId) => request('POST', '/parties', { mediaId, episodeId }),
    join: (inviteCode) => request('POST', '/parties/join', { inviteCode }),
    get: (id) => request('GET', `/parties/${id}`),
  },
  requests: {
    create: (mediaId, episodeId, scheduledAt) => request('POST', '/requests', { mediaId, episodeId, scheduledAt }),
    list: () => request('GET', '/requests'),
    get: (id) => request('GET', `/requests/${id}`),
    cancel: (id) => request('DELETE', `/requests/${id}`),
    respond: (id, response) => request('POST', `/requests/${id}/respond`, { response }),
    activate: (id) => request('POST', `/requests/${id}/activate`),
  },
  admin: {
    settings: () => request('GET', '/admin/settings'),
    updateSettings: values => request('PATCH', '/admin/settings', values),
    scan: () => request('POST', '/admin/scan'),
    clean: () => request('POST', '/admin/clean'),
    getStorage: () => request('GET', '/admin/storage'),
    setStorage: (dirs) => request('POST', '/admin/storage', { dirs }),
  },
  downloads: {
    create: (title, magnetUri) => request('POST', '/downloads', { title, magnetUri }),
    start: (mediaId, magnetUri) => request('POST', `/media/${mediaId}/download`, { magnetUri }),
    status: (mediaId) => request('GET', `/media/${mediaId}/download`),
    cancel: (mediaId) => request('DELETE', `/media/${mediaId}/download`),
    list: () => request('GET', '/downloads'),
  },
  transcode: {
    status: (mediaId, episodeId) =>
      request('GET', `/transcode/status/${mediaId}${episodeId ? `?episodeId=${episodeId}` : ''}`),
  },
  music: {
    albums: {
      list: (params = {}) => {
        const q = new URLSearchParams(params).toString();
        return request('GET', `/music/albums${q ? '?' + q : ''}`);
      },
      get: (id) => request('GET', `/music/albums/${id}`),
      create: (data) => request('POST', '/music/albums', data),
      update: (id, data) => request('PATCH', `/music/albums/${id}`, data),
      delete: (id) => request('DELETE', `/music/albums/${id}`),
      coverUrl: (id) => `${BASE}/music/albums/${id}/cover`,
    },
    tracks: {
      list: (params = {}) => {
        const q = new URLSearchParams(params).toString();
        return request('GET', `/music/tracks${q ? '?' + q : ''}`);
      },
      get: (id) => request('GET', `/music/tracks/${id}`),
      streamUrl: (id) => `${BASE}/music/tracks/${id}/stream`,
      update: (id, data) => request('PATCH', `/music/tracks/${id}`, data),
      delete: (id) => request('DELETE', `/music/tracks/${id}`),
      random: (limit) => request('GET', `/music/random${limit ? '?limit=' + limit : ''}`),
    },
    playlists: {
      list: () => request('GET', '/music/playlists'),
      get: (id) => request('GET', `/music/playlists/${id}`),
      create: (data) => request('POST', '/music/playlists', data),
      update: (id, data) => request('PATCH', `/music/playlists/${id}`, data),
      delete: (id) => request('DELETE', `/music/playlists/${id}`),
      addTracks: (id, trackIds) => request('POST', `/music/playlists/${id}/tracks`, { track_ids: trackIds }),
      removeTrack: (id, trackId) => request('DELETE', `/music/playlists/${id}/tracks/${trackId}`),
      reorder: (id, trackIds) => request('POST', `/music/playlists/${id}/reorder`, { track_ids: trackIds }),
    },
    favorites: {
      list: () => request('GET', '/music/favorites'),
      add: (trackId) => request('POST', `/music/favorites/${trackId}`),
      remove: (trackId) => request('DELETE', `/music/favorites/${trackId}`),
    },
    progress: {
      save: (trackId, seconds, duration, completed) =>
        request('POST', '/music/progress', { track_id: trackId, progress_seconds: seconds, duration, completed }),
      list: () => request('GET', '/music/progress'),
    },
    youtube: {
      download: (url, title, artist) => request('POST', '/music/youtube/download', { url, title, artist }),
      status: (id) => request('GET', `/music/youtube/status/${id}`),
      downloads: () => request('GET', '/music/youtube/downloads'),
    },
    scan: () => request('POST', '/music/scan'),
  },
};

// Kept for existing player/upload callers. Cookie authentication is automatic.
export function getToken() { return null; }
export function setToken() { /* Credentials are never exposed to JavaScript. */ }
export function clearToken() { localStorage.removeItem('token'); }
export function setMediaToken() { mediaReady = true; }
export function clearMediaToken() { mediaReady = false; localStorage.removeItem('mediaToken'); }
export function hasMediaToken() { return mediaReady; }

export async function refreshMediaToken(retries = 3, delayMs = 2000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await api.auth.mediaToken();
      mediaReady = data.ready === true;
      return mediaReady;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
}

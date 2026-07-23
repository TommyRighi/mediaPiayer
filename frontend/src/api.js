const BASE = '/api';

function token() {
  return localStorage.getItem('token');
}

function getMediaToken() {
  const mt = localStorage.getItem('mediaToken');
  if (!mt) return null;
  try {
    const payload = JSON.parse(atob(mt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp * 1000 > Date.now()) return mt;
  } catch { /* ignore */ }
  localStorage.removeItem('mediaToken');
  return null;
}

// Media URLs must never fall back to the long-lived main auth token — it
// would leak a 7-day credential into the URL bar/history/logs. If no
// short-lived media token is available yet, callers get an empty string
// and playback should be blocked until refreshMediaToken() resolves.
function mediaOrMainToken() {
  return getMediaToken() || '';
}

async function request(method, path, body) {
  const headers = {};
  const t = token();
  if (t) headers['Authorization'] = `Bearer ${t}`;

  const opts = { method, headers };
  if (body && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  auth: {
    register: (email, password, displayName) =>
      request('POST', '/auth/register', { email, password, displayName }),
    login: (email, password) => request('POST', '/auth/login', { email, password }),
    me: () => request('GET', '/auth/me'),
    updateProfile: (data) => request('PATCH', '/auth/profile', data),
    online: () => request('GET', '/auth/online'),
    mediaToken: () => request('GET', '/auth/media-token'),
    changePassword: (currentPassword, newPassword) =>
      request('POST', '/auth/change-password', { currentPassword, newPassword }),
  },
  media: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request('GET', `/media${q ? '?' + q : ''}`);
    },
    get: (id) => request('GET', `/media/${id}`),
    update: (id, data) => request('PATCH', `/media/${id}`, data),
    delete: (id) => request('DELETE', `/media/${id}`),
    videoUrl: (id) => `${BASE}/media/${id}/video?token=${mediaOrMainToken()}`,
    episodeVideoUrl: (id) => `${BASE}/episodes/${id}/video?token=${mediaOrMainToken()}`,
    hlsUrl: (id) => `${BASE}/media/${id}/hls/master.m3u8?token=${mediaOrMainToken()}`,
    episodeHlsUrl: (id) => `${BASE}/episodes/${id}/hls/master.m3u8?token=${mediaOrMainToken()}`,
    posterUrl: (id, size) => `${BASE}/media/${id}/poster?${size ? 'size=' + size + '&' : ''}token=${mediaOrMainToken()}`,
    backdropUrl: (id, size) => `${BASE}/media/${id}/backdrop?${size ? 'size=' + size + '&' : ''}token=${mediaOrMainToken()}`,
    subtitles: (id) => request('GET', `/media/${id}/subtitles`),
    episodeSubtitles: (id) => request('GET', `/episodes/${id}/subtitles`),
    audioTracks: (id) => request('GET', `/media/${id}/audio-tracks`),
    episodeAudioTracks: (id) => request('GET', `/episodes/${id}/audio-tracks`),
  },
  series: {
    episodes: (id) => request('GET', `/series/${id}/episodes`),
  },
  watch: {
    progress: (mediaId, episodeId, seconds, completed, duration) =>
      request('POST', '/watch/progress', { mediaId, episodeId, seconds, completed, duration }),
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
    scan: () => request('POST', '/admin/scan'),
    clean: () => request('POST', '/admin/clean'),
    getStorage: () => request('GET', '/admin/storage'),
    setStorage: (dirs) => request('POST', '/admin/storage', { dirs }),
  },
  downloads: {
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
      coverUrl: (id) => `${BASE}/music/albums/${id}/cover?token=${mediaOrMainToken()}`,
    },
    tracks: {
      list: (params = {}) => {
        const q = new URLSearchParams(params).toString();
        return request('GET', `/music/tracks${q ? '?' + q : ''}`);
      },
      get: (id) => request('GET', `/music/tracks/${id}`),
      streamUrl: (id) => `${BASE}/music/tracks/${id}/stream?token=${mediaOrMainToken()}`,
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

export function getToken() {
  return token();
}

export function setToken(t) {
  localStorage.setItem('token', t);
}

export function clearToken() {
  localStorage.removeItem('token');
}

export function setMediaToken(t) {
  localStorage.setItem('mediaToken', t);
}

export function clearMediaToken() {
  localStorage.removeItem('mediaToken');
}

export function hasMediaToken() {
  return !!getMediaToken();
}

export async function refreshMediaToken(retries = 3, delayMs = 2000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await api.auth.mediaToken();
      setMediaToken(data.mediaToken);
      return data.mediaToken;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
}
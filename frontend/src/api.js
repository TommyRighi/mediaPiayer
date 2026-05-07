const BASE = '/api';

function token() {
  return localStorage.getItem('token');
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
  },
  media: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request('GET', `/media${q ? '?' + q : ''}`);
    },
    get: (id) => request('GET', `/media/${id}`),
    update: (id, data) => request('PATCH', `/media/${id}`, data),
    delete: (id) => request('DELETE', `/media/${id}`),
    videoUrl: (id) => `${BASE}/media/${id}/video`,
    episodeVideoUrl: (id) => `${BASE}/episodes/${id}/video`,
    posterUrl: (id, size) => `${BASE}/media/${id}/poster${size ? '?size=' + size : ''}`,
    backdropUrl: (id, size) => `${BASE}/media/${id}/backdrop${size ? '?size=' + size : ''}`,
    subtitles: (id) => request('GET', `/media/${id}/subtitles`),
    episodeSubtitles: (id) => request('GET', `/episodes/${id}/subtitles`),
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
  admin: {
    scan: () => request('POST', '/admin/scan'),
    getStorage: () => request('GET', '/admin/storage'),
    setStorage: (dirs) => request('POST', '/admin/storage', { dirs }),
  },
  transcode: {
    status: (mediaId, episodeId) =>
      request('GET', `/transcode/status/${mediaId}${episodeId ? `?episodeId=${episodeId}` : ''}`),
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

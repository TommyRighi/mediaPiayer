import { createContext, useContext, useState, useEffect } from 'react';
import { api, clearToken, clearMediaToken, refreshMediaToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [features, setFeatures] = useState({ socialEnabled: false, downloadsEnabled: false });
  const { socialEnabled, downloadsEnabled } = features;

  async function refreshFeatures() {
    const data = await api.auth.config();
    setFeatures({ socialEnabled: data.socialEnabled === true, downloadsEnabled: data.downloadsEnabled === true });
  }

  useEffect(() => { api.auth.config().then(data => setFeatures({ socialEnabled: data.socialEnabled === true, downloadsEnabled: data.downloadsEnabled === true })).catch(() => {}); }, []);

  useEffect(() => {
    (async () => {
      try {
        const meData = await api.auth.me();
        await refreshMediaToken(1);
        setUser(meData.user);
      } catch {
        clearToken();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      refreshMediaToken().catch((err) => {
        console.error('Media token refresh failed after retries', err);
      });
    }, 55 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);

  async function login(email, password) {
    const data = await api.auth.login(email, password);
    try { await refreshMediaToken(); } catch { /* Playback offers a retry. */ }
    setUser(data.user);
    return data;
  }

  async function register(email, password, displayName, inviteCode) {
    const data = await api.auth.register(email, password, displayName, inviteCode);
    try { await refreshMediaToken(); } catch { /* Playback offers a retry. */ }
    setUser(data.user);
    return data;
  }

  useEffect(() => {
    const expire = () => { clearToken(); clearMediaToken(); setUser(null); };
    window.addEventListener('auth-expired', expire);
    return () => window.removeEventListener('auth-expired', expire);
  }, []);

  async function logout() {
    try { await api.auth.logout(); } catch { /* Clear this view even if the server is temporarily unavailable. */ } finally {
      clearToken(); clearMediaToken(); setUser(null);
    }
  }

  async function updatePrivacy(historyEnabled) {
    const data = await api.auth.privacy(historyEnabled);
    setUser(data.user);
    return data;
  }

  async function updateProfile(data) {
    const res = await api.auth.updateProfile(data);
    setUser(res.user);
    return res;
  }

  async function changePassword(currentPassword, newPassword) {
    const data = await api.auth.changePassword(currentPassword, newPassword);
    try { await refreshMediaToken(); } catch { /* Playback offers a retry. */ }
    setUser(data.user);
    return data;
  }

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateProfile, updatePrivacy, changePassword, isAdmin, socialEnabled, downloadsEnabled, refreshFeatures }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

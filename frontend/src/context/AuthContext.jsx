import { createContext, useContext, useState, useEffect } from 'react';
import { api, setToken, clearToken, getToken, clearMediaToken, refreshMediaToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const initialToken = getToken();
  const [loading, setLoading] = useState(!!initialToken);

  useEffect(() => {
    if (!initialToken) return;
    // Fetch the profile and a fresh media token in parallel, and gate the
    // first paint on BOTH. Media URLs (posters, backdrops, video) now use
    // only the short-lived media token — never the long-lived main token —
    // so we must have one before rendering any media, otherwise every image
    // would 401 during the fetch window.
    (async () => {
      try {
        const [meData] = await Promise.all([
          api.auth.me(),
          refreshMediaToken(1).catch((err) => {
            console.error('Initial media token fetch failed; media may not load until the next refresh', err);
          }),
        ]);
        setUser(meData.user);
      } catch {
        clearToken();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setToken(data.token);
    setUser(data.user);
    try { await refreshMediaToken(); } catch { /* ignore */ }
    return data;
  }

  async function register(email, password, displayName) {
    const data = await api.auth.register(email, password, displayName);
    setToken(data.token);
    setUser(data.user);
    try { await refreshMediaToken(); } catch { /* ignore */ }
    return data;
  }

  function logout() {
    clearToken();
    clearMediaToken();
    setUser(null);
  }

  async function updateProfile(data) {
    const res = await api.auth.updateProfile(data);
    setUser(res.user);
    return res;
  }

  async function changePassword(currentPassword, newPassword) {
    const data = await api.auth.changePassword(currentPassword, newPassword);
    setToken(data.token);
    setUser(data.user);
    try { await refreshMediaToken(); } catch { /* ignore */ }
    return data;
  }

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateProfile, changePassword, isAdmin }}>
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

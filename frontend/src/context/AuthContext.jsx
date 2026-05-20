import { createContext, useContext, useState, useEffect } from 'react';
import { api, setToken, clearToken, getToken, clearMediaToken, refreshMediaToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const initialToken = getToken();
  const [loading, setLoading] = useState(!!initialToken);

  useEffect(() => {
    if (initialToken) {
      api.auth.me()
        .then((data) => {
          setUser(data.user);
          refreshMediaToken().catch(() => { /* ignore */ });
        })
        .catch(() => clearToken())
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      refreshMediaToken().catch(() => { /* ignore */ });
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

import { createContext, useContext, useState, useEffect } from 'react';
import { api, setToken, clearToken, getToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = getToken();
    if (t) {
      api.auth.me()
        .then((data) => setUser(data.user))
        .catch(() => clearToken())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  async function login(email, password) {
    const data = await api.auth.login(email, password);
    setToken(data.token);
    setUser(data.user);
    return data;
  }

  async function register(email, password, displayName) {
    const data = await api.auth.register(email, password, displayName);
    setToken(data.token);
    setUser(data.user);
    return data;
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  async function updateProfile(data) {
    const res = await api.auth.updateProfile(data);
    setUser(res.user);
    return res;
  }

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateProfile, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

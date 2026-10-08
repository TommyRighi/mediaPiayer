import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api';

const Context = createContext(null);
export function WatchlistProvider({ children }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(new Set());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    setError(''); setLoading(true);
    try { const data = await api.watchlist.list(); setItems(data.media); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(refresh, 0); return () => clearTimeout(timer); }, [refresh]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 3500); return () => clearTimeout(timer); }, [message]);
  async function toggle(media) {
    if (loading || pending.has(media.id)) return;
    const saved = items.some(item => item.id === media.id);
    setPending(previous => new Set(previous).add(media.id)); setError('');
    try {
      if (saved) await api.watchlist.remove(media.id); else await api.watchlist.add(media.id);
      setItems(previous => saved ? previous.filter(item => item.id !== media.id) : [media, ...previous.filter(item => item.id !== media.id)]);
      setMessage(`${media.title} ${saved ? 'removed from' : 'added to'} My List.`);
    } catch (err) { setError(err.message); }
    finally { setPending(previous => { const next = new Set(previous); next.delete(media.id); return next; }); }
  }
  return <Context.Provider value={{ items, loading, pending, error, message, refresh, toggle }}>{children}<div className="jf-list-feedback" aria-live="polite">{message && <p role="status">{message}</p>}{error && <div role="alert"><p>{error}</p><button onClick={refresh}>Try again</button></div>}</div></Context.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useWatchlist() { return useContext(Context); }

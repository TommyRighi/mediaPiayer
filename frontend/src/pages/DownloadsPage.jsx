import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import PageState from '../components/PageState';

export default function DownloadsPage() {
  const { downloadsEnabled } = useAuth();
  const [downloads, setDownloads] = useState([]);
  const [music, setMusic] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [title, setTitle] = useState('');
  const [magnetUri, setMagnetUri] = useState('');
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    if (!downloadsEnabled) { setLoading(false); return; }
    try {
      const results = await Promise.allSettled([api.downloads.list(), api.music.youtube.downloads()]);
      setDownloads(results[0].status === 'fulfilled' ? results[0].value.downloads || [] : []);
      setAvailable(results[0].status === 'fulfilled' && results[0].value.available);
      setMusic(results[1].status === 'fulfilled' ? results[1].value : []);
      setError(results.filter(result => result.status === 'rejected').map(result => result.reason.message).join(' '));
    } finally { setLoading(false); }
  }, [downloadsEnabled]);
  async function startDownload(event) {
    event.preventDefault();
    setStarting(true); setError(''); setMessage('');
    try {
      await api.downloads.create(title.trim(), magnetUri.trim());
      setTitle(''); setMagnetUri('');
      setMessage('Download started. The movie will be available after download and preparation.');
      await load();
    } catch (err) { setError(err.message); }
    finally { setStarting(false); }
  }
  useEffect(() => { const initial = setTimeout(load, 0); const timer = setInterval(load, 10000); return () => { clearTimeout(initial); clearInterval(timer); }; }, [load]);
  if (!downloadsEnabled) return <PageState title="Downloads are disabled" message="Enable media downloads in Settings to import videos and music."><Link to="/settings" className="jf-btn-primary">Settings</Link></PageState>;
  return <div className="max-w-4xl mx-auto p-4 md:p-8">
    <div className="flex items-center justify-between mb-6"><h1 className="text-2xl font-bold">Downloads</h1><button onClick={load} className="jf-btn-secondary">Refresh</button></div>
    {error && <p role="alert" className="mb-4">{error}</p>}
    {loading && <p role="status">Loading…</p>}
    <section className="p-5 mb-8 rounded-lg" style={{ background: 'var(--jf-surface)' }} aria-labelledby="new-download-title">
      <h2 id="new-download-title" className="text-lg font-semibold mb-2">Download a movie</h2>
      <p className="text-sm mb-5" style={{ color: 'var(--jf-text-secondary)' }}>Only administrators can add and manage downloads. Everyone can watch once the movie is ready.</p>
      {!loading && !available && <p role="status" className="mb-4">Transmission is unavailable. Check the server configuration and refresh.</p>}
      <form onSubmit={startDownload} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">Movie title<input className="jf-input" value={title} onChange={event => setTitle(event.target.value)} required maxLength={200} disabled={starting} placeholder="Title displayed in the library" /></label>
        <label className="flex flex-col gap-2">Magnet link<textarea className="jf-input" value={magnetUri} onChange={event => setMagnetUri(event.target.value)} required rows={3} disabled={starting} placeholder="magnet:?xt=urn:btih:…" style={{ resize: 'vertical', overflowWrap: 'anywhere' }} /></label>
        <div><button className="jf-btn-primary" disabled={!available || starting || !title.trim() || !magnetUri.trim()}>{starting ? 'Starting…' : 'Start download'}</button></div>
      </form>
      {message && <p role="status" className="mt-4">{message}</p>}
    </section>
    <h2 className="text-lg mb-3">Videos</h2>
    {!downloads.length && !loading && <p className="mb-6">No video downloads yet.</p>}
    {downloads.map(item => <div key={item.id} className="p-4 mb-3 rounded-lg" style={{ background: 'var(--jf-surface)' }}>
      <Link to={`/movie/${item.mediaId}`} className="font-medium">{item.media_title || item.title || 'Video'}</Link>
      <p className="text-sm mt-2">{({ downloading: 'Downloading', importing: 'Importing video', completed: 'Downloaded', failed: 'Failed' })[item.status] || item.status}{item.progress != null ? ` · ${Math.round(item.progress * 100)}%` : ''}</p>
      {item.status === 'downloading' && <progress className="w-full mt-3" aria-label={`Download progress for ${item.title}`} max={1} value={item.progress || 0} />}
      {item.error && <p role="alert">{item.error}</p>}
      {item.status === 'downloading' && <button className="jf-btn-secondary mt-3" onClick={async () => { try { await api.downloads.cancel(item.mediaId); await load(); } catch (err) { setError(err.message); } }}>Cancel download</button>}
    </div>)}
    <h2 className="text-lg mt-8 mb-3">Music imports</h2>
    <Link to="/music" className="underline">Import music from YouTube</Link>
    {!music.length && !loading && <p className="mt-3">No music imports.</p>}
    {music.map(item => <div key={item.id} className="p-4 mt-3 rounded-lg" style={{ background: 'var(--jf-surface)' }}><p>{item.title || item.url}</p><p className="text-sm mt-2">{item.status}</p>{item.error && <p role="alert">{item.error}</p>}</div>)}
  </div>;
}

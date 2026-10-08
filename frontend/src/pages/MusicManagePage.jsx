import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function MusicManagePage() {
  const [albums, setAlbums] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [uploadAlbum, setUploadAlbum] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { const [a, t] = await Promise.all([api.music.albums.list(), api.music.tracks.list()]); setAlbums(a); setTracks(t); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);
  async function action(fn, success) {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); await load(); setMessage(success); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function edit(kind, item = {}) { setEditing({ kind, id: item.id }); setForm({ ...item, title: item.title || '', artist: item.artist || '', description: item.description || '', genre: item.genre || '', year: item.year || '', album_id: item.album_id || '', track_number: item.track_number || 0 }); }
  async function save(event) {
    event.preventDefault();
    await action(async () => {
      if (editing.kind === 'album') {
        const data = { title: form.title.trim(), artist: form.artist, description: form.description, genre: form.genre, year: form.year ? Number(form.year) : null };
        if (editing.id) await api.music.albums.update(editing.id, data); else await api.music.albums.create(data);
      } else await api.music.tracks.update(editing.id, { title: form.title.trim(), artist: form.artist, album_id: form.album_id || null, track_number: Number(form.track_number) });
      setEditing(null);
    }, 'Music saved.');
  }
  async function upload(event) {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (!files.length) return;
    await action(async () => {
      for (const file of files) {
        const data = new FormData(); if (uploadAlbum) data.append('album_id', uploadAlbum); data.append('file', file);
        const response = await fetch('/api/music/tracks/upload', { method: 'POST', body: data });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Upload failed');
      }
    }, 'Audio uploaded.');
  }
  const matches = item => `${item.title} ${item.artist || ''}`.toLowerCase().includes(search.toLowerCase());
  return <div className="max-w-4xl mx-auto p-4 md:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6"><h1 className="text-2xl font-bold">Manage Music</h1><Link to="/music" className="jf-btn-secondary">Back to Music</Link></div>
    {error && <p role="alert" className="mb-4" style={{ color: 'var(--jf-error)' }}>{error}</p>}
    {message && <p role="status" className="mb-4">{message}</p>}
    <section className="p-4 rounded-lg mb-6" style={{ background: 'var(--jf-surface)' }}>
      <h2 className="text-lg mb-3">Add music</h2>
      <div className="flex flex-wrap gap-3 items-center"><button disabled={busy} onClick={() => edit('album')} className="jf-btn-primary">Create Album</button><select aria-label="Upload to album" className="jf-input sm:max-w-xs" value={uploadAlbum} onChange={e => setUploadAlbum(e.target.value)}><option value="">Singles</option>{albums.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select><label className="jf-btn-secondary cursor-pointer">Upload Audio<input type="file" className="sr-only" accept=".mp3,.flac,.m4a,.aac,.ogg,.wav,.opus,.wma" multiple disabled={busy} onChange={upload} /></label></div>
      {busy && <p role="status" className="mt-3">Saving…</p>}
    </section>
    {editing && <form onSubmit={save} className="p-4 rounded-lg mb-6 space-y-3" style={{ background: 'var(--jf-surface)' }}>
      <h2 className="text-lg">{editing.id ? 'Edit' : 'Create'} {editing.kind}</h2>
      {['title', 'artist', ...(editing.kind === 'album' ? ['description', 'genre', 'year'] : ['track_number'])].map(key => <label key={key} className="block text-sm"><span className="block mb-1">{key.replace('_', ' ')}</span><input className="jf-input" required={key === 'title'} type={['year', 'track_number'].includes(key) ? 'number' : 'text'} min={key === 'track_number' ? 0 : undefined} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}
      {editing.kind === 'track' && <label className="block">Album<select className="jf-input" value={form.album_id} onChange={e => setForm({ ...form, album_id: e.target.value })}><option value="">Singles</option>{albums.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label>}
      <div className="flex gap-3"><button disabled={busy || !form.title.trim()} className="jf-btn-primary">Save</button><button type="button" disabled={busy} className="jf-btn-secondary" onClick={() => setEditing(null)}>Cancel</button></div>
    </form>}
    <input aria-label="Search music" className="jf-input mb-6" placeholder="Search titles and artists" value={search} onChange={e => setSearch(e.target.value)} />
    {loading && <p role="status">Loading…</p>}
    <h2 className="text-lg mb-3">Albums</h2>
    {!loading && !albums.filter(matches).length && <p className="mb-4">No albums found.</p>}
    {albums.filter(matches).map(item => <div key={item.id} className="flex flex-wrap justify-between gap-3 p-3 border-b" style={{ borderColor: 'var(--jf-divider)' }}><Link to={`/music/album/${item.id}`}>{item.title} · {item.artist}</Link><div className="flex gap-3"><button disabled={busy} onClick={() => edit('album', item)}>Edit album</button><button disabled={busy} onClick={() => { if (confirm(`Delete album “${item.title}”? Tracks will remain in the library.`)) action(() => api.music.albums.delete(item.id), 'Album deleted.'); }}>Delete album</button></div></div>)}
    <h2 className="text-lg mt-8 mb-3">Tracks</h2>
    {!loading && !tracks.filter(matches).length && <p>No tracks found.</p>}
    {tracks.filter(matches).map(item => <div key={item.id} className="flex flex-wrap justify-between gap-3 p-3 border-b" style={{ borderColor: 'var(--jf-divider)' }}><span>{item.title} · {item.artist}</span><div className="flex gap-3"><button disabled={busy} onClick={() => edit('track', item)}>Edit track</button><button disabled={busy} onClick={() => { if (confirm(`Remove “${item.title}” from the music library?`)) action(() => api.music.tracks.delete(item.id), 'Track removed.'); }}>Remove track</button></div></div>)}
  </div>;
}

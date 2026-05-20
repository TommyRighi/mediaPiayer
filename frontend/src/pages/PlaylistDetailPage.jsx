import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { usePlayer } from '../context/PlayerContext';

function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PlaylistDetailPage() {
  const { id } = useParams();
  const player = usePlayer();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [addingTracks, setAddingTracks] = useState(false);
  const [allTracks, setAllTracks] = useState([]);
  const [favorites, setFavorites] = useState(new Set());

  const loadPlaylist = useCallback(() => {
    api.music.playlists.get(id).then(data => {
      setPlaylist(data);
      setEditName(data.name);
      setEditDesc(data.description || '');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadPlaylist();
    api.music.favorites.list().then(favs => {
      setFavorites(new Set(favs.map(f => f.id)));
    }).catch(() => {});
  }, [id, loadPlaylist]);

  const toggleFavorite = async (trackId) => {
    if (favorites.has(trackId)) {
      await api.music.favorites.remove(trackId);
      setFavorites(prev => { const n = new Set(prev); n.delete(trackId); return n; });
    } else {
      await api.music.favorites.add(trackId);
      setFavorites(prev => { const n = new Set(prev); n.add(trackId); return n; });
    }
  };

  const handleSave = async () => {
    await api.music.playlists.update(id, { name: editName, description: editDesc });
    setEditing(false);
    loadPlaylist();
  };

  const handleDelete = async () => {
    if (!confirm('Delete this playlist?')) return;
    await api.music.playlists.delete(id);
    navigate('/music?tab=playlists');
  };

  const removeTrack = async (trackId) => {
    await api.music.playlists.removeTrack(id, trackId);
    loadPlaylist();
  };

  const openAddTracks = async () => {
    const tracks = await api.music.tracks.list();
    setAllTracks(Array.isArray(tracks) ? tracks : []);
    setAddingTracks(true);
  };

  const addTracks = async (trackIds) => {
    await api.music.playlists.addTracks(id, trackIds);
    setAddingTracks(false);
    loadPlaylist();
  };

  if (loading) return <div className="text-center py-16" style={{ color: 'var(--jf-text-muted)' }}>Loading...</div>;
  if (!playlist) return <div className="text-center py-16" style={{ color: 'var(--jf-text-muted)' }}>Playlist not found</div>;

  const tracks = playlist.tracks || [];

  return (
    <div>
      <div className="p-4 md:p-8" style={{ background: 'linear-gradient(to bottom, var(--jf-surface-elevated), var(--jf-bg))' }}>
        <div className="flex items-end gap-6">
          <div className="w-48 flex-shrink-0">
            <div className="aspect-square rounded-lg overflow-hidden shadow-xl flex items-center justify-center" style={{ background: 'var(--jf-surface)' }}>
              <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor" style={{ color: 'var(--jf-text-muted)' }}><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" /></svg>
            </div>
          </div>
          <div className="flex-1">
            <div className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--jf-text-muted)' }}>Playlist</div>
            {editing ? (
              <div className="flex flex-col gap-2 mb-2">
                <input className="jf-input text-lg font-bold" value={editName} onChange={(e) => setEditName(e.target.value)} />
                <input className="jf-input text-sm" placeholder="Description" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                <div className="flex gap-2">
                  <button className="jf-btn-primary text-sm" onClick={handleSave}>Save</button>
                  <button className="jf-btn-secondary text-sm" onClick={() => setEditing(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-3xl md:text-5xl font-bold mb-2" style={{ color: 'var(--jf-text-primary)' }}>{playlist.name}</h1>
                {playlist.description && <div className="text-sm mb-2" style={{ color: 'var(--jf-text-secondary)' }}>{playlist.description}</div>}
                <div className="text-sm" style={{ color: 'var(--jf-text-muted)' }}>{tracks.length} tracks{playlist.total_duration > 0 ? ` · ${formatDuration(playlist.total_duration)}` : ''}</div>
              </>
            )}
            {!editing && (
              <div className="flex gap-2 mt-4">
                <button onClick={() => tracks.length > 0 && player.playQueue(tracks, 0)} className="jf-btn-primary flex items-center gap-2" disabled={tracks.length === 0}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  Play
                </button>
                <button onClick={() => setEditing(true)} className="jf-btn-secondary text-sm">Edit</button>
                <button onClick={openAddTracks} className="jf-btn-secondary text-sm">Add Tracks</button>
                <button onClick={handleDelete} className="jf-btn-outline text-sm">Delete</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 md:px-8">
        {tracks.length === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--jf-text-muted)' }}>
            This playlist is empty. Add some tracks!
          </div>
        ) : (
          tracks.map((track, idx) => (
            <div
              key={track.id}
              className="flex items-center gap-3 px-3 py-2 rounded group hover:bg-white/5 transition-colors cursor-pointer"
              onClick={() => player.playTrack(track, tracks)}
            >
              <span className="w-8 text-center text-sm" style={{ color: 'var(--jf-text-muted)' }}>{idx + 1}</span>
              <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(track.id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: favorites.has(track.id) ? 'var(--jf-primary)' : 'var(--jf-text-muted)' }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill={favorites.has(track.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--jf-text-primary)' }}>{track.title}</div>
                <div className="text-xs truncate" style={{ color: 'var(--jf-text-secondary)' }}>{track.artist || 'Unknown'}</div>
              </div>
              {track.duration > 0 && (
                <span className="text-xs" style={{ color: 'var(--jf-text-muted)' }}>{formatDuration(track.duration)}</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: 'var(--jf-text-muted)' }}
                title="Remove from playlist"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
              </button>
            </div>
          ))
        )}
      </div>

      {addingTracks && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-lg p-6" style={{ background: 'var(--jf-surface)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium" style={{ color: 'var(--jf-text-primary)' }}>Add Tracks</h2>
              <button onClick={() => setAddingTracks(false)} style={{ color: 'var(--jf-text-muted)' }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {allTracks
                .filter(t => !tracks.some(pt => pt.id === t.id))
                .map(track => (
                  <button
                    key={track.id}
                    className="flex items-center gap-3 px-3 py-2 rounded text-left hover:bg-white/10 transition-colors"
                    onClick={() => addTracks([track.id])}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--jf-text-primary)' }}>{track.title}</div>
                      <div className="text-xs truncate" style={{ color: 'var(--jf-text-secondary)' }}>{track.artist || 'Unknown'}</div>
                    </div>
                  </button>
                ))
              }
              {allTracks.filter(t => !tracks.some(pt => pt.id === t.id)).length === 0 && (
                <div className="text-center py-8" style={{ color: 'var(--jf-text-muted)' }}>All tracks already added</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
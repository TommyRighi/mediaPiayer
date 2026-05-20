import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/AuthContext';

function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AlbumDetailPage() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const player = usePlayer();
  const navigate = useNavigate();
  const [album, setAlbum] = useState(null);
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState(new Set());

  useEffect(() => {
    api.music.albums.get(id).then(data => {
      setAlbum(data);
      setLoading(false);
    }).catch(() => setLoading(false));

    api.music.favorites.list().then(favs => {
      setFavorites(new Set(favs.map(f => f.id)));
    }).catch(() => {});
  }, [id]);

  const toggleFavorite = async (trackId) => {
    if (favorites.has(trackId)) {
      await api.music.favorites.remove(trackId);
      setFavorites(prev => { const n = new Set(prev); n.delete(trackId); return n; });
    } else {
      await api.music.favorites.add(trackId);
      setFavorites(prev => { const n = new Set(prev); n.add(trackId); return n; });
    }
  };

  const playAll = () => {
    if (album && album.tracks && album.tracks.length > 0) {
      player.playQueue(album.tracks, 0);
    }
  };

  const shuffleAll = () => {
    if (album && album.tracks && album.tracks.length > 0) {
      const shuffled = [...album.tracks].sort(() => Math.random() - 0.5);
      player.playQueue(shuffled, 0);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this album and all its tracks?')) return;
    await api.music.albums.delete(id);
    navigate('/music');
  };

  if (loading) return <div className="text-center py-16" style={{ color: 'var(--jf-text-muted)' }}>Loading...</div>;
  if (!album) return <div className="text-center py-16" style={{ color: 'var(--jf-text-muted)' }}>Album not found</div>;

  return (
    <div>
      <div className="flex flex-col md:flex-row gap-6 p-4 md:p-8" style={{ background: 'linear-gradient(to bottom, var(--jf-surface-elevated), var(--jf-bg))' }}>
        <div className="w-48 md:w-56 flex-shrink-0">
          <div className="aspect-square rounded-lg overflow-hidden shadow-xl" style={{ background: 'var(--jf-surface)' }}>
            {album.cover_path ? (
              <img src={api.music.albums.coverUrl(album.id)} alt={album.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--jf-text-muted)' }}>
                <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" /></svg>
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 flex flex-col justify-end">
          <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--jf-text-muted)' }}>Album</div>
          <h1 className="text-3xl md:text-5xl font-bold mb-2" style={{ color: 'var(--jf-text-primary)' }}>{album.title}</h1>
          {album.artist && <div className="text-lg mb-2" style={{ color: 'var(--jf-text-secondary)' }}>{album.artist}</div>}
          <div className="text-sm mb-4" style={{ color: 'var(--jf-text-muted)' }}>
            {album.year && <span>{album.year}</span>}
            {album.year && album.genre && <span> · </span>}
            {album.genre && <span>{album.genre}</span>}
            {album.tracks && <span> · {album.tracks.length} tracks</span>}
            {album.total_duration > 0 && <span> · {formatDuration(album.total_duration)}</span>}
          </div>
          <div className="flex gap-3">
            <button onClick={playAll} className="jf-btn-primary flex items-center gap-2" disabled={!album.tracks || album.tracks.length === 0}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              Play
            </button>
            <button onClick={shuffleAll} className="jf-btn-secondary flex items-center gap-2" disabled={!album.tracks || album.tracks.length === 0}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" /></svg>
              Shuffle
            </button>
            {isAdmin && (
              <button onClick={handleDelete} className="jf-btn-outline text-sm">Delete Album</button>
            )}
          </div>
        </div>
      </div>

      {album.description && (
        <div className="px-4 md:px-8 py-4 text-sm" style={{ color: 'var(--jf-text-secondary)' }}>{album.description}</div>
      )}

      <div className="px-4 md:px-8">
        {(album.tracks || []).map((track, idx) => (
          <div
            key={track.id}
            className="flex items-center gap-3 px-3 py-2 rounded group hover:bg-white/5 transition-colors cursor-pointer"
            onClick={() => player.playTrack(track, album.tracks)}
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
              {track.artist && <div className="text-xs truncate" style={{ color: 'var(--jf-text-secondary)' }}>{track.artist}</div>}
            </div>
            {track.duration > 0 && (
              <span className="text-xs" style={{ color: 'var(--jf-text-muted)' }}>{formatDuration(track.duration)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/AuthContext';

function AlbumCard({ album }) {
  return (
    <Link to={`/music/album/${album.id}`} className="block group">
      <div className="relative aspect-square rounded-lg overflow-hidden mb-2" style={{ background: 'var(--jf-surface-elevated)' }}>
        {album.cover_path ? (
          <img src={api.music.albums.coverUrl(album.id)} alt={album.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--jf-text-muted)' }}>
            <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" /></svg>
          </div>
        )}
      </div>
      <div className="text-sm font-medium truncate" style={{ color: 'var(--jf-text-primary)' }}>{album.title}</div>
      <div className="text-xs truncate" style={{ color: 'var(--jf-text-secondary)' }}>{album.artist || `${album.track_count || 0} tracks`}</div>
    </Link>
  );
}

function TrackRow({ track, index, onPlay, isFavorite, onToggleFavorite }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded group hover:bg-white/5 transition-colors cursor-pointer" onClick={onPlay}>
      <span className="w-8 text-center text-sm" style={{ color: 'var(--jf-text-muted)' }}>{index + 1}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        className={`opacity-0 group-hover:opacity-100 transition-opacity`}
        style={{ color: isFavorite ? 'var(--jf-primary)' : 'var(--jf-text-muted)' }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
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
    </div>
  );
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MusicPage() {
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAuth();
  const player = usePlayer();
  const [albums, setAlbums] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [ytUrl, setYtUrl] = useState('');
  const [ytTitle, setYtTitle] = useState('');
  const [ytArtist, setYtArtist] = useState('');
  const [ytDownloading, setYtDownloading] = useState(false);
  const [ytStatus, setYtStatus] = useState(null);

  const tab = searchParams.get('tab') || 'albums';

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [a, t, p, f] = await Promise.all([
          api.music.albums.list(),
          api.music.tracks.list(),
          api.music.playlists.list(),
          api.music.favorites.list(),
        ]);
        setAlbums(Array.isArray(a) ? a : []);
        setTracks(Array.isArray(t) ? t : []);
        setPlaylists(Array.isArray(p) ? p : []);
        setFavorites(Array.isArray(f) ? f : []);
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    }
    load();
  }, []);

  const favoriteIds = new Set(favorites.map(f => f.id));

  const toggleFavorite = async (trackId) => {
    if (favoriteIds.has(trackId)) {
      await api.music.favorites.remove(trackId);
      setFavorites(prev => prev.filter(f => f.id !== trackId));
    } else {
      const result = await api.music.favorites.add(trackId);
      if (result.success) {
        const track = tracks.find(t => t.id === trackId);
        if (track) setFavorites(prev => [...prev, track]);
      }
    }
  };

  const createPlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    const pl = await api.music.playlists.create({ name: newPlaylistName.trim() });
    setPlaylists(prev => [...prev, pl]);
    setNewPlaylistName('');
    setShowNewPlaylist(false);
  };

  const handleYtDownload = async () => {
    if (!ytUrl.trim()) return;
    setYtDownloading(true);
    setYtStatus(null);
    try {
      const result = await api.music.youtube.download(ytUrl, ytTitle, ytArtist);
      const poll = setInterval(async () => {
        const status = await api.music.youtube.status(result.id);
        setYtStatus(status);
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(poll);
          setYtDownloading(false);
          if (status.status === 'completed') {
            setYtUrl('');
            setYtTitle('');
            setYtArtist('');
            const t = await api.music.tracks.list();
            setTracks(Array.isArray(t) ? t : []);
          }
        }
      }, 2000);
    } catch (e) {
      setYtStatus({ status: 'failed', error: e.message });
      setYtDownloading(false);
    }
  };

  const handleScan = async () => {
    await api.music.scan();
    const [a, t] = await Promise.all([api.music.albums.list(), api.music.tracks.list()]);
    setAlbums(Array.isArray(a) ? a : []);
    setTracks(Array.isArray(t) ? t : []);
  };

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl md:text-3xl font-bold" style={{ color: 'var(--jf-text-primary)' }}>Music</h1>
        {isAdmin && (
          <button onClick={handleScan} className="jf-btn-secondary text-sm">Scan Library</button>
        )}
      </div>

      <div className="flex gap-1 mb-6 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {['albums', 'tracks', 'playlists', 'favorites'].map(t => (
          <Link
            key={t}
            to={`/music?tab=${t}`}
            className={`px-4 py-2 rounded text-sm font-medium transition whitespace-nowrap`}
            style={tab === t ? { background: 'var(--jf-primary)', color: 'var(--jf-bg)' } : { color: 'var(--jf-text-secondary)' }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Link>
        ))}
      </div>

      {isAdmin && (
        <div className="mb-8 p-4 rounded-lg" style={{ background: 'var(--jf-surface)' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--jf-text-primary)' }}>Download from YouTube</h3>
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder="YouTube URL"
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              className="jf-input flex-1 min-w-[200px] text-sm"
            />
            <input
              type="text"
              placeholder="Title (optional)"
              value={ytTitle}
              onChange={(e) => setYtTitle(e.target.value)}
              className="jf-input flex-1 min-w-[150px] text-sm"
            />
            <input
              type="text"
              placeholder="Artist (optional)"
              value={ytArtist}
              onChange={(e) => setYtArtist(e.target.value)}
              className="jf-input flex-1 min-w-[150px] text-sm"
            />
            <button onClick={handleYtDownload} disabled={ytDownloading || !ytUrl.trim()} className="jf-btn-primary text-sm whitespace-nowrap">
              {ytDownloading ? 'Downloading...' : 'Download MP3'}
            </button>
          </div>
          {ytStatus && (
            <div className="mt-2 text-sm" style={{ color: ytStatus.status === 'completed' ? '#4CAF50' : ytStatus.status === 'failed' ? 'var(--jf-error)' : 'var(--jf-text-secondary)' }}>
              {ytStatus.status === 'downloading' && `Downloading... ${ytStatus.progress?.toFixed(0) || 0}%`}
              {ytStatus.status === 'completed' && 'Download complete!'}
              {ytStatus.status === 'failed' && `Failed: ${ytStatus.error}`}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16" style={{ color: 'var(--jf-text-muted)' }}>Loading...</div>
      ) : (
        <>
          {tab === 'albums' && (
            <>
              {albums.length === 0 ? (
                <div className="text-center py-16" style={{ color: 'var(--jf-text-muted)' }}>
                  No albums yet. {isAdmin && 'Add music to your library or scan the music folder.'}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {albums.map(a => <AlbumCard key={a.id} album={a} />)}
                </div>
              )}
              {tracks.filter(t => !t.album_id).length > 0 && (
                <div className="mt-8">
                  <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--jf-text-primary)' }}>Singles</h2>
                  {tracks.filter(t => !t.album_id).map((track, idx) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      index={idx}
                      onPlay={() => player.playTrack(track, tracks.filter(t => !t.album_id))}
                      isFavorite={favoriteIds.has(track.id)}
                      onToggleFavorite={() => toggleFavorite(track.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'tracks' && (
            <>
              {tracks.length === 0 ? (
                <div className="text-center py-16" style={{ color: 'var(--jf-text-muted)' }}>No tracks yet.</div>
              ) : (
                tracks.map((track, idx) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={idx}
                    onPlay={() => player.playTrack(track, tracks)}
                    isFavorite={favoriteIds.has(track.id)}
                    onToggleFavorite={() => toggleFavorite(track.id)}
                  />
                ))
              )}
            </>
          )}

          {tab === 'playlists' && (
            <>
              <div className="mb-4">
                <button onClick={() => setShowNewPlaylist(!showNewPlaylist)} className="jf-btn-secondary text-sm">
                  + New Playlist
                </button>
              </div>
              {showNewPlaylist && (
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    placeholder="Playlist name"
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createPlaylist()}
                    className="jf-input flex-1 text-sm"
                    autoFocus
                  />
                  <button onClick={createPlaylist} className="jf-btn-primary text-sm">Create</button>
                </div>
              )}
              {playlists.length === 0 ? (
                <div className="text-center py-16" style={{ color: 'var(--jf-text-muted)' }}>No playlists yet. Create one!</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {playlists.map(pl => (
                    <Link key={pl.id} to={`/music/playlist/${pl.id}`} className="block group">
                      <div className="aspect-square rounded-lg overflow-hidden mb-2 flex items-center justify-center" style={{ background: 'var(--jf-surface-elevated)' }}>
                        <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" style={{ color: 'var(--jf-text-muted)' }}><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" /></svg>
                      </div>
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--jf-text-primary)' }}>{pl.name}</div>
                      <div className="text-xs" style={{ color: 'var(--jf-text-secondary)' }}>{pl.track_count || 0} tracks</div>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'favorites' && (
            <>
              {favorites.length === 0 ? (
                <div className="text-center py-16" style={{ color: 'var(--jf-text-muted)' }}>No favorites yet. Heart a track to add it here.</div>
              ) : (
                favorites.map((track, idx) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={idx}
                    onPlay={() => player.playTrack(track, favorites)}
                    isFavorite={true}
                    onToggleFavorite={() => toggleFavorite(track.id)}
                  />
                ))
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
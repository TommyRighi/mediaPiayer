import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import MediaCard from '../components/MediaCard';

function MediaRow({ title, items, variant = 'portrait' }) {
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateScroll(el) {
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }

  function scrollBy(dir) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  }

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between px-4 md:px-8 mb-2">
        <h3 className="text-lg font-medium" style={{ color: 'var(--jf-text-primary)' }}>{title}</h3>
      </div>
      <div className="relative group/row">
        {canScrollLeft && (
          <button
            onClick={() => scrollBy(-1)}
            className="absolute left-0 top-0 bottom-0 w-10 z-10 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
            style={{ background: 'linear-gradient(to right, var(--jf-bg), transparent)' }}
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="rgba(255,255,255,0.8)"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
          </button>
        )}
        <div
          ref={(el) => { scrollRef.current = el; if (el) updateScroll(el); }}
          className="flex gap-2 overflow-x-auto px-4 md:px-8 pb-2 scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          onScroll={(e) => updateScroll(e.currentTarget)}
        >
          {items.map((item) => (
            <MediaCard key={item.id} media={item} progress={item.watchProgress} variant={variant} />
          ))}
        </div>
        {canScrollRight && (
          <button
            onClick={() => scrollBy(1)}
            className="absolute right-0 top-0 bottom-0 w-10 z-10 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
            style={{ background: 'linear-gradient(to left, var(--jf-bg), transparent)' }}
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="rgba(255,255,255,0.8)"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

export default function BrowsePage() {
  const [searchParams] = useSearchParams();
  const [media, setMedia] = useState([]);
  const [history, setHistory] = useState([]);
  const [featured, setFeatured] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const typeFilter = searchParams.get('type');

  useEffect(() => {
    api.media.list().then((data) => {
      setMedia(data.media);
      if (data.media.length > 0) {
        setFeatured(data.media[Math.floor(Math.random() * data.media.length)]);
      }
    });
    api.watch.history().then((data) => setHistory(data.history)).catch(() => {});
  }, []);

  const filteredMedia = useMemo(() => {
    let result = media;
    if (typeFilter) {
      result = result.filter((m) => m.type === typeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((m) =>
        m.title.toLowerCase().includes(q) ||
        (m.genre && m.genre.toLowerCase().includes(q))
      );
    }
    return result;
  }, [media, typeFilter, searchQuery]);

  const movies = filteredMedia.filter((m) => m.type === 'movie');
  const series = filteredMedia.filter((m) => m.type === 'series');
  const continueWatching = history.filter((h) => !h.completed && h.type);

  if (media.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="text-center">
          <h2 className="text-2xl md:text-3xl font-medium mb-3" style={{ color: 'var(--jf-text-primary)' }}>Welcome to MediaPiayer</h2>
          <p style={{ color: 'var(--jf-text-muted)' }} className="mb-6">Your library is empty. Upload some media to get started.</p>
          <Link to="/upload" className="jf-btn-primary inline-block">
            Upload Media
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      {featured && !typeFilter && !searchQuery && (
        <div className="jf-backdrop" style={featured.backdrop_path ? { backgroundImage: `url(${api.media.backdropUrl(featured.id)})` } : { background: 'linear-gradient(to bottom right, var(--jf-surface-elevated), var(--jf-bg))' }}>
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--jf-bg) 0%, rgba(20,20,20,0.6) 40%, transparent 100%)' }} />
          <div className="absolute inset-0 flex items-end pb-12 md:pb-20 px-4 md:px-8">
            <div className="max-w-lg">
              <h1 className="text-3xl md:text-5xl font-bold mb-3 md:mb-4 drop-shadow-lg" style={{ color: 'var(--jf-text-primary)' }}>{featured.title}</h1>
              {featured.description && (
                <p className="text-sm md:text-lg mb-3 md:mb-4 line-clamp-3" style={{ color: 'var(--jf-text-secondary)' }}>{featured.description}</p>
              )}
              <div className="flex gap-3">
                <Link
                  to={featured.type === 'movie' ? `/watch/${featured.id}` : `/series/${featured.id}`}
                  className="jf-btn-primary flex items-center gap-2"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  Play
                </Link>
                <Link
                  to={featured.type === 'movie' ? `/movie/${featured.id}` : `/series/${featured.id}`}
                  className="jf-btn-secondary flex items-center gap-2"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" /></svg>
                  More Info
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={(featured && !typeFilter && !searchQuery) ? '-mt-8 md:-mt-16 relative z-10' : 'pt-4'}>
        <div className="px-4 md:px-8 mb-6">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--jf-text-muted)" className="absolute left-3 top-1/2 -translate-y-1/2"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
              <input
                type="text"
                placeholder="Search titles, genres..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="jf-input pl-10"
              />
            </div>
            <div className="flex gap-1">
              <Link
                to="/"
                className={`px-3 py-2 rounded text-sm font-medium transition ${!typeFilter ? '' : 'opacity-60'}`}
                style={!typeFilter ? { background: 'var(--jf-primary)', color: 'var(--jf-bg)' } : { color: 'var(--jf-text-secondary)' }}
              >
                All
              </Link>
              <Link
                to="/?type=movie"
                className={`px-3 py-2 rounded text-sm font-medium transition ${typeFilter === 'movie' ? '' : 'opacity-60'}`}
                style={typeFilter === 'movie' ? { background: 'var(--jf-primary)', color: 'var(--jf-bg)' } : { color: 'var(--jf-text-secondary)' }}
              >
                Movies
              </Link>
              <Link
                to="/?type=series"
                className={`px-3 py-2 rounded text-sm font-medium transition ${typeFilter === 'series' ? '' : 'opacity-60'}`}
                style={typeFilter === 'series' ? { background: 'var(--jf-primary)', color: 'var(--jf-bg)' } : { color: 'var(--jf-text-secondary)' }}
              >
                Series
              </Link>
            </div>
          </div>
        </div>

        {continueWatching.length > 0 && !typeFilter && !searchQuery && (
          <MediaRow title="Continue Watching" items={continueWatching.map(h => ({
            ...h,
            id: h.media_id,
            type: h.type,
            poster_path: h.poster_path,
            backdrop_path: h.backdrop_path,
            duration: 0,
            watchProgress: h,
            watchUrl: h.episode_id ? `/watch/${h.media_id}/${h.episode_id}` : `/watch/${h.media_id}`,
          }))} variant="backdrop" />
        )}
        {movies.length > 0 && <MediaRow title="Movies" items={movies} />}
        {series.length > 0 && <MediaRow title="Series" items={series} />}
        {filteredMedia.length === 0 && searchQuery && (
          <div className="text-center py-16" style={{ color: 'var(--jf-text-muted)' }}>
            No results for "{searchQuery}"
          </div>
        )}
      </div>
    </div>
  );
}

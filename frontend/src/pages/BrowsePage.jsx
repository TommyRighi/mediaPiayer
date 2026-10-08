import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '../api';
import MediaCard from '../components/MediaCard';
import PageState from '../components/PageState';
import { useAuth } from '../context/AuthContext';

function MediaRow({ title, items, variant = 'portrait', grid = false }) {
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
    <section className="mb-8">
      <div className="flex items-center justify-between px-4 md:px-8 mb-2">
        <h2 className="text-lg font-medium" style={{ color: 'var(--jf-text-primary)' }}>{title}<span className="ml-2 text-xs" style={{ color: 'var(--jf-text-muted)' }}>{items.length}</span></h2>
      </div>
      <div className="relative group/row">
        {!grid && canScrollLeft && (
          <button
            aria-label={`Scroll ${title} left`} onClick={() => scrollBy(-1)}
            className="absolute left-0 top-0 bottom-0 w-10 z-10 flex items-center justify-center jf-row-arrow"
            style={{ background: 'linear-gradient(to right, var(--jf-bg), transparent)' }}
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="rgba(255,255,255,0.8)"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
          </button>
        )}
        <div
          ref={(el) => { scrollRef.current = el; if (el) updateScroll(el); }}
          className={grid ? "jf-media-grid px-4 md:px-8" : "jf-media-row flex gap-3 overflow-x-auto px-4 md:px-8 pb-2"}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          onScroll={(e) => updateScroll(e.currentTarget)}
        >
          {items.map((item) => (
            <MediaCard key={`${item.id}:${item.episode_id || "movie"}`} media={item} progress={item.watchProgress} variant={variant} grid={grid} />
          ))}
        </div>
        {!grid && canScrollRight && (
          <button
            aria-label={`Scroll ${title} right`} onClick={() => scrollBy(1)}
            className="absolute right-0 top-0 bottom-0 w-10 z-10 flex items-center justify-center jf-row-arrow"
            style={{ background: 'linear-gradient(to left, var(--jf-bg), transparent)' }}
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="rgba(255,255,255,0.8)"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
          </button>
        )}
      </div>
    </section>
  );
}

export default function BrowsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, user } = useAuth();
  const location = useLocation();
  const searchRef = useRef(null);
  const handledSearch = useRef(null);
  const searchRequest = location.state?.searchRequest;
  const [media, setMedia] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const typeFilter = searchParams.get('type') || '';
  const searchQuery = searchParams.get('q') || '';
  const queryKey = `${typeFilter}:${searchQuery}`;
  const lastQuery = useRef(queryKey);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      const changed = lastQuery.current !== queryKey;
      const offset = changed ? 0 : page * 36;
      if (changed) { setPage(0); lastQuery.current = queryKey; }
      try {
        const data = await api.media.list({ type: typeFilter, search: searchQuery.trim(), limit: 36, offset });
        if (cancelled) return;
        setMedia(previous => offset ? [...previous, ...data.media] : data.media);
        setHasMore(data.hasMore);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, searchQuery ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [typeFilter, searchQuery, queryKey, page, attempt]);

  useEffect(() => {
    api.watch.history().then(data => setHistory(data.history)).catch(() => {});
  }, []);

  useEffect(() => {
    if (searchRequest && handledSearch.current !== searchRequest && searchRef.current) {
      searchRef.current.focus(); searchRef.current.select(); handledSearch.current = searchRequest;
    }
  }, [searchRequest, loading]);

  const featured = media.find(item => item.file_path && item.file_size > 0 && !['pending', 'converting'].includes(item.transcode_status) && !['downloading', 'importing'].includes(item.download_status)) || media[0];
  const featuredPlayable = featured?.file_path && featured.file_size > 0 && !['pending', 'converting'].includes(featured.transcode_status) && !['downloading', 'importing'].includes(featured.download_status);
  const movies = media.filter(m => m.type === 'movie');
  const series = media.filter(m => m.type === 'series');
  const continueWatching = history.filter(h => !h.completed && h.type);
  const retry = () => setAttempt(n => n + 1);

  if (loading && media.length === 0 && !typeFilter && !searchQuery) return <PageState busy title="Loading your library" message="Finding your movies, series and saved positions." />;
  if (error && media.length === 0) return <PageState title="Unable to load your library" message={error} retry={retry} />;
  if (!loading && !error && media.length === 0 && !typeFilter && !searchQuery) return (
    <PageState title="Your library is ready for its first video" message={isAdmin ? 'Upload a movie or scan your media folders to get started.' : 'Your administrator has not added any videos yet.'}>
      {isAdmin && <Link to="/upload" className="jf-btn-primary inline-block">Upload media</Link>}
    </PageState>
  );

  return (
    <div>
      {featured && !typeFilter && !searchQuery && (
        <div className="jf-backdrop" style={featured.backdrop_path ? { backgroundImage: `url(${api.media.backdropUrl(featured.id, 'md')})` } : { background: 'linear-gradient(to bottom right, var(--jf-surface-elevated), var(--jf-bg))' }}>
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--jf-bg) 0%, rgba(20,20,20,0.6) 40%, transparent 100%)' }} />
          <div className="absolute inset-0 flex items-end pb-12 md:pb-20 px-4 md:px-8">
            <div className="max-w-lg">
              <h1 className="text-3xl md:text-5xl font-bold mb-3 md:mb-4 drop-shadow-lg" style={{ color: 'var(--jf-text-primary)' }}>{featured.title}</h1>
              {featured.description && (
                <p className="text-sm md:text-lg mb-3 md:mb-4 line-clamp-3" style={{ color: 'var(--jf-text-secondary)' }}>{featured.description}</p>
              )}
              <div className="flex gap-3">
                {featured.type === 'movie' && !featuredPlayable ? <span className="jf-btn-secondary opacity-60">{['pending', 'converting'].includes(featured.transcode_status) ? 'Preparing video…' : 'Video unavailable'}</span> : <Link
                  to={featured.type === 'movie' ? `/watch/${featured.id}` : `/series/${featured.id}`}
                  className="jf-btn-primary flex items-center gap-2"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  {featured.type === 'movie' ? 'Play' : 'Browse episodes'}
                </Link>}
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
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 w-full max-w-md">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--jf-text-muted)" className="absolute left-3 top-1/2 -translate-y-1/2"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
              <input
                ref={searchRef}
                type="search"
                autoComplete="off"
                placeholder="Search titles, genres..."
                value={searchQuery}
                aria-label="Search titles and genres"
                onChange={(e) => { const next = new URLSearchParams(searchParams); if (e.target.value) next.set('q', e.target.value); else next.delete('q'); setPage(0); setSearchParams(next, { replace: true }); }}
                className="jf-input" style={{ paddingLeft: 40, paddingRight: 42 }}
              />
              {searchQuery && <button aria-label="Clear search" className="jf-clear-search" onClick={() => { const next = new URLSearchParams(searchParams); next.delete('q'); setPage(0); setSearchParams(next, { replace: true }); searchRef.current?.focus(); }}>×</button>}
            </div>
            <div className="flex gap-1">
              <Link
                to={searchQuery ? `/?q=${encodeURIComponent(searchQuery)}` : "/"}
                className={`px-3 py-2 rounded text-sm font-medium transition ${!typeFilter ? '' : 'opacity-60'}`}
                style={!typeFilter ? { background: 'var(--jf-primary)', color: 'var(--jf-bg)' } : { color: 'var(--jf-text-secondary)' }}
              >
                All
              </Link>
              <Link
                to={`/?type=movie${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`}
                className={`px-3 py-2 rounded text-sm font-medium transition ${typeFilter === 'movie' ? '' : 'opacity-60'}`}
                style={typeFilter === 'movie' ? { background: 'var(--jf-primary)', color: 'var(--jf-bg)' } : { color: 'var(--jf-text-secondary)' }}
              >
                Movies
              </Link>
              <Link
                to={`/?type=series${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`}
                className={`px-3 py-2 rounded text-sm font-medium transition ${typeFilter === 'series' ? '' : 'opacity-60'}`}
                style={typeFilter === 'series' ? { background: 'var(--jf-primary)', color: 'var(--jf-bg)' } : { color: 'var(--jf-text-secondary)' }}
              >
                Series
              </Link>
            </div>
          </div>
        </div>

        <div className="px-4 md:px-8 mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm" role="status" aria-live="polite" style={{ color: 'var(--jf-text-secondary)' }}>{loading ? 'Searching your library…' : searchQuery ? `${media.length}${hasMore ? '+' : ''} ${media.length === 1 && !hasMore ? 'result' : 'results'} for “${searchQuery}”` : 'Your library'}</p>
          {!user?.history_enabled && !searchQuery && <Link to="/profile#privacy-heading" className="text-xs underline" style={{ color: 'var(--jf-text-secondary)' }}>Enable saved progress to continue watching</Link>}
        </div>
        {continueWatching.length > 0 && !typeFilter && !searchQuery && (
          <MediaRow title="Continue Watching" items={continueWatching.map(h => ({
            ...h,
            id: h.media_id,
            type: h.type,
            poster_path: h.poster_path,
            backdrop_path: h.backdrop_path,
            duration: h.duration,
            watchProgress: h,
            watchUrl: h.episode_id ? `/watch/${h.media_id}/${h.episode_id}` : `/watch/${h.media_id}`,
          }))} variant="backdrop" />
        )}
        {error && <div className="px-4 md:px-8 mb-4" role="alert">{error} <button className="jf-btn-secondary" onClick={retry}>Try again</button></div>}
        {movies.length > 0 && <MediaRow title="Movies" items={movies} grid={!!searchQuery || !!typeFilter} />}
        {series.length > 0 && <MediaRow title="Series" items={series} grid={!!searchQuery || !!typeFilter} />}
        {hasMore && <div className="px-4 md:px-8 pb-8"><button className="jf-btn-secondary" disabled={loading || !!error} onClick={() => setPage(n => n + 1)}>{loading ? 'Loading…' : 'Load more'}</button></div>}
        {!loading && media.length === 0 && (
          <div className="text-center py-16" style={{ color: 'var(--jf-text-muted)' }}>
            <h2 className="text-lg mb-2">{searchQuery ? `No results for “${searchQuery}”` : `No ${typeFilter === 'series' ? 'series' : 'movies'} yet.`}</h2>
            {searchQuery && <><p className="text-sm mb-5">Try part of the title or a genre.</p><button className="jf-btn-secondary" onClick={() => { const next = new URLSearchParams(searchParams); next.delete('q'); setSearchParams(next, { replace: true }); searchRef.current?.focus(); }}>Clear search</button></>}
          </div>
        )}
      </div>
    </div>
  );
}

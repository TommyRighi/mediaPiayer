import { Link } from 'react-router-dom';
import { api } from '../api';

export default function MediaCard({ media, progress, variant = 'portrait' }) {
  const linkTo = media.watchUrl || (media.type === 'movie'
    ? `/movie/${media.id}`
    : `/series/${media.id}`);

  const progressPct = progress && progress.progress_seconds && media.duration
    ? (progress.progress_seconds / media.duration) * 100
    : 0;

  const watched = progress && progress.completed;

  const hasPoster = media.poster_path;
  const hasBackdrop = media.backdrop_path;

  if (variant === 'backdrop') {
    return (
      <Link to={linkTo} className="flex-shrink-0 group relative overflow-hidden" style={{ width: '72vw', maxWidth: '350px' }}>
        <div className="relative" style={{ paddingBottom: '56.25%' }}>
          {hasBackdrop ? (
            <img src={api.media.backdropUrl(media.id)} alt={media.title} className="absolute inset-0 w-full h-full object-cover" style={{ borderRadius: '0.3em' }} loading="lazy" />
          ) : hasPoster ? (
            <img src={api.media.posterUrl(media.id)} alt={media.title} className="absolute inset-0 w-full h-full object-cover" style={{ borderRadius: '0.3em' }} loading="lazy" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'var(--jf-surface)', borderRadius: '0.3em' }}>
              <span className="text-2xl" style={{ color: 'var(--jf-text-muted)' }}>{media.title.charAt(0)}</span>
            </div>
          )}
          {watched && (
            <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--jf-primary)' }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="var(--jf-bg)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.5)', borderRadius: '0.3em' }}>
            <div className="w-10 h-10 rounded-full border-2 border-white flex items-center justify-center">
              <span className="text-white ml-0.5 text-lg">&#9654;</span>
            </div>
          </div>
        </div>
        <p className="text-sm font-medium mt-1.5 truncate" style={{ color: 'var(--jf-text-primary)' }}>{media.title}</p>
        {progressPct > 0 && !watched && (
          <div className="h-1 rounded-full overflow-hidden mt-1" style={{ background: 'rgba(255,255,255,0.12)' }}>
            <div className="h-full rounded-full" style={{ width: `${progressPct}%`, background: 'var(--jf-primary)' }} />
          </div>
        )}
      </Link>
    );
  }

  return (
    <Link to={linkTo} className="flex-shrink-0 group relative overflow-hidden" style={{ width: '30vw', maxWidth: '180px' }}>
      <div className="relative" style={{ paddingBottom: '150%' }}>
        {hasPoster ? (
          <img src={api.media.posterUrl(media.id)} alt={media.title} className="absolute inset-0 w-full h-full object-cover" style={{ borderRadius: '0.3em' }} loading="lazy" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'var(--jf-surface-elevated, #292929)', borderRadius: '0.3em' }}>
            <span className="text-3xl" style={{ color: 'var(--jf-text-muted)' }}>{media.title.charAt(0)}</span>
          </div>
        )}
        {watched && (
          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--jf-primary)' }}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="var(--jf-bg)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.5)', borderRadius: '0.3em' }}>
          <div className="w-10 h-10 rounded-full border-2 border-white flex items-center justify-center">
            <span className="text-white ml-0.5 text-lg">&#9654;</span>
          </div>
        </div>
      </div>
      {progressPct > 0 && !watched && (
        <div className="absolute bottom-0 left-0 right-0 h-1 rounded-full overflow-hidden mx-1" style={{ background: 'rgba(255,255,255,0.12)' }}>
          <div className="h-full rounded-full" style={{ width: `${progressPct}%`, background: 'var(--jf-primary)' }} />
        </div>
      )}
      <p className="text-sm font-medium mt-1.5 truncate" style={{ color: 'var(--jf-text-primary)' }}>{media.title}</p>
    </Link>
  );
}
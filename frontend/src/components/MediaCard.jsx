import { Link } from 'react-router-dom';
import WatchlistButton from './WatchlistButton';
import { api } from '../api';

export default function MediaCard({ media, progress, variant = 'portrait', grid = false }) {
  const details = media.type === 'movie' ? `/movie/${media.id}` : `/series/${media.id}`;
  const linkTo = media.watchUrl || details;
  const landscape = variant === 'backdrop';
  const downloading = ['downloading', 'importing'].includes(media.download_status);
  const converting = downloading || ['pending', 'converting'].includes(media.transcode_status);
  const unavailable = media.type === 'movie' && ((!media.file_path && !media.watchUrl) || media.file_size === 0);
  const playable = !converting && !unavailable;
  const watched = progress?.completed;
  const percent = progress?.progress_seconds && media.duration ? Math.min(100, progress.progress_seconds / media.duration * 100) : 0;
  const minutes = media.duration > 0 ? Math.max(1, Math.round(media.duration / 60)) : null;
  const poster = landscape && media.backdrop_path ? api.media.backdropUrl(media.id, 'sm') : media.poster_path ? api.media.posterUrl(media.id, 'sm') : null;
  const hue = [...media.title].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 70 + 165;
  return <article className={`jf-media-card ${landscape ? 'jf-media-card-landscape' : ''} ${grid ? 'jf-media-card-grid' : ''}`}>
    <Link to={linkTo} className="jf-media-card-link" title={media.title}>
      <div className="jf-media-art" style={{ '--card-hue': hue }}>
        {poster ? <img src={poster} alt="" loading="lazy" decoding="async" /> : <div className="jf-media-placeholder"><span className="jf-media-placeholder-kind">{media.type === 'movie' ? 'FILM' : 'SERIES'}</span><span className="jf-media-placeholder-title">{media.title}</span><span className="jf-media-placeholder-year">{media.year || 'MediaPiayer'}</span></div>}
        {(converting || unavailable || watched) && <span className={`jf-media-badge ${converting ? 'jf-media-badge-preparing' : ''}`}>{downloading ? 'Downloading' : converting ? 'Preparing' : unavailable ? 'Unavailable' : 'Watched'}</span>}
        <span className="jf-media-info-hover">{landscape ? 'Continue watching' : 'View details'}</span>
        {percent > 0 && !watched && <div className="jf-media-progress" role="progressbar" aria-label={`${media.title} progress`} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div>}
      </div>
      <h3 className="jf-media-title">{media.title}</h3>
      <p className="jf-media-meta">{[media.year, minutes && `${minutes} min`].filter(Boolean).join(' · ') || (media.type === 'movie' ? 'Movie' : 'Series')}</p>
      {media.episode_number && <p className="jf-media-meta">S{media.season_number} E{media.episode_number} · {media.episode_title}</p>}
      {percent > 0 && !watched && <p className="jf-media-meta">{Math.max(1, Math.ceil((media.duration - progress.progress_seconds) / 60))} min left</p>}
    </Link>
    <div className="jf-media-actions">
      <WatchlistButton media={media} compact />
      {media.type === 'movie' || media.watchUrl ? playable ? <Link className="jf-card-play" to={media.watchUrl || `/watch/${media.id}`} aria-label={`${percent > 0 && !watched ? 'Resume' : 'Play'} ${media.title}`}><span aria-hidden="true">▶</span> {percent > 0 && !watched ? 'Resume' : 'Play'}</Link> : <span className="jf-card-status">{downloading ? 'Available after download' : converting ? 'Preparing video…' : 'Video unavailable'}</span> : <Link className="jf-card-play" to={details}>Episodes</Link>}
      {landscape && <Link to={details} className="jf-card-details" aria-label={`Details for ${media.title}`}>Details</Link>}
    </div>
  </article>;
}

import { useWatchlist } from '../context/WatchlistContext';

export default function WatchlistButton({ media, compact = false }) {
  const { items, loading, pending, toggle, error } = useWatchlist();
  const saved = items.some(item => item.id === media.id);
  const busy = pending.has(media.id);
  const label = `${saved ? 'Remove' : 'Add'} ${media.title} ${saved ? 'from' : 'to'} My List`;
  return <button className={compact ? 'jf-card-save' : 'jf-btn-secondary'} disabled={loading || busy || !!error} onClick={() => toggle(media)} aria-label={label} aria-pressed={saved} title={label}>{busy ? '…' : saved ? '✓' : '+'}{!compact && <span className="ml-2">{saved ? 'In My List' : 'My List'}</span>}</button>;
}

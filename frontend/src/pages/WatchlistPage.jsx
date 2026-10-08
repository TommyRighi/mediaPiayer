import { Link } from 'react-router-dom';
import { useWatchlist } from '../context/WatchlistContext';
import MediaCard from '../components/MediaCard';
import PageState from '../components/PageState';

export default function WatchlistPage() {
  const { items, loading, error, refresh } = useWatchlist();
  if (loading) return <PageState busy title="Loading My List" />;
  if (error && !items.length) return <PageState title="Unable to load My List" message={error} retry={refresh} />;
  return <div className="p-4 md:p-8"><h1 className="text-2xl font-bold mb-2">My List</h1><p className="text-sm mb-8" style={{ color: 'var(--jf-text-secondary)' }}>Movies and series you want to watch. Only you can see this list.</p>{items.length ? <div className="jf-media-grid">{items.map(item => <MediaCard key={item.id} media={item} grid />)}</div> : <div className="text-center py-16"><h2 className="text-xl mb-3">Save something for later</h2><p className="text-sm mb-6" style={{ color: 'var(--jf-text-secondary)' }}>Use the + button on a movie or series to add it here.</p><Link to="/" className="jf-btn-primary">Browse library</Link></div>}</div>;
}

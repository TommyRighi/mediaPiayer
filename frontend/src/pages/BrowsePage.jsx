import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import MediaCard from '../components/MediaCard';

function MediaRow({ title, items }) {
  return (
    <div className="mb-8">
      <h3 className="text-lg font-medium text-gray-200 mb-3 px-8">{title}</h3>
      <div className="flex gap-1 overflow-x-auto px-8 pb-2 scroll-smooth">
        {items.map((item) => (
          <MediaCard key={item.id} media={item} progress={item.watchProgress} />
        ))}
      </div>
    </div>
  );
}

export default function BrowsePage() {
  const [media, setMedia] = useState([]);
  const [history, setHistory] = useState([]);
  const [featured, setFeatured] = useState(null);

  useEffect(() => {
    api.media.list().then((data) => {
      setMedia(data.media);
      if (data.media.length > 0) {
        setFeatured(data.media[Math.floor(Math.random() * data.media.length)]);
      }
    });
    api.watch.history().then((data) => setHistory(data.history)).catch(() => {});
  }, []);

  const movies = media.filter((m) => m.type === 'movie');
  const series = media.filter((m) => m.type === 'series');
  const continueWatching = history.filter((h) => !h.completed && h.type);

  if (media.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen px-8 pt-20">
        <div className="text-center">
          <h2 className="text-3xl font-medium mb-3">Welcome to Nextflix</h2>
          <p className="text-gray-400 mb-6">Your library is empty. Upload some media to get started.</p>
          <Link
            to="/upload"
            className="inline-block bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded font-medium transition"
          >
            Upload Media
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      {featured && (
        <div className="relative h-[70vh] min-h-[400px] flex items-end pb-20 px-8">
          {featured.backdrop_path ? (
            <img src={featured.backdrop_path} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-b from-neutral-900 to-[#141414]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/60 to-transparent" />

          <div className="relative z-10 max-w-lg">
            <h1 className="text-5xl font-bold mb-4 drop-shadow-lg">{featured.title}</h1>
            {featured.description && (
              <p className="text-gray-200 text-lg mb-4 line-clamp-3">{featured.description}</p>
            )}
            <div className="flex gap-3">
              <Link
                to={featured.type === 'movie' ? `/watch/${featured.id}` : `/series/${featured.id}`}
                className="bg-red-600 hover:bg-red-700 text-white px-8 py-2.5 rounded font-medium flex items-center gap-2 transition"
              >
                <span>&#9654;</span> Play
              </Link>
              <Link
                to={featured.type === 'movie' ? `/movie/${featured.id}` : `/series/${featured.id}`}
                className="bg-neutral-600/70 hover:bg-neutral-600 text-white px-8 py-2.5 rounded font-medium flex items-center gap-2 transition"
              >
                <span>&#9432;</span> More Info
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 -mt-20">
        {continueWatching.length > 0 && (
          <MediaRow title="Continue Watching" items={continueWatching.map(h => ({
            ...h, id: h.media_id, type: h.type, poster_path: h.poster_path, duration: 0, watchProgress: h
          }))} />
        )}
        {movies.length > 0 && <MediaRow title="Movies" items={movies} />}
        {series.length > 0 && <MediaRow title="Series" items={series} />}
      </div>
    </div>
  );
}

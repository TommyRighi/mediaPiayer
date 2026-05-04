import { Link } from 'react-router-dom';

export default function MediaCard({ media, progress }) {
  const linkTo = media.type === 'movie'
    ? `/movie/${media.id}`
    : `/series/${media.id}`;

  const progressPct = progress && media.duration
    ? (progress.progress_seconds / media.duration) * 100
    : 0;

  return (
    <Link to={linkTo} className="flex-shrink-0 w-[130px] sm:w-[150px] md:w-[180px] group relative transition-transform hover:scale-105 z-10 hover:z-20">
      <div className="aspect-[2/3] bg-neutral-800 rounded overflow-hidden">
        {media.poster_path ? (
          <img
            src={`/api/media/${media.id}/poster`}
            alt={media.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-600 text-2xl sm:text-3xl md:text-4xl">
            {media.title.charAt(0)}
          </div>
        )}
      </div>

      {progressPct > 0 && (
        <div className="absolute bottom-1 left-1 right-1 h-1 bg-neutral-700 rounded-full overflow-hidden">
          <div className="h-full bg-red-600 rounded-full" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      <div className="opacity-0 group-hover:opacity-100 absolute inset-0 bg-black/60 rounded flex items-center justify-center transition-opacity">
        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 border-white flex items-center justify-center">
          <span className="text-white ml-0.5 text-sm sm:text-lg">&#9654;</span>
        </div>
      </div>
    </Link>
  );
}
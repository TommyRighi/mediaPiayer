import { useRef, useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function WatchPage() {
  const { mediaId, episodeId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const [media, setMedia] = useState(null);
  const [episode, setEpisode] = useState(null);

  const videoUrl = episodeId
    ? api.media.episodeVideoUrl(episodeId)
    : api.media.videoUrl(mediaId);

  useEffect(() => {
    api.media.get(mediaId).then((data) => {
      setMedia(data.media);
      if (episodeId && data.media.seasons) {
        for (const season of Object.values(data.media.seasons)) {
          const ep = season.find((e) => e.id === episodeId);
          if (ep) { setEpisode(ep); break; }
        }
      }
    }).catch((err) => { console.error('Failed to load media:', err); });
  }, [mediaId, episodeId]);

  const reportProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const seconds = Math.floor(video.currentTime);
    const completed = video.ended;
    api.watch.progress(mediaId, episodeId || null, seconds, completed).catch((err) => { console.error('Failed to report progress:', err); });
  }, [mediaId, episodeId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const interval = setInterval(reportProgress, 5000);
    video.addEventListener('ended', reportProgress);
    return () => {
      clearInterval(interval);
      video.removeEventListener('ended', reportProgress);
    };
  }, [reportProgress]);

  const title = episode
    ? `${media?.title} - S${episode.season_number}E${episode.episode_number} ${episode.title}`
    : media?.title || 'Loading...';

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <div className="flex items-center px-4 py-3 bg-black/90 z-10">
        <button
          onClick={() => navigate(-1)}
          className="text-gray-400 hover:text-white mr-4 text-2xl"
        >
          &#8592;
        </button>
        <h2 className="text-white text-lg font-medium truncate">{title}</h2>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          autoPlay
          className="max-w-full max-h-[calc(100vh-60px)]"
          crossOrigin="anonymous"
        />
      </div>
    </div>
  );
}

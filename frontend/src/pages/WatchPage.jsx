import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import VideoPlayer from '../components/VideoPlayer';

export default function WatchPage() {
  const { mediaId, episodeId } = useParams();
  const navigate = useNavigate();
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

  const subtitles = useMemo(() => {
    if (episodeId && episode?.subtitles) return episode.subtitles;
    if (!episodeId && media?.subtitles) return media.subtitles;
    return [];
  }, [episode, media, episodeId]);

  const nextEpisode = useMemo(() => {
    if (!media || !media.seasons || !episodeId) return null;
    const allEpisodes = Object.keys(media.seasons)
      .sort((a, b) => a - b)
      .flatMap((s) => media.seasons[s]);
    const idx = allEpisodes.findIndex((e) => e.id === episodeId);
    if (idx >= 0 && idx < allEpisodes.length - 1) return allEpisodes[idx + 1];
    return null;
  }, [media, episodeId]);

  const title = episode
    ? `${media?.title} - S${episode.season_number}E${episode.episode_number} ${episode.title}`
    : media?.title || 'Loading...';

  const handleProgress = useCallback((seconds, completed, duration) => {
    api.watch.progress(mediaId, episodeId || null, seconds, completed, duration).catch(() => {});
  }, [mediaId, episodeId]);

  const initialTime = useMemo(() => {
    const prog = episode?.watchProgress || media?.watchProgress;
    return prog?.progress_seconds || 0;
  }, [episode, media]);

  return (
    <VideoPlayer
      src={videoUrl}
      title={title}
      subtitles={subtitles}
      onBack={() => navigate(-1)}
      initialTime={initialTime}
      onProgress={handleProgress}
      onNextEpisode={nextEpisode ? () => navigate(`/watch/${mediaId}/${nextEpisode.id}`) : null}
      nextEpisodeLabel={nextEpisode ? `Next: S${nextEpisode.season_number}E${nextEpisode.episode_number}` : null}
    />
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import VideoPlayer from '../components/VideoPlayer';

export default function WatchPage() {
  const { mediaId, episodeId } = useParams();
  const navigate = useNavigate();
  const [media, setMedia] = useState(null);
  const [episode, setEpisode] = useState(null);
  const [transcodeStatus, setTranscodeStatus] = useState(null);

  const hlsAvailable = episodeId
    ? episode?.hls_available
    : media?.hls_available;

  const videoUrl = episodeId
    ? (hlsAvailable ? api.media.episodeHlsUrl(episodeId) : api.media.episodeVideoUrl(episodeId))
    : (hlsAvailable ? api.media.hlsUrl(mediaId) : api.media.videoUrl(mediaId));

  useEffect(() => {
    let timer;

    function poll() {
      api.transcode.status(mediaId, episodeId).then((data) => {
        setTranscodeStatus(data);
        if (data.status === 'converting' || data.status === 'pending') {
          timer = setTimeout(poll, 5000);
        }
      }).catch(() => {});
    }

    api.media.get(mediaId).then((data) => {
      setMedia(data.media);
      if (episodeId && data.media.seasons) {
        for (const season of Object.values(data.media.seasons)) {
          const ep = season.find((e) => e.id === episodeId);
          if (ep) { setEpisode(ep); break; }
        }
      }
    }).catch((err) => { console.error('Failed to load media:', err); });

    poll();
    return () => { clearTimeout(timer); };
  }, [mediaId, episodeId]);

  const subtitles = useMemo(() => {
    if (episodeId && episode?.subtitles) return episode.subtitles;
    if (!episodeId && media?.subtitles) return media.subtitles;
    return [];
  }, [episode, media, episodeId]);

  const audioTracks = useMemo(() => {
    if (episodeId && episode?.audio_tracks) return episode.audio_tracks;
    if (!episodeId && media?.audio_tracks) return media.audio_tracks;
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

  if (transcodeStatus && (transcodeStatus.status === 'pending' || transcodeStatus.status === 'converting')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="text-center">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="#f59e0b" className="mx-auto mb-4 animate-spin">
            <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z" />
          </svg>
          <h2 className="text-xl font-medium mb-2" style={{ color: 'var(--jf-text-primary)' }}>Converting Video</h2>
          <p className="mb-4" style={{ color: 'var(--jf-text-muted)' }}>
            This video is being converted to a browser-compatible format (H.264).
          </p>
          {transcodeStatus.progress > 0 && (
            <div className="max-w-xs mx-auto">
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${transcodeStatus.progress}%`, background: '#f59e0b' }}
                />
              </div>
              <p className="text-sm mt-2" style={{ color: 'var(--jf-text-muted)' }}>{transcodeStatus.progress}%</p>
            </div>
          )}
          <button onClick={() => navigate(-1)} className="jf-btn-secondary mt-6">Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <VideoPlayer
      src={videoUrl}
      title={title}
      subtitles={subtitles}
      audioTracks={audioTracks}
      onBack={() => navigate(-1)}
      initialTime={initialTime}
      onProgress={handleProgress}
      onNextEpisode={nextEpisode ? () => navigate(`/watch/${mediaId}/${nextEpisode.id}`) : null}
      nextEpisodeLabel={nextEpisode ? `Next: S${nextEpisode.season_number}E${nextEpisode.episode_number}` : null}
    />
  );
}

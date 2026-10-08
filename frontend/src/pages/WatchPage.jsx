import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api, hasMediaToken, refreshMediaToken } from '../api';
import VideoPlayer from '../components/VideoPlayer';
import PageState from '../components/PageState';

export default function WatchPage() {
  const { mediaId, episodeId } = useParams();
  const [params] = useSearchParams();
  // Reset all playback state on episode changes, including resume and failures.
  return <WatchSession key={`${mediaId}:${episodeId}:${params.get('start')}`} mediaId={mediaId} episodeId={episodeId} restart={params.get('start') === '0'} />;
}

function WatchSession({ mediaId, episodeId, restart }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [progressError, setProgressError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer;
    async function load() {
      try {
        const [result, conversion] = await Promise.all([
          api.media.get(mediaId, true), api.transcode.status(mediaId, episodeId),
          hasMediaToken() ? Promise.resolve() : refreshMediaToken(),
        ]);
        if (cancelled) return;
        const media = result.media;
        const episode = episodeId ? Object.values(media.seasons || {}).flat().find(ep => ep.id === episodeId) : null;
        if (episodeId && !episode) throw new Error('This episode is no longer available.');
        const item = episode || media;
        const pending = ['pending', 'converting', 'paused'].includes(conversion.status);
        setStatus(conversion);
        if (pending) {
          timer = setTimeout(load, 10000);
          return;
        }
        if (conversion.status === 'failed' || item.transcode_status === 'failed') {
          throw new Error('This video could not be prepared. Ask the administrator to retry its conversion.');
        }
        if (!item.file_path) throw new Error('This video has not been uploaded yet.');
        const src = episodeId
          ? (item.hls_available ? api.media.episodeHlsUrl(episodeId) : api.media.episodeVideoUrl(episodeId))
          : (item.hls_available ? api.media.hlsUrl(mediaId) : api.media.videoUrl(mediaId));
        setData({ media, episode, src });
      } catch (err) {
        if (!cancelled) setError(err.message || 'Check your connection and try again.');
      }
    }
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mediaId, episodeId, attempt]);

  const back = () => navigate(data?.media.type === 'series' || episodeId ? `/series/${mediaId}` : `/movie/${mediaId}`);
  const saveProgress = useCallback((seconds, completed, duration) => {
    api.watch.progress(mediaId, episodeId || null, seconds, completed, duration)
      .then(() => setProgressError(false)).catch(() => setProgressError(true));
  }, [mediaId, episodeId]);

  if (error) return <PageState title="Unable to start playback" message={error} retry={() => { setError(''); setAttempt(n => n + 1); }}><button className="jf-btn-secondary ml-3" onClick={back}>Back to details</button></PageState>;
  if (!data) {
    const paused = status?.status === 'paused';
    const preparing = ['pending', 'converting', 'paused'].includes(status?.status);
    const reasons = { playback: 'Preparation will resume when other playback finishes.', activity: 'Preparation will resume when the server is idle.', memory: 'Waiting for more available memory.', temperature: 'Waiting for the device to cool down.' };
    return <PageState busy={!paused} title={preparing ? paused ? 'Preparation paused' : 'Preparing your video' : 'Loading video'} message={paused ? reasons[status.reason] : preparing ? 'You can leave this page. Your video will be ready after preparation finishes.' : 'Getting your saved position and playback options.'}>
      {preparing && <><progress className="w-full mb-3" max="100" value={status.progress || 0} aria-label="Video preparation" /><p className="text-sm mb-6">{status.progress || 0}%</p><button className="jf-btn-secondary" onClick={back}>Back to library</button></>}
    </PageState>;
  }
  const { media, episode, src } = data;
  const item = episode || media;
  const progress = item.watchProgress;
  const episodes = Object.keys(media.seasons || {}).sort((a, b) => a - b).flatMap(s => media.seasons[s]);
  const index = episodes.findIndex(ep => ep.id === episodeId);
  const next = index >= 0 ? episodes[index + 1] : null;
  return <>
    {progressError && <div className="fixed top-14 left-4 z-50 bg-neutral-900 px-4 py-2 rounded text-sm" role="status">Unable to save your position. Retrying during playback.</div>}
    <VideoPlayer src={src} title={episode ? `${media.title} · S${episode.season_number} E${episode.episode_number} · ${episode.title}` : media.title}
      subtitles={item.subtitles} audioTracks={item.audio_tracks} onBack={back}
      initialTime={restart || progress?.completed ? 0 : progress?.progress_seconds || 0}
      onProgress={saveProgress} onNextEpisode={next ? () => navigate(`/watch/${mediaId}/${next.id}`) : null}
      nextEpisodeLabel={next ? `Next: S${next.season_number} E${next.episode_number}` : null} />
  </>;
}

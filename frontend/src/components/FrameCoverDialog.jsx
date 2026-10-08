import { useState, useEffect, useRef, useId } from 'react';
import { api } from '../api';
import usePlaybackActivity from '../hooks/usePlaybackActivity';

function time(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function FrameVideo({ source, hls, onFrame }) {
  const video = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  usePlaybackActivity(playing);
  useEffect(() => {
    const element = video.current;
    let disposed = false;
    let instance;
    if (hls && !element.canPlayType('application/vnd.apple.mpegurl')) {
      import('hls.js').then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) { setError('This browser cannot preview this video. Upload an image instead.'); return; }
        instance = new Hls({ maxBufferLength: 10, maxMaxBufferLength: 20 });
        instance.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) setError('Unable to load the video. You can upload an image instead.'); });
        instance.loadSource(source); instance.attachMedia(element);
      }).catch(() => { if (!disposed) setError('Unable to load video preview.'); });
    } else { element.src = source; element.load(); }
    return () => { disposed = true; element.pause(); instance?.destroy(); element.removeAttribute('src'); element.load(); };
  }, [source, hls]);
  function seek(delta) {
    const element = video.current;
    if (!Number.isFinite(element.duration)) return;
    element.currentTime = Math.max(0, Math.min(element.duration - 0.05, element.currentTime + delta));
  }
  function capture() {
    const element = video.current;
    if (element.readyState < 2 || element.seeking || !element.videoWidth) return;
    element.pause();
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(1920, element.videoWidth);
      canvas.height = Math.round(element.videoHeight * canvas.width / element.videoWidth);
      canvas.getContext('2d').drawImage(element, 0, 0, canvas.width, canvas.height);
      onFrame(canvas.toDataURL('image/png'));
    } catch { setError('Unable to capture this frame. Try uploading an image.'); }
  }
  return <>
    <video ref={video} controls playsInline preload="metadata" muted className="jf-frame-video" aria-label="Choose a frame from the video" onLoadedData={() => setReady(true)} onSeeking={() => setReady(false)} onSeeked={() => setReady(video.current.readyState >= 2)} onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setReady(false); setError('The video cannot be previewed in this browser. Upload an image instead.'); }} />
    {error && <p role="alert" className="text-sm mt-4">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 mt-4"><div className="flex items-center gap-2"><button className="jf-btn-secondary" disabled={!ready} onClick={() => seek(-1)} aria-label="Previous second">−1 s</button><span className="text-sm tabular-nums">{time(position)}</span><button className="jf-btn-secondary" disabled={!ready} onClick={() => seek(1)} aria-label="Next second">+1 s</button></div><button className="jf-btn-primary" disabled={!ready || !!error} onClick={capture}>Use this frame</button></div>
    {!ready && !error && <p role="status" className="text-sm mt-3">Loading frame…</p>}
  </>;
}

export default function FrameCoverDialog({ media, onFrame, onClose }) {
  const dialog = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const episodes = Object.values(media.seasons || {}).flat();
  const [episodeId, setEpisodeId] = useState(episodes.find(item => item.file_path && !['pending', 'converting'].includes(item.transcode_status))?.id || '');
  const episode = episodes.find(item => item.id === episodeId);
  const hls = episode ? episode.hls_available : media.hls_available;
  const source = episode ? hls ? api.media.episodeHlsUrl(episode.id) : api.media.episodeVideoUrl(episode.id) : hls ? api.media.hlsUrl(media.id) : api.media.videoUrl(media.id);
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className="jf-frame-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="flex justify-between items-start gap-4 mb-3"><h2 id={titleId} className="text-xl font-semibold">Choose a video frame</h2><button className="jf-btn-secondary" onClick={onClose} aria-label="Close frame selection">×</button></div>
    <p id={descriptionId} className="text-sm mb-5" style={{ color: 'var(--jf-text-secondary)' }}>Seek to the moment you want, then capture the frame. You can crop it before saving the cover.</p>
    {media.type === 'series' && <label className="block text-sm mb-4">Episode<select className="jf-input mt-2" value={episodeId} onChange={event => setEpisodeId(event.target.value)}><option value="" disabled>Choose an episode</option>{episodes.map(item => <option key={item.id} value={item.id} disabled={!item.file_path || ['pending', 'converting'].includes(item.transcode_status)}>S{item.season_number} E{item.episode_number} · {item.title}</option>)}</select></label>}
    {media.type === 'movie' || episode ? <FrameVideo key={source} source={source} hls={hls} onFrame={onFrame} /> : <p>No episodes available to preview. Upload an image instead.</p>}
  </dialog>;
}

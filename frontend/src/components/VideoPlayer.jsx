import { useRef, useEffect, useState } from 'react';
import Plyr from 'plyr';
import Hls from 'hls.js';
import 'plyr/css';
import { api, getToken } from '../api';
import usePlaybackActivity from '../hooks/usePlaybackActivity';

const EMPTY = [];
export default function VideoPlayer({ src, title, subtitles = EMPTY, onNextEpisode, nextEpisodeLabel, onBack, initialTime = 0, onProgress }) {
  const slotRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const progressRef = useRef(onProgress);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [tracks, setTracks] = useState([]);
  const [audioIndex, setAudioIndex] = useState(0);
  const [audioMenu, setAudioMenu] = useState(false);
  const retryPosition = useRef(initialTime);
  usePlaybackActivity(playing);

  useEffect(() => { progressRef.current = onProgress; }, [onProgress]);

  useEffect(() => {
    const slot = slotRef.current;
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'metadata';
    video.crossOrigin = 'anonymous';
    slot.appendChild(video);
    videoRef.current = video;
    let player;
    let hls;
    let applied = false;
    let completed = false;
    let timer;
    // Capture the callback for this media, including during cleanup.
    const save = (done = completed) => {
      if (video.readyState < 1 || !Number.isFinite(video.duration)) return;
      progressRef.current?.(Math.floor(video.currentTime), done, Math.floor(video.duration));
    };
    const seek = () => {
      if (applied || !Number.isFinite(video.duration)) return;
      if (retryPosition.current > 0) video.currentTime = Math.min(retryPosition.current, Math.max(0, video.duration - 1));
      applied = true;
    };
    const fail = () => {
      retryPosition.current = video.currentTime || retryPosition.current;
      setPlaying(false);
      setError('Playback stopped. Check your connection and try again.');
    };
    const onPlaying = () => {
      completed = false;
      setPlaying(true);
      clearInterval(timer);
      timer = setInterval(() => save(false), 20000);
    };
    const onPause = () => { setPlaying(false); clearInterval(timer); save(); };
    const onEnded = () => { completed = true; setPlaying(false); clearInterval(timer); save(true); };
    video.addEventListener('loadedmetadata', seek);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', fail);
    const pagehide = () => save();
    window.addEventListener('pagehide', pagehide);

    const createPlayer = () => {
      if (player) return;
      const heights = hls ? [...new Set(hls.levels.map(l => l.height).filter(Boolean))].sort((a, b) => b - a) : [];
      player = new Plyr(video, {
        controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'captions', 'pip', 'airplay', 'fullscreen'],
        autoplay: true, seekTime: 10, keyboard: { focused: true, global: true },
        captions: { active: false, update: true }, fullscreen: { iosNative: true },
        settings: heights.length > 1 ? ['captions', 'quality', 'speed'] : ['captions', 'speed'],
        ...(heights.length > 1 ? {
          quality: { default: 0, options: [0, ...heights], forced: true, onChange: height => {
            hls.currentLevel = height === 0 ? -1 : hls.levels.findIndex(l => l.height === height);
          } }, i18n: { qualityLabel: { 0: 'Auto' } },
        } : {}),
      });
      video.play().catch(() => { /* Browser may require a tap. Controls remain available. */ });
    };

    const isHls = new URL(src, window.location.href).pathname.endsWith('.m3u8');
    if (isHls && Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60,
        xhrSetup: xhr => { const token = getToken(); if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`); },
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, createPlayer);
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => setTracks(data.audioTracks));
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => setAudioIndex(data.id));
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(); });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      // Native HLS uses the short-lived HttpOnly media cookie for child URLs.
      video.src = src;
      createPlayer();
    }
    for (const sub of subtitles) {
      const track = document.createElement('track');
      track.kind = 'subtitles'; track.label = sub.label; track.srclang = sub.language;
      track.src = api.media.subtitleUrl(sub.id);
      video.appendChild(track);
    }
    return () => {
      save();
      clearInterval(timer);
      window.removeEventListener('pagehide', pagehide);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', fail);
      hls?.destroy();
      hlsRef.current = null;
      player?.destroy();
      slot.replaceChildren();
      videoRef.current = null;
    };
  }, [src, subtitles, attempt]);

  return (
    <div className={`vp-container ${subtitles.length ? '' : 'vp-no-subs'}`}>
      <div className="h-full" ref={slotRef} />
      <button onClick={onBack} className="vp-back-btn" aria-label="Back to details">←</button>
      <span className="vp-plyr-title">{title}</span>
      {error && <div className="absolute inset-0 z-30 grid place-items-center bg-black/90 p-6" role="alert">
        <div className="text-center max-w-sm"><h2 className="text-xl mb-3">Unable to play this video</h2><p className="text-sm text-neutral-300 mb-6">{error}</p>
          <button className="jf-btn-primary" onClick={() => { setError(''); setAttempt(n => n + 1); }}>Try again</button>
          <button className="jf-btn-secondary ml-3" onClick={onBack}>Back</button>
        </div>
      </div>}
      {tracks.length > 1 && <div className="vp-audio-selector">
        <button className="vp-audio-btn" aria-label="Audio language" aria-expanded={audioMenu} onClick={() => setAudioMenu(!audioMenu)}>♫</button>
        {audioMenu && <div className="vp-audio-menu">{tracks.map((track, index) => <button key={index} className={`vp-audio-item ${index === audioIndex ? 'vp-audio-item-active' : ''}`} onClick={() => { if (hlsRef.current) hlsRef.current.audioTrack = index; setAudioMenu(false); }}>{track.name || track.lang || `Track ${index + 1}`}{index === audioIndex ? ' ✓' : ''}</button>)}</div>}
      </div>}
      {onNextEpisode && <button className="vp-next-btn-overlay" onClick={onNextEpisode}>{nextEpisodeLabel || 'Next episode'} →</button>}
    </div>
  );
}

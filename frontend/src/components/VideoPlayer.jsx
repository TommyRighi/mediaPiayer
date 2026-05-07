import { useRef, useEffect, useState, useCallback } from 'react';
import Plyr from 'plyr';
import Hls from 'hls.js';
import 'plyr/css';
import { getToken } from '../api';

export default function VideoPlayer({ src, title, subtitles = [], audioTracks = [], onNextEpisode, nextEpisodeLabel, onBack, initialTime = 0, onProgress }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const hlsRef = useRef(null);
  const progressTimerRef = useRef(null);
  const initialTimeAppliedRef = useRef(false);
  const onNextEpisodeRef = useRef(onNextEpisode);
  const onProgressRef = useRef(onProgress);
  const [playing, setPlaying] = useState(false);
  const [hlsAudioTracks, setHlsAudioTracks] = useState([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState(-1);
  const [showAudioMenu, setShowAudioMenu] = useState(false);

  useEffect(() => {
    onNextEpisodeRef.current = onNextEpisode;
    onProgressRef.current = onProgress;
  });

  const handleProgress = useCallback(() => {
    const v = videoRef.current;
    if (v && onProgressRef.current) onProgressRef.current(Math.floor(v.currentTime), false, Math.floor(v.duration || 0));
  }, []);

  const isHls = src.endsWith('.m3u8');

  const switchAudioTrack = useCallback((idx) => {
    const hls = hlsRef.current;
    if (hls && hls.audioTracks && idx >= 0 && idx < hls.audioTracks.length) {
      hls.audioTrack = idx;
      setCurrentAudioTrack(idx);
    }
    setShowAudioMenu(false);
  }, []);

  useEffect(() => {
    if (!videoRef.current || playerRef.current) return;

    if (isHls && Hls.isSupported()) {
      window.Hls = Hls;
    }

    const player = new Plyr(videoRef.current, {
      controls: [
        'play-large', 'play', 'progress', 'current-time', 'duration',
        'mute', 'volume', 'settings', 'captions', 'pip', 'airplay',
        'fullscreen',
      ],
      settings: ['captions', 'speed', 'quality'],
      quality: { default: 0, options: [1080, 720, 480] },
      autopause: true,
      autoplay: true,
      invertTime: false,
      toggleInvert: true,
      keyboard: { focused: true, global: true },
      tooltips: { controls: true, seek: true },
      captions: { active: false, update: true },
      fullscreen: { iosNative: true },
      seekTime: 10,
    });

    playerRef.current = player;

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(videoRef.current);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (player.isReady) {
          const v = videoRef.current;
          if (v && initialTime > 0 && !initialTimeAppliedRef.current) {
            v.currentTime = initialTime;
            initialTimeAppliedRef.current = true;
          }
        }
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (event, data) => {
        setHlsAudioTracks(data.audioTracks);
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (event, data) => {
        setCurrentAudioTrack(data.id);
      });
    }

    player.on('playing', () => setPlaying(true));
    player.on('pause', () => setPlaying(false));
    player.on('ended', () => {
      const v = videoRef.current;
      if (v && onProgressRef.current) onProgressRef.current(Math.floor(v.duration || 0), true, Math.floor(v.duration || 0));
      if (!onNextEpisodeRef.current) setPlaying(false);
    });

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      player.destroy();
      playerRef.current = null;
      if (window.Hls === Hls) {
        delete window.Hls;
      }
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const existingTracks = v.querySelectorAll('track');
    existingTracks.forEach((t) => t.remove());

    for (const sub of subtitles) {
      const el = document.createElement('track');
      el.kind = 'subtitles';
      el.label = sub.label;
      el.srclang = sub.language;
      el.src = `/api/subtitles/${sub.id}?token=${getToken()}`;
      v.appendChild(el);
    }

    const container = containerRef.current;
    if (container) {
      if (subtitles.length === 0) {
        container.classList.add('vp-no-subs');
      } else {
        container.classList.remove('vp-no-subs');
      }
    }
  }, [subtitles]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || initialTime <= 0 || initialTimeAppliedRef.current) return;

    const seek = () => {
      v.currentTime = initialTime;
      initialTimeAppliedRef.current = true;
    };

    if (isHls) return;

    if (v.readyState >= 1) {
      seek();
    } else {
      v.addEventListener('loadedmetadata', seek, { once: true });
    }
  }, [initialTime]);

  useEffect(() => {
    if (!playing) {
      clearInterval(progressTimerRef.current);
      return;
    }
    progressTimerRef.current = setInterval(handleProgress, 5000);
    return () => clearInterval(progressTimerRef.current);
  }, [playing, handleProgress]);

  const displayAudioTracks = hlsAudioTracks.length > 0
    ? hlsAudioTracks
    : audioTracks;

  return (
    <div ref={containerRef} className="vp-container">
      <video
        ref={videoRef}
        src={isHls ? undefined : src}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
      />
      {onBack && (
        <button onClick={onBack} className="vp-back-btn" aria-label="Back">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
        </button>
      )}
      {title && <span className="vp-plyr-title">{title}</span>}
      {displayAudioTracks.length > 1 && (
        <div className="vp-audio-selector">
          <button
            onClick={() => setShowAudioMenu(!showAudioMenu)}
            className="vp-audio-btn"
            aria-label="Audio tracks"
            title="Audio tracks"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="white">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          </button>
          {showAudioMenu && (
            <div className="vp-audio-menu">
              {displayAudioTracks.map((track, idx) => {
                const label = track.name || track.label || track.language || `Track ${idx + 1}`;
                const isActive = isHls
                  ? currentAudioTrack === idx
                  : idx === 0;
                return (
                  <button
                    key={idx}
                    className={`vp-audio-item${isActive ? ' vp-audio-item-active' : ''}`}
                    onClick={() => switchAudioTrack(idx)}
                  >
                    {label}
                    {isActive && (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style={{ marginLeft: 'auto' }}>
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {onNextEpisode && (
        <button onClick={onNextEpisode} className="vp-next-btn-overlay" aria-label="Next episode">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="white"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
          {nextEpisodeLabel && <span>{nextEpisodeLabel}</span>}
        </button>
      )}
    </div>
  );
}

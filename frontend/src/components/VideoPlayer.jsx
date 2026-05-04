import { useRef, useEffect, useState, useCallback } from 'react';
import Plyr from 'plyr';
import 'plyr/css';

export default function VideoPlayer({ src, title, subtitles = [], onNextEpisode, nextEpisodeLabel, onBack, initialTime = 0, onProgress }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const progressTimerRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const handleProgress = useCallback(() => {
    const v = videoRef.current;
    if (v && onProgress) onProgress(Math.floor(v.currentTime), false, Math.floor(v.duration || 0));
  }, [onProgress]);

  useEffect(() => {
    if (!videoRef.current) return;

    const tracks = subtitles.map((sub) => ({
      kind: 'subtitles',
      label: sub.label,
      srclang: sub.language,
      src: `/api/subtitles/${sub.id}`,
      default: false,
    }));

    const existingTracks = videoRef.current.querySelectorAll('track');
    existingTracks.forEach((t) => t.remove());

    for (const track of tracks) {
      const el = document.createElement('track');
      el.kind = track.kind;
      el.label = track.label;
      el.srclang = track.srclang;
      el.src = track.src;
      if (track.default) el.default = true;
      videoRef.current.appendChild(el);
    }

    const player = new Plyr(videoRef.current, {
      controls: [
        'play-large', 'play', 'progress', 'current-time', 'duration',
        'mute', 'volume', 'settings', 'captions', 'pip', 'airplay',
        'fullscreen',
      ],
      settings: ['captions', 'speed'],
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

    player.on('playing', () => setPlaying(true));
    player.on('pause', () => setPlaying(false));

    if (onNextEpisode) {
      player.on('ended', () => {
        const v = videoRef.current;
        if (v && onProgress) onProgress(Math.floor(v.duration || 0), true, Math.floor(v.duration || 0));
      });
    } else {
      player.on('ended', () => {
        const v = videoRef.current;
        if (v && onProgress) onProgress(Math.floor(v.duration || 0), true, Math.floor(v.duration || 0));
        setPlaying(false);
      });
    }

    return () => {
      player.destroy();
      playerRef.current = null;
    };
  }, [subtitles, onNextEpisode, onProgress]);

  useEffect(() => {
    const v = videoRef.current;
    if (v && initialTime > 0) {
      const onLoaded = () => {
        v.currentTime = initialTime;
        v.removeEventListener('loadedmetadata', onLoaded);
      };
      if (v.readyState >= 1) {
        v.currentTime = initialTime;
      } else {
        v.addEventListener('loadedmetadata', onLoaded);
      }
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

  return (
    <div ref={containerRef} className="vp-container">
      <video
        ref={videoRef}
        src={src}
        autoPlay
        playsInline
        crossOrigin="anonymous"
      />
      {onBack && (
        <button onClick={onBack} className="vp-back-btn" aria-label="Back">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
        </button>
      )}
      {title && <span className="vp-plyr-title">{title}</span>}
      {onNextEpisode && (
        <button onClick={onNextEpisode} className="vp-next-btn-overlay" aria-label="Next episode">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="white"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
          {nextEpisodeLabel && <span>{nextEpisodeLabel}</span>}
        </button>
      )}
    </div>
  );
}

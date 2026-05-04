import { useRef, useEffect, useState, useCallback } from 'react';

const HIDE_DELAY = 3000;
const SKIP_SECONDS = 10;
const VOLUME_STEP = 0.05;
const SEEK_STEP = 5;

export default function VideoPlayer({ src, title, onNextEpisode, nextEpisodeLabel, onBack, initialTime = 0, onProgress }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const hideTimerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showCenterIcon, setShowCenterIcon] = useState(null);
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  const formatTime = (s) => {
    if (!s || isNaN(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    clearTimeout(hideTimerRef.current);
    if (playing) {
      hideTimerRef.current = setTimeout(() => {
        if (!seeking) setShowControls(false);
      }, HIDE_DELAY);
    }
  }, [playing, seeking]);

  const flashCenterIcon = useCallback((icon) => {
    setShowCenterIcon(icon);
    setTimeout(() => setShowCenterIcon(null), 400);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
      flashCenterIcon('play');
    } else {
      v.pause();
      setPlaying(false);
      flashCenterIcon('pause');
    }
    showControlsTemporarily();
  }, [showControlsTemporarily, flashCenterIcon]);

  const skip = useCallback((seconds) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.currentTime + seconds, v.duration || 0));
    flashCenterIcon(seconds > 0 ? 'forward' : 'backward');
    showControlsTemporarily();
  }, [showControlsTemporarily, flashCenterIcon]);

  const changeVolume = useCallback((delta) => {
    const v = videoRef.current;
    if (!v) return;
    const newVol = Math.max(0, Math.min(1, v.volume + delta));
    v.volume = newVol;
    setVolume(newVol);
    if (newVol > 0) { v.muted = false; setMuted(false); }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      c.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (initialTime > 0) {
      v.currentTime = initialTime;
    }
  }, [initialTime]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPlay = () => { setPlaying(true); showControlsTemporarily(); };
    const onPause = () => { setPlaying(false); setShowControls(true); };
    const onTimeUpdate = () => {
      setCurrentTime(v.currentTime);
      if (v.buffered.length > 0) {
        setBuffered(v.buffered.end(v.buffered.length - 1));
      }
    };
    const onDurationChange = () => setDuration(v.duration);
    const onEnded = () => {
      setPlaying(false);
      setShowControls(true);
      if (onProgress) onProgress(Math.floor(v.currentTime), true);
    };

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('durationchange', onDurationChange);
    v.addEventListener('ended', onEnded);

    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('durationchange', onDurationChange);
      v.removeEventListener('ended', onEnded);
    };
  }, [onProgress, showControlsTemporarily]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (v && onProgress) onProgress(Math.floor(v.currentTime), false);
    }, 5000);
    return () => clearInterval(id);
  }, [playing, onProgress]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(SEEK_STEP);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-SEEK_STEP);
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(VOLUME_STEP);
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(-VOLUME_STEP);
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'Escape':
          if (document.fullscreenElement) document.exitFullscreen();
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, skip, changeVolume, toggleFullscreen, toggleMute]);

  const getSeekPosition = (clientX, barEl) => {
    const rect = barEl.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pos * duration;
  };

  const handleSeekMouseDown = (e) => {
    setSeeking(true);
    setSeekValue(getSeekPosition(e.clientX, e.currentTarget));
  };

  const handleSeekMouseMove = (e) => {
    if (!seeking) return;
    setSeekValue(getSeekPosition(e.clientX, e.currentTarget));
  };

  const handleSeekMouseUp = () => {
    if (!seeking) return;
    const v = videoRef.current;
    if (v) v.currentTime = seekValue;
    setSeeking(false);
    setCurrentTime(seekValue);
  };

  const handleSeekTouchStart = (e) => {
    e.preventDefault();
    setSeeking(true);
    setSeekValue(getSeekPosition(e.touches[0].clientX, e.currentTarget));
  };

  const handleSeekTouchMove = (e) => {
    if (!seeking) return;
    e.preventDefault();
    setSeekValue(getSeekPosition(e.touches[0].clientX, e.currentTarget));
  };

  const handleSeekTouchEnd = () => {
    if (!seeking) return;
    const v = videoRef.current;
    if (v) v.currentTime = seekValue;
    setSeeking(false);
    setCurrentTime(seekValue);
  };

  const progress = duration > 0 ? ((seeking ? seekValue : currentTime) / duration) * 100 : 0;
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="vp-container"
      onMouseMove={showControlsTemporarily}
      onMouseLeave={() => { if (playing) setShowControls(false); }}
      onTouchStart={showControlsTemporarily}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay
        className="vp-video"
        playsInline
        crossOrigin="anonymous"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
      />

      {showCenterIcon && (
        <div className="vp-center-icon">
          {showCenterIcon === 'play' && (
            <svg viewBox="0 0 48 48" width="64" height="64"><path fill="white" d="M16 8l28 16-28 16V8z" /></svg>
          )}
          {showCenterIcon === 'pause' && (
            <svg viewBox="0 0 48 48" width="64" height="64"><rect fill="white" x="10" y="6" width="8" height="36" /><rect fill="white" x="30" y="6" width="8" height="36" /></svg>
          )}
          {showCenterIcon === 'forward' && (
            <svg viewBox="0 0 48 48" width="64" height="64"><path fill="white" d="M8 24l14-10v20L8 24z" /><path fill="white" d="M22 24l14-10v20L22 24z" /></svg>
          )}
          {showCenterIcon === 'backward' && (
            <svg viewBox="0 0 48 48" width="64" height="64"><path fill="white" d="M40 24l-14 10V14l14 10z" /><path fill="white" d="M26 24l-14 10V14l14 10z" /></svg>
          )}
        </div>
      )}

      <div className={`vp-controls ${showControls ? 'vp-controls-visible' : 'vp-controls-hidden'}`}>
        <div className="vp-top-bar">
          {onBack && (
            <button onClick={onBack} className="vp-btn" aria-label="Back">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
            </button>
          )}
          <span className="vp-title">{title}</span>
        </div>

        <div className="vp-bottom-section">
          <div
            className="vp-seek-bar"
            onMouseDown={handleSeekMouseDown}
            onMouseMove={handleSeekMouseMove}
            onMouseUp={handleSeekMouseUp}
            onMouseLeave={() => { if (seeking) { const v = videoRef.current; if (v) v.currentTime = seekValue; setSeeking(false); } }}
            onTouchStart={handleSeekTouchStart}
            onTouchMove={handleSeekTouchMove}
            onTouchEnd={handleSeekTouchEnd}
          >
            <div className="vp-seek-buffered" style={{ width: `${bufferedProgress}%` }} />
            <div className="vp-seek-progress" style={{ width: `${progress}%` }} />
            <div className="vp-seek-handle" style={{ left: `${progress}%` }} />
          </div>

          <div className="vp-bottom-bar">
            <div className="vp-left-controls">
              <button onClick={togglePlay} className="vp-btn vp-btn-touch" aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? (
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                )}
              </button>

              <button onClick={() => skip(-SKIP_SECONDS)} className="vp-btn vp-btn-touch" aria-label="Rewind 10s">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" /></svg>
              </button>

              <button onClick={() => skip(SKIP_SECONDS)} className="vp-btn vp-btn-touch" aria-label="Forward 10s">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" /></svg>
              </button>

              <div className="vp-volume-group">
                <button onClick={toggleMute} className="vp-btn vp-btn-touch" aria-label="Mute">
                  {muted || volume === 0 ? (
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.55-7.95-6.19-9.5v2.16c2.59 1.17 4.45 3.67 4.69 6.63zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.16c1.51-.32 2.9-.98 4.09-1.86L17.89 21 19.16 19.73l-8.89-8.9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
                  ) : volume < 0.5 ? (
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
                  )}
                </button>
                <div className="vp-volume-slider-wrap">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      const v = videoRef.current;
                      if (v) {
                        v.volume = parseFloat(e.target.value);
                        v.muted = false;
                      }
                      setVolume(parseFloat(e.target.value));
                      setMuted(false);
                    }}
                    className="vp-volume-slider"
                  />
                </div>
              </div>

              <span className="vp-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
            </div>

            <div className="vp-right-controls">
              {onNextEpisode && (
                <button onClick={onNextEpisode} className="vp-btn vp-next-btn" aria-label="Next episode">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
                  {nextEpisodeLabel && <span className="vp-next-label">{nextEpisodeLabel}</span>}
                </button>
              )}
              <button onClick={toggleFullscreen} className="vp-btn vp-btn-touch" aria-label="Fullscreen">
                {fullscreen ? (
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
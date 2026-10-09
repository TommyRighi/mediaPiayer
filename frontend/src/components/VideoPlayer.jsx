import { useRef, useEffect, useState } from 'react';
import Plyr from 'plyr';
import Hls from 'hls.js';
import 'plyr/css';
import { api, getToken, refreshMediaToken } from '../api';
import { useAuth } from '../context/AuthContext';
import { readPlayerPreferences, savePlayerPreferences, findPreferredAudioTrack } from '../playerPreferences';
import usePlaybackActivity from '../hooks/usePlaybackActivity';

const EMPTY = [];
export default function VideoPlayer({ src, title, subtitles = EMPTY, onNextEpisode, nextEpisodeLabel, onBack, initialTime = 0, onProgress }) {
  const { user } = useAuth();
  const userId = user?.id || 'guest';
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
  const recoveryAttempts = useRef(0);
  const [recovering, setRecovering] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [autoNext, setAutoNext] = useState(() => readPlayerPreferences(userId).autoNext);
  const nextRef = useRef(onNextEpisode);
  const hasNext = Boolean(onNextEpisode);
  usePlaybackActivity(playing);

  useEffect(() => { progressRef.current = onProgress; }, [onProgress]);
  useEffect(() => { nextRef.current = onNextEpisode; }, [onNextEpisode]);
  useEffect(() => {
    if (countdown === null || !autoNext || !hasNext) return;
    const timer = setTimeout(() => {
      if (countdown === 0) { setCountdown(null); nextRef.current?.(); }
      else setCountdown(countdown - 1);
    }, countdown === 0 ? 0 : 1000);
    return () => clearTimeout(timer);
  }, [countdown, autoNext, hasNext]);

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
    let recoveryTimer;
    let recoveryDeadline;
    let recoveryController;
    let disposed = false;
    let recoveryPending = false;
    let lastInteraction = 0;
    const markInteraction = () => { lastInteraction = Date.now(); };
    slot.addEventListener('pointerdown', markInteraction);
    slot.addEventListener('keydown', markInteraction);
    const preferences = readPlayerPreferences(userId);
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
    const nativeAudio = () => {
      if (hls || !video.audioTracks) return;
      const available = Array.from(video.audioTracks);
      setTracks(available.map(track => ({ name: track.label, lang: track.language })));
      const preferred = findPreferredAudioTrack(available, preferences.audioLanguage);
      if (preferred >= 0) available.forEach((track, index) => { track.enabled = index === preferred; });
      setAudioIndex(available.findIndex(track => track.enabled));
    };
    const fail = () => {
      retryPosition.current = video.currentTime || retryPosition.current;
      setPlaying(false);
      setRecovering(false);
      recoveryPending = false;
      clearTimeout(recoveryTimer);
      clearTimeout(recoveryDeadline);
      clearInterval(timer);
      recoveryController?.abort();
      setError('Playback stopped. Check your connection and try again.');
    };
    const recover = (kind) => {
      if (recoveryPending) return;
      if (recoveryAttempts.current >= 2) { fail(); return; }
      recoveryAttempts.current += 1;
      recoveryPending = true;
      applied = false;
      recoveryController = new AbortController();
      retryPosition.current = video.currentTime || retryPosition.current;
      save(false);
      setPlaying(false);
      setRecovering(true);
      clearInterval(timer);
      recoveryDeadline = setTimeout(fail, 15000);
      recoveryTimer = setTimeout(async () => {
        try {
          if (kind === 'media' && hls) hls.recoverMediaError();
          else {
            await refreshMediaToken(0, 2000, { signal: recoveryController.signal });
            if (disposed || !recoveryPending) return;
            if (hls) { hls.loadSource(src); hls.startLoad(retryPosition.current); }
            else { applied = false; video.load(); }
          }
          if (disposed) return;
        } catch { if (!disposed && recoveryPending) fail(); }
      }, 2000 * recoveryAttempts.current);
    };
    const onError = () => {
      if (hls) return; // HLS fatal errors are handled by its own event below.
      if (video.error?.code === 2) recover('network'); else fail();
    };
    const onCanPlay = () => {
      seek();
      if (!recoveryPending) return;
      video.play().catch(err => {
        if (disposed || !recoveryPending || err.name === 'AbortError') return;
        if (err.name === 'NotAllowedError') {
          recoveryPending = false;
          clearTimeout(recoveryDeadline);
          setRecovering(false);
        } else fail();
      });
    };
    const onPlaying = () => {
      completed = false;
      recoveryPending = false;
      clearTimeout(recoveryTimer);
      clearTimeout(recoveryDeadline);
      setRecovering(false);
      setCountdown(null);
      setPlaying(true);
      clearInterval(timer);
      timer = setInterval(() => save(false), 20000);
    };
    const onPause = () => { setPlaying(false); clearInterval(timer); save(); };
    const onEnded = () => { completed = true; setPlaying(false); clearInterval(timer); save(true); if (nextRef.current) setCountdown(10); };
    video.addEventListener('loadedmetadata', seek);
    video.addEventListener('loadedmetadata', nativeAudio);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    const pagehide = () => save();
    window.addEventListener('pagehide', pagehide);

    const createPlayer = () => {
      if (player) return;
      const heights = hls ? [...new Set(hls.levels.map(l => l.height).filter(Boolean))].sort((a, b) => b - a) : [];
      player = new Plyr(video, {
        controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'captions', 'pip', 'airplay', 'fullscreen'],
        autoplay: true, seekTime: 10, keyboard: { focused: true, global: true },
        storage: { enabled: false },
        captions: { active: preferences.subtitlesEnabled, language: preferences.subtitleLanguage, update: true }, fullscreen: { iosNative: true, container: '.vp-container' },
        settings: heights.length > 1 ? ['captions', 'quality', 'speed'] : ['captions', 'speed'],
        ...(heights.length > 1 ? {
          quality: { default: 0, options: [0, ...heights], forced: true, onChange: height => {
            hls.currentLevel = height === 0 ? -1 : hls.levels.findIndex(l => l.height === height);
          } }, i18n: { qualityLabel: { 0: 'Auto' } },
        } : {}),
      });
      player.once('ready', () => {
        player.on('captionsenabled captionsdisabled languagechange', () => {
          // Missing subtitles must not erase a preference saved on another video.
          if (!video.textTracks.length || Date.now() - lastInteraction > 1500) return;
          const selected = video.textTracks[player.currentTrack];
          savePlayerPreferences(userId, {
            subtitlesEnabled: player.captions.active,
            ...(selected?.language ? { subtitleLanguage: selected.language } : {}),
          });
        });
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
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
        setTracks(data.audioTracks);
        const preferred = findPreferredAudioTrack(data.audioTracks, readPlayerPreferences(userId).audioLanguage);
        if (preferred >= 0) hls.audioTrack = preferred;
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => setAudioIndex(data.id));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) recover('network');
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) recover('media');
        else fail();
      });
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
      disposed = true;
      save();
      clearInterval(timer);
      clearTimeout(recoveryTimer);
      clearTimeout(recoveryDeadline);
      recoveryController?.abort();
      slot.removeEventListener('pointerdown', markInteraction);
      slot.removeEventListener('keydown', markInteraction);
      window.removeEventListener('pagehide', pagehide);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('loadedmetadata', seek);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('loadedmetadata', nativeAudio);
      video.removeEventListener('error', onError);
      hls?.destroy();
      hlsRef.current = null;
      player?.destroy();
      slot.replaceChildren();
      videoRef.current = null;
    };
  }, [src, subtitles, attempt, userId]);

  return (
    <div className={`vp-container ${subtitles.length ? '' : 'vp-no-subs'}`}>
      <div className="h-full" ref={slotRef} />
      <button onClick={onBack} className="vp-back-btn" aria-label="Back to details">←</button>
      <span className="vp-plyr-title">{title}</span>
      {recovering && <div className="vp-recovery" role="status">Reconnecting…</div>}
      {error && <div className="absolute inset-0 z-30 grid place-items-center bg-black/90 p-6" role="alert">
        <div className="text-center max-w-sm"><h2 className="text-xl mb-3">Unable to play this video</h2><p className="text-sm text-neutral-300 mb-6">{error}</p>
          <button className="jf-btn-primary" onClick={() => { recoveryAttempts.current = 0; setError(''); setAttempt(n => n + 1); }}>Try again</button>
          <button className="jf-btn-secondary ml-3" onClick={onBack}>Back</button>
        </div>
      </div>}
      {tracks.length > 1 && <div className="vp-audio-selector">
        <button className="vp-audio-btn" aria-label="Audio language" aria-expanded={audioMenu} onClick={() => setAudioMenu(!audioMenu)}>♫</button>
        {audioMenu && <div className="vp-audio-menu">{tracks.map((track, index) => <button key={index} className={`vp-audio-item ${index === audioIndex ? 'vp-audio-item-active' : ''}`} onClick={() => {
          if (hlsRef.current) hlsRef.current.audioTrack = index;
          else if (videoRef.current?.audioTracks) Array.from(videoRef.current.audioTracks).forEach((audio, i) => { audio.enabled = i === index; });
          setAudioIndex(index);
          savePlayerPreferences(userId, { audioLanguage: track.lang || track.language || track.name || '' }); setAudioMenu(false);
        }}>{track.name || track.lang || `Track ${index + 1}`}{index === audioIndex ? ' ✓' : ''}</button>)}</div>}
      </div>}
      {onNextEpisode && <button className="vp-next-btn-overlay" onClick={onNextEpisode}>{nextEpisodeLabel || 'Next episode'} →</button>}
      {onNextEpisode && <div className="vp-autonext">
        <label><input type="checkbox" checked={autoNext} onChange={event => { setAutoNext(event.target.checked); setCountdown(null); savePlayerPreferences(userId, { autoNext: event.target.checked }); }} /> Automatically play next episode</label>
        {countdown !== null && autoNext && <div role="status"><p>{nextEpisodeLabel || 'Next episode'} in {countdown}s</p><button className="jf-btn-secondary" onClick={() => setCountdown(null)}>Stay here</button><button className="jf-btn-primary" onClick={() => { setCountdown(null); onNextEpisode(); }}>Play now</button></div>}
      </div>}
    </div>
  );
}

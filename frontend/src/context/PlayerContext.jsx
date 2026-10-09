/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { api } from '../api';
import useJam from '../hooks/useJam';
import usePlaybackActivity from '../hooks/usePlaybackActivity';

const PlayerContext = createContext(null);

export function usePlayer() {
  return useContext(PlayerContext);
}

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const progressTimerRef = useRef(null);

  const [soloQueue, setQueue] = useState([]);
  const [soloIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => parseFloat(localStorage.getItem('music-volume') || '0.8'));
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [progressMap, setProgressMap] = useState({});
  const progressLoaded = useRef(false);

  const jam = useJam(audioRef);
  const { id: jamId, state: jamState, canControl: jamCanControl, control: jamControl, add: jamAdd, connected: jamConnected, isHost: jamIsHost } = jam;
  const soloBeforeJam = useRef(null);
  const restoreTime = useRef(null);
  const queue = jamState ? jamState.queue : soloQueue;
  const currentIndex = jamState ? queue.findIndex(track => track.entry_id === jamState.jam.current_entry_id) : soloIndex;
  const [audioStatus, setAudioStatus] = useState('');
  const [audioError, setAudioError] = useState('');
  const [streamAttempt, setStreamAttempt] = useState(0);
  const preparing = useRef(false);
  const preparationAttempts = useRef(0);
  const [preparationRequest, setPreparationRequest] = useState(0);
  usePlaybackActivity(playing);

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  const trackId = currentTrack?.id;
  const streamUrl = useMemo(() => trackId ? api.music.tracks.streamUrl(trackId) + (streamAttempt ? `?prepared=${streamAttempt}` : '') : undefined, [trackId, streamAttempt]);

  useEffect(() => {
    if (!currentTrack || progressLoaded.current) return;
    progressLoaded.current = true;
    api.music.progress.list().then(data => {
      const map = {};
      for (const p of data) map[p.track_id] = p;
      setProgressMap(map);
    }).catch(() => { progressLoaded.current = false; });
  }, [currentTrack]);

  const playTrack = useCallback((track, trackList) => {
    if (jamId) { void jamAdd(track.id); return; }
    const list = trackList || [track];
    let idx = list.findIndex(t => t.id === track.id);
    if (idx === -1) idx = 0;
    setQueue(list);
    setCurrentIndex(idx);
    setPlaying(true);
  }, [jamId, jamAdd]);

  const playQueue = useCallback((tracks, startIdx = 0) => {
    if (jamId) { void jamAdd(tracks[startIdx]?.id); return; }
    setQueue(tracks);
    setCurrentIndex(startIdx);
    setPlaying(true);
  }, [jamId, jamAdd]);

  const togglePlay = useCallback(() => {
    if (jamId) { if (jamCanControl) void jamControl(jamState?.jam.is_playing ? 'pause' : 'play'); return; }
    setPlaying(prev => !prev);
  }, [jamId, jamCanControl, jamControl, jamState]);

  const next = useCallback(() => {
    if (jamId) { if (jamCanControl) void jamControl('next'); return; }
    setCurrentIndex(prev => {
      if (shuffle) {
        const nextIdx = Math.floor(Math.random() * queue.length);
        return nextIdx;
      }
      if (prev >= queue.length - 1) {
        if (repeat === 'all') return 0;
        setPlaying(false);
        return prev;
      }
      return prev + 1;
    });
  }, [queue.length, shuffle, repeat, jamId, jamCanControl, jamControl]);

  const prev = useCallback(() => {
    if (jamId) { if (jamCanControl) void jamControl('previous'); return; }
    setCurrentIndex(prevIdx => {
      if (prevIdx <= 0) {
        if (repeat === 'all') return queue.length - 1;
        return 0;
      }
      return prevIdx - 1;
    });
  }, [queue.length, repeat, jamId, jamCanControl, jamControl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (jamId) return;
    if (playing && currentTrack) {
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [playing, currentTrack, jamId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    localStorage.setItem('music-volume', String(volume));
  }, [volume]);

  useEffect(() => {
    if (!playing) {
      clearInterval(progressTimerRef.current);
      return;
    }
    progressTimerRef.current = setInterval(() => {
      const audio = audioRef.current;
      if (!audio || !trackId) return;
      const time = Math.floor(audio.currentTime);
      const dur = Math.floor(audio.duration || 0);
      if (time > 0) {
        api.music.progress.save(trackId, time, dur, false).catch(() => {});
        setProgressMap(prev => ({
          ...prev,
          [trackId]: { ...prev[trackId], progress_seconds: time, duration: dur },
        }));
      }
    }, 20000);
    return () => clearInterval(progressTimerRef.current);
  }, [playing, trackId]);

  const handleEnded = useCallback(() => {
    if (jamId) { if (jamIsHost) void jamControl('ended', { entryId: currentTrack?.entry_id }); return; }
    if (repeat === 'one') {
      const audio = audioRef.current;
      if (audio) { audio.currentTime = 0; audio.play(); }
      return;
    }
    if (currentTrack) {
      api.music.progress.save(currentTrack.id, Math.floor(duration), duration, true).catch(() => {});
    }
    if (currentIndex >= queue.length - 1 && repeat !== 'all') {
      setPlaying(false);
      if (currentTrack) {
        setProgressMap(prev => ({
          ...prev,
          [currentTrack.id]: { ...prev[currentTrack.id], progress_seconds: duration, completed: 1 },
        }));
      }
      return;
    }
    next();
  }, [repeat, currentIndex, queue.length, next, currentTrack, duration, jamId, jamIsHost, jamControl]);

  const seek = useCallback((time) => {
    if (jamId) { if (jamCanControl) void jamControl('seek', { position: time }); return; }
    const audio = audioRef.current;
    if (audio) audio.currentTime = time;
  }, [jamId, jamCanControl, jamControl]);

  useEffect(() => {
    preparing.current = false; preparationAttempts.current = 0;
    const timer = setTimeout(() => { setAudioError(''); setAudioStatus(''); },0);
    return () => clearTimeout(timer);
  }, [trackId]);

  async function prepareAudio(manual = false) {
    if (!trackId || preparing.current) return;
    if (!manual && preparationAttempts.current >= 1) { setAudioError('This audio cannot be played. Retry preparation or ask the administrator to replace the file.'); return; }
    preparationAttempts.current++;
    preparing.current = true; setPlaying(false); setAudioStatus('Preparing audio'); setAudioError('');
    try { await api.music.tracks.prepare(trackId, manual); setPreparationRequest(value => value + 1); }
    catch (err) { preparing.current = false; setAudioStatus(''); setAudioError(err.message); }
  }
  function retryAudio() {
    if (audioRef.current?.error?.code === 2) {
      setAudioError(''); setStreamAttempt(value => value + 1);
      if (!jamId) setPlaying(true);
    } else void prepareAudio(true);
  }
  useEffect(() => {
    if (!trackId) return;
    let cancelled = false, timer;
    const check = async () => {
      try {
        const track = await api.music.tracks.get(trackId);
        if (cancelled) return;
        if (['pending','converting'].includes(track.playback_status)) {
          preparing.current = true; setPlaying(false); setAudioStatus('Preparing audio. You can keep browsing.');
          timer = setTimeout(check,5000);
        } else if (track.playback_status === 'failed') {
          preparing.current = false; setAudioStatus(''); setAudioError(track.playback_error || 'Unable to prepare audio.');
        } else if (preparing.current) {
          preparing.current = false; setAudioStatus(''); setStreamAttempt(value => value + 1);
          if (!jamId) setPlaying(true);
        } else if (!track.playback_path && audioRef.current && !audioRef.current.canPlayType({ mp3:'audio/mpeg',flac:'audio/flac',ogg:'audio/ogg',wav:'audio/wav',m4a:'audio/mp4',aac:'audio/aac',opus:'audio/ogg; codecs=opus',wma:'audio/x-ms-wma' }[track.file_path.split('.').pop().toLowerCase()] || '')) {
          preparing.current = true; setPlaying(false); setAudioStatus('Preparing audio'); await api.music.tracks.prepare(trackId);
          if (!cancelled) timer = setTimeout(check,5000);
        } else timer = setTimeout(check,10000);
      } catch (err) { if (!cancelled) { setAudioError(err.message); timer = setTimeout(check,10000); } }
    };
    void check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [trackId, jamId, preparationRequest]);

  async function startJam() {
    if (!currentTrack || jamId) return;
    soloBeforeJam.current = { queue: soloQueue,index: soloIndex,time: audioRef.current?.currentTime || 0,playing };
    await jam.start(queue.slice(currentIndex));
  }
  async function leaveJam() {
    if (!await jam.leave()) return;
    const previous = soloBeforeJam.current;
    if (previous) {
      if (previous.queue[previous.index]?.id === trackId && audioRef.current?.readyState >= 1) audioRef.current.currentTime = previous.time;
      else restoreTime.current = previous.time;
      setQueue(previous.queue); setCurrentIndex(previous.index); setPlaying(false);
      // Returning to solo listening is explicit; its existing queue is retained.
      soloBeforeJam.current = null;
    }
  }
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = currentTrack ? new MediaMetadata({ title: currentTrack.title, artist: currentTrack.artist || '',
      artwork: [{ src: new URL(api.music.tracks.coverUrl(currentTrack.id), location.origin).href }] }) : null;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    const allowed = !jamId || jamCanControl && jamConnected;
    const actions = {
      play: () => jamId ? jamControl('play') : setPlaying(true),
      pause: () => jamId ? jamControl('pause') : setPlaying(false),
      previoustrack: prev, nexttrack: next,
      seekto: event => seek(event.seekTime),
      seekbackward: event => seek(Math.max(0,(audioRef.current?.currentTime || 0) - (event.seekOffset || 10))),
      seekforward: event => seek(Math.min(audioRef.current?.duration || Infinity,(audioRef.current?.currentTime || 0) + (event.seekOffset || 10))),
    };
    for (const [name,handler] of Object.entries(actions)) {
      try { navigator.mediaSession.setActionHandler(name, allowed ? handler : null); } catch { /* Action unavailable in this browser. */ }
    }
    return () => { for (const name of Object.keys(actions)) try { navigator.mediaSession.setActionHandler(name,null); } catch { /* Unsupported action. */ } };
  }, [currentTrack, playing, jamId, jamCanControl, jamConnected, jamControl, next, prev, seek]);

  const value = {
    jam, startJam, leaveJam, audioStatus, audioError, prepareAudio, retryAudio,

    queue,
    currentIndex,
    currentTrack,
    playing,
    currentTime,
    duration,
    volume,
    shuffle,
    repeat,
    progressMap,
    playTrack,
    playQueue,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    setShuffle,
    setRepeat,
    setPlaying,
    setCurrentTime,
    setDuration,
    handleEnded,
    audioRef,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        src={streamUrl}
        onLoadedMetadata={() => {
          if (!jamId && restoreTime.current !== null) { audioRef.current.currentTime = Math.min(restoreTime.current,audioRef.current.duration || 0); restoreTime.current = null; }
          jam.sync();
        }}
        onCanPlay={() => { if (jamId) jam.sync(); else if (playing) audioRef.current?.play().catch(() => setPlaying(false)); }}
        onError={() => {
          setPlaying(false);
          if (audioRef.current?.error?.code === 2) setAudioError('Connection interrupted. Try loading the audio again.');
          else if (!preparing.current) void prepareAudio();
        }}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (audio) setCurrentTime(Math.floor(audio.currentTime));
        }}
        onDurationChange={() => {
          const audio = audioRef.current;
          if (audio) setDuration(audio.duration || 0);
        }}
        onEnded={handleEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          const audio = audioRef.current;
          if (currentTrack && audio?.currentTime > 0 && Number.isFinite(audio.duration)) api.music.progress.save(currentTrack.id, Math.floor(audio.currentTime), Math.floor(audio.duration), audio.ended).catch(() => {});
        }}
        preload="auto"
      />
    </PlayerContext.Provider>
  );
}

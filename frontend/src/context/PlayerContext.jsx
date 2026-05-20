/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { api } from '../api';

const PlayerContext = createContext(null);

export function usePlayer() {
  return useContext(PlayerContext);
}

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const progressTimerRef = useRef(null);

  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => parseFloat(localStorage.getItem('music-volume') || '0.8'));
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [progressMap, setProgressMap] = useState({});

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  useEffect(() => {
    api.music.progress.list().then(data => {
      const map = {};
      for (const p of data) map[p.track_id] = p;
      setProgressMap(map);
    }).catch(() => {});
  }, []);

  const playTrack = useCallback((track, trackList) => {
    const list = trackList || [track];
    let idx = list.findIndex(t => t.id === track.id);
    if (idx === -1) idx = 0;
    setQueue(list);
    setCurrentIndex(idx);
    setPlaying(true);
  }, []);

  const playQueue = useCallback((tracks, startIdx = 0) => {
    setQueue(tracks);
    setCurrentIndex(startIdx);
    setPlaying(true);
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying(prev => !prev);
  }, []);

  const next = useCallback(() => {
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
  }, [queue.length, shuffle, repeat]);

  const prev = useCallback(() => {
    setCurrentIndex(prevIdx => {
      if (prevIdx <= 0) {
        if (repeat === 'all') return queue.length - 1;
        return 0;
      }
      return prevIdx - 1;
    });
  }, [queue.length, repeat]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing && currentTrack) {
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [playing, currentTrack]);

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
      if (!audio || !currentTrack) return;
      const time = Math.floor(audio.currentTime);
      const dur = Math.floor(audio.duration || 0);
      if (time > 0) {
        api.music.progress.save(currentTrack.id, time, dur, false).catch(() => {});
        setProgressMap(prev => ({
          ...prev,
          [currentTrack.id]: { ...prev[currentTrack.id], progress_seconds: time, duration: dur },
        }));
      }
    }, 10000);
    return () => clearInterval(progressTimerRef.current);
  }, [playing, currentTrack]);

  const handleEnded = useCallback(() => {
    if (repeat === 'one') {
      const audio = audioRef.current;
      if (audio) { audio.currentTime = 0; audio.play(); }
      return;
    }
    if (currentIndex >= queue.length - 1 && repeat !== 'all') {
      setPlaying(false);
      if (currentTrack) {
        api.music.progress.save(currentTrack.id, Math.floor(duration), duration, true).catch(() => {});
        setProgressMap(prev => ({
          ...prev,
          [currentTrack.id]: { ...prev[currentTrack.id], progress_seconds: duration, completed: 1 },
        }));
      }
      return;
    }
    next();
  }, [repeat, currentIndex, queue.length, next, currentTrack, duration]);

  const seek = useCallback((time) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = time;
  }, []);

  const value = {
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
        src={currentTrack ? api.music.tracks.streamUrl(currentTrack.id) : undefined}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (audio) setCurrentTime(audio.currentTime);
        }}
        onDurationChange={() => {
          const audio = audioRef.current;
          if (audio) setDuration(audio.duration || 0);
        }}
        onEnded={handleEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        preload="auto"
      />
    </PlayerContext.Provider>
  );
}
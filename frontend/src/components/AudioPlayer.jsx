import { useState, useRef, useEffect } from 'react';
import { usePlayer } from '../context/PlayerContext';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AudioPlayer() {
  const player = usePlayer();
  const navigate = useNavigate();
  const progressRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const [showVol, setShowVol] = useState(false);
  const [showQueue, setShowQueue] = useState(false);

  const { currentTrack, playing, currentTime, duration, volume, shuffle, repeat } = player;

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e) => {
      const bar = progressRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      setDragTime(pct * duration);
    };
    const handleUp = () => {
      player.seek(dragTime);
      setDragging(false);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [dragging, dragTime, duration, player]);

  if (!currentTrack) return null;

  const progress = duration > 0 ? ((dragging ? dragTime : currentTime) / duration) * 100 : 0;

  return (
    <div className="ap-bar">
      <div className="ap-progress-bar" ref={progressRef}
        onMouseDown={(e) => {
          setDragging(true);
          const rect = progressRef.current.getBoundingClientRect();
          const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          setDragTime(pct * duration);
        }}
      >
        <div className="ap-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="ap-content">
        <div className="ap-track-info" onClick={() => currentTrack.album_id && navigate(`/music/album/${currentTrack.album_id}`)}>
          {currentTrack.album_id ? (
            <img src={api.music.albums.coverUrl(currentTrack.album_id)} alt="" className="ap-cover" />
          ) : (
            <div className="ap-cover ap-cover-placeholder">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
            </div>
          )}
          <div className="ap-track-text">
            <div className="ap-track-title">{currentTrack.title}</div>
            <div className="ap-track-artist">{currentTrack.artist || 'Unknown'}</div>
          </div>
        </div>

        <div className="ap-controls">
          <button className={"ap-btn" + (shuffle ? ' ap-btn-active' : '')} onClick={() => player.setShuffle(!shuffle)} title="Shuffle">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" /></svg>
          </button>
          <button className="ap-btn" onClick={player.prev} title="Previous">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
          </button>
          <button className="ap-btn ap-btn-play" onClick={player.togglePlay} title={playing ? 'Pause' : 'Play'}>
            {playing ? (
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <button className="ap-btn" onClick={player.next} title="Next">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
          </button>
          <button className={"ap-btn" + (repeat !== 'off' ? ' ap-btn-active' : '')} onClick={() => player.setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')} title={`Repeat: ${repeat}`}>
            {repeat === 'one' ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" /><text x="12" y="14" textAnchor="middle" fontSize="7" fill="currentColor" fontWeight="bold">1</text></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" /></svg>
            )}
          </button>
        </div>

        <div className="ap-right">
          <span className="ap-time">{formatTime(dragging ? dragTime : currentTime)}</span>
          <span className="ap-time-sep">/</span>
          <span className="ap-time">{formatTime(duration)}</span>

          <div className="ap-volume-wrapper" onMouseEnter={() => setShowVol(true)} onMouseLeave={() => setShowVol(false)}>
            <button className="ap-btn" onClick={() => player.setVolume(volume > 0 ? 0 : 0.8)} title="Volume">
              {volume === 0 ? (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
              ) : volume < 0.5 ? (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
              )}
            </button>
            {showVol && (
              <div className="ap-volume-slider">
                <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => player.setVolume(parseFloat(e.target.value))} className="ap-volume-input" />
              </div>
            )}
          </div>

          <button className="ap-btn" onClick={() => setShowQueue(!showQueue)} title="Queue">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" /></svg>
          </button>
        </div>
      </div>

      {showQueue && (
        <div className="ap-queue-panel">
          <div className="ap-queue-header">
            <span className="ap-queue-title">Queue</span>
            <button className="ap-btn" onClick={() => setShowQueue(false)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
            </button>
          </div>
          <div className="ap-queue-list">
            {player.queue.map((track, idx) => (
              <div
                key={track.id}
                className={`ap-queue-item ${idx === player.currentIndex ? 'ap-queue-item-active' : ''}`}
                onClick={() => { player.playQueue(player.queue, idx); }}
              >
                <span className="ap-queue-num">{idx + 1}</span>
                <span className="ap-queue-track">{track.title}</span>
                <span className="ap-queue-artist">{track.artist || 'Unknown'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
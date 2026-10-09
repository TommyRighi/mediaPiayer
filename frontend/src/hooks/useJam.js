import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function useJam(audioRef) {
  const { user } = useAuth();
  const storageKey = `music-jam:${user.id}`;
  const [id, setId] = useState(() => { try { return localStorage.getItem(storageKey); } catch { return null; } });
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [needsPlay, setNeedsPlay] = useState(false);
  const live = useRef(false);
  const latest = useRef(null);
  const latency = useRef(0);
  const generation = useRef(0);
  const isHost = state?.jam.host_user_id === user.id;
  const canControl = Boolean(isHost || state?.jam.shared_controls);

  const clear = useCallback(() => {
    live.current = false; latest.current = null; setState(null); setId(null); setConnected(false); setNeedsPlay(false);
    audioRef.current?.pause();
    try { localStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
  }, [audioRef, storageKey]);
  const accept = useCallback(data => {
    if (data.type === 'closed') { clear(); setError('The host ended this Jam.'); return; }
    if (latest.current && latest.current.data.jam.id === data.jam.id && data.jam.revision < latest.current.data.jam.revision) return;
    latest.current = { data, receivedAt: performance.now() };
    setState(data);
  }, [clear]);
  const sync = useCallback(() => {
    const audio = audioRef.current, snapshot = latest.current;
    if (!audio || !snapshot || !live.current || audio.readyState < 1) return;
    const { jam, queue } = snapshot.data;
    const track = queue.find(item => item.entry_id === jam.current_entry_id);
    if (!track || !audio.currentSrc.includes(`/tracks/${encodeURIComponent(track.id)}/stream`)) return;
    const elapsed = jam.is_playing ? (performance.now() - snapshot.receivedAt + latency.current) / 1000 : 0;
    const target = Math.min(jam.position + elapsed, Number.isFinite(audio.duration) ? Math.max(0,audio.duration - 0.05) : Infinity);
    const drift = target - audio.currentTime;
    if (Math.abs(drift) > 0.65 || !jam.is_playing && Math.abs(drift) > 0.1) audio.currentTime = target;
    // Small differences are corrected gently without audible repeated seeking.
    audio.playbackRate = jam.is_playing && Math.abs(drift) > 0.12 && Math.abs(drift) <= 0.65 ? drift > 0 ? 1.02 : 0.98 : 1;
    if (jam.is_playing && audio.paused) audio.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true));
    else if (!jam.is_playing) audio.pause();
  }, [audioRef]);

  useEffect(() => { if (state && connected) sync(); }, [state, connected, sync]);
  useEffect(() => {
    if (!id) return;
    const audio = audioRef.current;
    let disposed = false, socket, reconnect, heartbeat, retry = 0;
    const attach = async () => {
      try {
        const started = performance.now();
        const data = await api.music.jams.get(id);
        if (disposed) return;
        latency.current = Math.min(1000,(performance.now() - started) / 2);
        accept(data);
        socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/music/jams/${id}/ws`);
        socket.onopen = () => { live.current = true; retry = 0; setConnected(true); setError(''); };
        socket.onmessage = event => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'pong') latency.current = Math.min(1000,Math.max(0,(performance.now() - message.sentAt) / 2));
            else accept(message);
          } catch { /* Ignore malformed server messages. */ }
        };
        heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:'ping',sentAt:performance.now() })); },5000);
        socket.onclose = event => {
          clearInterval(heartbeat); live.current = false; setConnected(false); audioRef.current?.pause();
          if (disposed) return;
          if ([4001,4003].includes(event.code)) { clear(); setError(event.code === 4003 ? 'You left the Jam.' : 'Sign in again or enable shared listening.'); return; }
          reconnect = setTimeout(attach,Math.min(10000,1000 * 2 ** retry++));
        };
      } catch (err) {
        if (disposed) return;
        setError(err.message); setConnected(false); audioRef.current?.pause();
        if ([401,403,404].includes(err.status)) clear();
        else reconnect = setTimeout(attach,Math.min(10000,1000 * 2 ** retry++));
      }
    };
    void attach();
    return () => { live.current = false; disposed = true; clearTimeout(reconnect); clearInterval(heartbeat); socket?.close(); audio?.pause(); if (audio) audio.playbackRate = 1; };
  }, [id, accept, clear, audioRef]);

  const enter = useCallback(async promise => {
    const turn = ++generation.current;
    try {
      const data = await promise;
      if (turn !== generation.current) return;
      accept(data); setId(data.jam.id); setError('');
      try { localStorage.setItem(storageKey,data.jam.id); } catch { /* Storage is optional. */ }
      return data;
    } catch (err) { setError(err.message); throw err; }
  }, [accept, storageKey]);
  const control = useCallback(async (action, extra = {}) => {
    const snapshot = latest.current;
    if (!snapshot || !live.current) return;
    try { const data = await api.music.jams.control(snapshot.data.jam.id,{ action,revision:snapshot.data.jam.revision,...extra }); accept(data); setError(''); }
    catch (err) { setError(err.message); if (err.status === 409) { try { accept(await api.music.jams.get(snapshot.data.jam.id)); } catch { /* Reconnect handles unavailable rooms. */ } } }
  }, [accept]);
  const add = useCallback(async trackId => {
    if (!id) return;
    try { accept(await api.music.jams.add(id,trackId)); setError(''); } catch (err) { setError(err.message); }
  }, [id, accept]);
  const leave = useCallback(async () => {
    if (id) {
      try { await api.music.jams.leave(id); }
      catch (err) { if (![403,404].includes(err.status)) { setError(err.message); return false; } }
    }
    generation.current++; clear(); return true;
  }, [id,clear]);
  return { id,state,connected,error,needsPlay,isHost,canControl,sync,control,add,leave,
    start: tracks => enter(api.music.jams.create(tracks.map(track => track.id))),
    join: code => enter(api.music.jams.join(code)),
    resume: () => { audioRef.current?.play().then(() => { setNeedsPlay(false); sync(); }).catch(() => setNeedsPlay(true)); } };
}

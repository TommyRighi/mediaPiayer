import { useEffect, useRef } from 'react';
import { api } from '../api';

export default function usePlaybackActivity(playing) {
  const session = useRef(null);
  useEffect(() => {
    session.current ||= globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const send = active => api.watch.activity(session.current, active).catch(() => {});
    if (!playing) return;
    send(true);
    const interval = setInterval(() => send(true), 20000);
    const stop = () => send(false);
    window.addEventListener('pagehide', stop);
    return () => {
      clearInterval(interval);
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, [playing]);
}

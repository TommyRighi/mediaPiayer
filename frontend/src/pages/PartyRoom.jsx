import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, getToken } from '../api';

export default function PartyRoom() {
  const { partyId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const wsRef = useRef(null);

  const [party, setParty] = useState(null);
  const [members, setMembers] = useState([]);
  const [synced, setSynced] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);

  const token = getToken();
  const isMovie = party?.media_type === 'movie';
  const videoUrl = isMovie
    ? api.media.videoUrl(party?.media_id)
    : party?.episode_id ? api.media.episodeVideoUrl(party?.episode_id) : null;

  useEffect(() => {
    api.parties.get(partyId).then((data) => {
      setParty(data.party);
      setMembers(data.members);
}).catch(() => navigate('/'));
  }, [partyId, navigate]);

  useEffect(() => {
    if (!partyId || !token) return;

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/parties/${partyId}/ws?token=${token}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'sync') return;

        const video = videoRef.current;
        if (!video) return;

        if (msg.action === 'play') {
          video.currentTime = msg.position;
          video.play().catch(() => {});
        } else if (msg.action === 'pause') {
          video.currentTime = msg.position;
          video.pause();
        } else if (msg.action === 'seek') {
          video.currentTime = msg.position;
        }
        setSynced(true);
      } catch (err) { console.error('WS message error:', err); }
    };

    ws.onclose = () => {};
    return () => ws.close();
  }, [partyId, token]);

  function sendAction(type, position) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type, position }));
  }

  function handlePlay() {
    const video = videoRef.current;
    if (!video) return;
    sendAction('play', video.currentTime);
    video.play();
  }

  function handlePause() {
    const video = videoRef.current;
    if (!video) return;
    sendAction('pause', video.currentTime);
    video.pause();
  }

  function handleSeek() {
    const video = videoRef.current;
    if (!video) return;
    sendAction('seek', video.currentTime);
  }

  return (
    <div className="min-h-screen bg-black">
      <div className="flex items-center px-3 md:px-4 py-3 bg-black/90 z-10">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white mr-3 md:mr-4 text-xl md:text-2xl">
          &#8592;
        </button>
        <h2 className="text-white text-sm md:text-lg font-medium truncate flex-1">
          {party?.media_title || 'Loading...'}
        </h2>
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="lg:hidden text-gray-400 hover:text-white ml-2 p-2 rounded"
          aria-label="Toggle members"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>
        </button>
        <div className="hidden md:flex items-center gap-4 ml-4">
          <span className="text-sm text-gray-400">
            {members.length} watching
          </span>
          <div className={`w-2 h-2 rounded-full ${synced ? 'bg-green-500' : 'bg-yellow-500'}`} />
          <span className="text-xs text-gray-500">{synced ? 'Synced' : 'Connecting...'}</span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row">
        <div className="flex-1 flex items-center justify-center bg-black">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              className="max-w-full max-h-[calc(100vh-52px)] lg:max-h-[calc(100vh-60px)]"
              crossOrigin="anonymous"
              onPlay={handlePlay}
              onPause={handlePause}
              onSeeked={handleSeek}
            />
          ) : (
            <div className="text-gray-400">Loading...</div>
          )}
        </div>

        <div className={`${showSidebar ? 'block' : 'hidden'} lg:block w-full lg:w-60 bg-neutral-900 p-4 overflow-y-auto lg:max-h-[calc(100vh-60px)] border-t lg:border-t-0 lg:border-l border-neutral-800`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-400 uppercase">Members</h3>
            <button
              onClick={() => setShowSidebar(false)}
              className="lg:hidden text-gray-400 hover:text-white p-1"
              aria-label="Close sidebar"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-sm">
                <div className="w-6 h-6 rounded-full bg-red-600 flex items-center justify-center text-white text-xs font-bold">
                  {m.display_name?.charAt(0).toUpperCase()}
                </div>
                <span className="text-white truncate">{m.display_name}</span>
                {m.id === party?.host_user_id && (
                  <span className="text-xs text-gray-500">(host)</span>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-neutral-800">
            <h3 className="text-sm font-medium text-gray-400 uppercase mb-2">Invite</h3>
            <p className="text-xs text-gray-500 mb-2">Share this code:</p>
            <div className="bg-neutral-800 rounded px-3 py-2 text-white text-sm font-mono select-all">
              {party?.invite_code}
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(party?.invite_code || ''); }}
              className="mt-2 w-full bg-neutral-800 hover:bg-neutral-700 text-gray-300 text-sm rounded py-1.5 transition"
            >
              Copy code
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
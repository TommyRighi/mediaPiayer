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
      <div className="flex items-center px-4 py-3 bg-black/90 z-10">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white mr-4 text-2xl">
          &#8592;
        </button>
        <h2 className="text-white text-lg font-medium">
          Watching: {party?.media_title || 'Loading...'}
        </h2>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-sm text-gray-400">
            {members.length} watching
          </span>
          <div className={`w-2 h-2 rounded-full ${synced ? 'bg-green-500' : 'bg-yellow-500'}`} />
          <span className="text-xs text-gray-500">{synced ? 'Synced' : 'Connecting...'}</span>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-1 flex items-center justify-center bg-black">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              className="max-w-full max-h-[calc(100vh-60px)]"
              crossOrigin="anonymous"
              onPlay={handlePlay}
              onPause={handlePause}
              onSeeked={handleSeek}
            />
          ) : (
            <div className="text-gray-400">Loading...</div>
          )}
        </div>

        <div className="w-60 bg-neutral-900 p-4 overflow-y-auto max-h-[calc(100vh-60px)]">
          <h3 className="text-sm font-medium text-gray-400 uppercase mb-3">Members</h3>
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

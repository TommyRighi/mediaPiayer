import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function JamPage() {
  const player = usePlayer(), { socialEnabled } = useAuth();
  const { jam } = player;
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') || '');
  const [search, setSearch] = useState('');
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try { const result = await api.music.tracks.list({ search }); if (!cancelled) { setTracks(result); setError(''); } }
      catch (err) { if (!cancelled) setError(err.message); }
      finally { if (!cancelled) setLoading(false); }
    },250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);
  async function action(fn) { setBusy(true); setError(''); try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  async function copyInvite() {
    try { await navigator.clipboard.writeText(`${location.origin}/music/jam?code=${jam.state.jam.invite_code}`); setCopied(true); }
    catch { setError('Copy the invitation code below to invite a friend.'); }
  }
  if (!socialEnabled) return <div className="p-4 md:p-8"><h1 className="text-3xl mb-4">Listen together</h1><p>Shared listening is disabled. An administrator can enable it in Settings.</p><Link className="jf-btn-secondary inline-block mt-4" to="/music">Back to Music</Link></div>;
  const room = jam.state;
  return <div className="jam-page p-4 md:p-8">
    <div className="jam-heading"><div><p className="jam-eyebrow">YOUR MUSIC, TOGETHER</p><h1>{room ? 'The Jam is on.' : 'Listen together.'}</h1><p className="jam-description">Everyone adds to the queue. Listen on your own device, wherever you are.</p></div><Link className="jf-btn-secondary" to="/music">Browse Music</Link></div>
    {(error || jam.error) && <p role="alert" className="jam-error">{error || jam.error}</p>}
    {!room && <section className="jam-start">
      <div><h2>Start with a song</h2><p>Play something from your library, then invite your friends.</p><button className="jf-btn-primary" disabled={busy || !player.currentTrack || !!jam.id} onClick={() => action(player.startJam)}>Start a Jam</button>{!player.currentTrack && <Link to="/music?tab=tracks" className="block mt-3 underline">Choose music</Link>}</div>
      <form onSubmit={event => { event.preventDefault(); action(() => jam.join(code.trim())); }}><h2>Have an invitation?</h2><label htmlFor="jam-code">Invitation code</label><input id="jam-code" className="jf-input" value={code} onChange={e => setCode(e.target.value)} required maxLength={100} autoComplete="off" /><button className="jf-btn-secondary" disabled={busy || !code.trim() || !!jam.id}>Join Jam</button></form>
      {jam.id && <p role="status">Connecting to your Jam…</p>}
    </section>}
    {room && <div className="jam-columns">
      <section className="jam-room">
        <div className="jam-room-status"><span className={jam.connected ? 'jam-connected' : ''} />{jam.connected ? 'Listening together' : 'Reconnecting. Playback is paused.'}</div>
        <h2>{player.currentTrack?.title || 'Add a song to get started'}</h2><p className="jam-description">{player.currentTrack?.artist}</p>
        <div className="jam-actions"><button className="jf-btn-primary" disabled={!jam.connected || !jam.canControl || !player.currentTrack} onClick={player.togglePlay}>{room.jam.is_playing ? 'Pause' : 'Play'}</button><button className="jf-btn-secondary" disabled={!jam.connected || !jam.canControl} onClick={player.next}>Next song</button>{jam.needsPlay && <button className="jf-btn-primary" onClick={jam.resume}>Enable sound</button>}</div>
        <p className="jam-description mt-4">{jam.isHost ? 'You are hosting.' : jam.canControl ? 'Shared playback controls are on.' : 'The host controls playback. You can add songs.'} Volume stays personal.</p>
        {jam.isHost && <label className="jam-toggle"><input type="checkbox" checked={!!room.jam.shared_controls} disabled={!jam.connected} onChange={event => jam.control('settings',{ sharedControls:event.target.checked })} /> Let everyone control playback</label>}
        <div className="jam-invite"><button className="jf-btn-secondary" onClick={copyInvite}>{copied ? 'Invitation copied' : 'Copy invitation link'}</button><p>Invitation code <code>{room.jam.invite_code}</code></p></div>
        <h3>In this Jam · {room.members.length}</h3><div className="jam-members">{room.members.map(member => <span key={member.id}>{member.display_name}{member.id === room.jam.host_user_id ? ' · host' : ''}</span>)}</div>
        <button className="jf-btn-secondary mt-5" disabled={busy} onClick={() => action(player.leaveJam)}>{jam.isHost ? 'End Jam for everyone' : 'Leave Jam'}</button>
      </section>
      <section className="jam-queue"><h2>Shared queue · {room.queue.length}</h2><ol>{room.queue.map((track,index) => <li className={track.entry_id === room.jam.current_entry_id ? 'jam-current' : ''} key={track.entry_id}>
        <span className="jam-number">{index+1}</span><div className="jam-track"><button disabled={!jam.canControl || !jam.connected} onClick={() => jam.control('select',{ entryId:track.entry_id })}>{track.title}</button><p>{track.artist || 'Unknown artist'} · added by {track.added_by_name || 'a former member'}</p></div>
        {jam.isHost && <div className="jam-queue-actions"><button aria-label={`Move ${track.title} up`} disabled={!index || !jam.connected} onClick={() => jam.control('move',{ entryId:track.entry_id,position:index-1 })}>↑</button><button aria-label={`Remove ${track.title}`} disabled={!jam.connected} onClick={() => jam.control('remove',{ entryId:track.entry_id })}>×</button></div>}
      </li>)}</ol></section>
    </div>}
    <section className="jam-library"><h2>{room ? 'Add to the Jam' : 'Find your first song'}</h2><input className="jf-input" aria-label="Search songs, artists and albums" placeholder="Search songs, artists and albums" value={search} onChange={event => setSearch(event.target.value)} />
      {loading && <p role="status">Searching…</p>}{!loading && !tracks.length && <p>No songs found.</p>}
      <div className="jam-search-results">{tracks.slice(0,50).map(track => <div key={track.id}><div><strong>{track.title}</strong><p>{track.artist || 'Unknown artist'}</p></div><button className="jf-btn-secondary" disabled={busy || !!room && !jam.connected} onClick={() => room ? jam.add(track.id) : player.playTrack(track,tracks)}>{room ? 'Add' : 'Play'}</button></div>)}</div>
    </section>
  </div>;
}

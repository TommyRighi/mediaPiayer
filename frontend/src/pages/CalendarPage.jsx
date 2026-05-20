import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status) {
  const styles = {
    pending: { background: '#f59e0b', color: '#000' },
    active: { background: '#22c55e', color: '#000' },
    completed: { background: 'var(--jf-primary)', color: '#fff' },
    cancelled: { background: 'var(--jf-error)', color: '#fff' },
    expired: { background: 'var(--jf-text-muted)', color: '#000' },
  };
  const s = styles[status] || styles.pending;
  return (
    <span className="text-xs px-2 py-0.5 rounded uppercase font-medium" style={s}>
      {status}
    </span>
  );
}

export default function CalendarPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaResults, setMediaResults] = useState([]);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchRequests = useCallback(async () => {
    try {
      const data = await api.requests.list();
      setRequests(data.requests);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    if (mediaSearch.length < 2) {
      setMediaResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const data = await api.media.list({ search: mediaSearch, limit: 8 });
        setMediaResults(data.media || []);
      } catch {
        setMediaResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [mediaSearch]);

  async function handleRespond(requestId, response) {
    try {
      await api.requests.respond(requestId, response);
      fetchRequests();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleActivate(requestId) {
    try {
      const data = await api.requests.activate(requestId);
      navigate(`/scene/${data.party.id}`);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleCancel(requestId) {
    if (!confirm('Cancel this request?')) return;
    try {
      await api.requests.cancel(requestId);
      fetchRequests();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleCreate() {
    if (!selectedMedia) return;
    if (!scheduledDate || !scheduledTime) {
      alert('Please set a date and time');
      return;
    }
    const dateTime = new Date(`${scheduledDate}T${scheduledTime}`);
    if (isNaN(dateTime.getTime()) || dateTime <= new Date()) {
      alert('Scheduled time must be in the future');
      return;
    }
    setCreating(true);
    try {
      await api.requests.create(selectedMedia.id, selectedEpisode?.id || null, dateTime.toISOString());
      setShowCreate(false);
      setSelectedMedia(null);
      setSelectedEpisode(null);
      setMediaSearch('');
      setScheduledDate('');
      setScheduledTime('');
      fetchRequests();
    } catch (err) {
      alert(err.message);
    }
    setCreating(false);
  }

  const grouped = {};
  requests.forEach((r) => {
    const day = formatDate(r.scheduled_at);
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(r);
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--jf-text-primary)' }}>Watch Calendar</h1>
        <button onClick={() => setShowCreate(!showCreate)} className="jf-btn-primary flex items-center gap-2">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
          New Request
        </button>
      </div>

      {showCreate && (
        <div className="rounded-lg p-4 mb-6" style={{ background: 'var(--jf-surface)' }}>
          <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--jf-text-primary)' }}>Schedule Watch Request</h2>

          {!selectedMedia ? (
            <div>
              <input
                type="text"
                value={mediaSearch}
                onChange={(e) => setMediaSearch(e.target.value)}
                placeholder="Search media..."
                className="jf-input w-full mb-3"
              />
              {mediaResults.length > 0 && (
                <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
                  {mediaResults.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setSelectedMedia(m); setSelectedEpisode(null); }}
                      className="flex items-center gap-3 p-2 rounded text-left hover:bg-white/10 transition"
                    >
                      <span style={{ color: 'var(--jf-text-primary)' }} className="font-medium">{m.title}</span>
                      <span className="text-xs uppercase" style={{ color: 'var(--jf-text-muted)' }}>{m.type}</span>
                    </button>
                  ))}
                </div>
              )}
              {mediaSearch.length >= 2 && mediaResults.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--jf-text-muted)' }}>No results</p>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span style={{ color: 'var(--jf-text-primary)' }} className="font-medium">{selectedMedia.title}</span>
                <span className="text-xs uppercase" style={{ color: 'var(--jf-text-muted)' }}>{selectedMedia.type}</span>
                <button
                  onClick={() => setSelectedMedia(null)}
                  className="text-sm ml-auto hover:underline"
                  style={{ color: 'var(--jf-text-muted)' }}
                >
                  Change
                </button>
              </div>

              {selectedMedia.type === 'series' && selectedMedia.seasons && (
                <div className="mb-4">
                  <p className="text-sm mb-2" style={{ color: 'var(--jf-text-secondary)' }}>
                    Episode (optional):
                  </p>
                  <select
                    value={selectedEpisode?.id || ''}
                    onChange={(e) => {
                      const ep = Object.values(selectedMedia.seasons).flat().find(ep => ep.id === e.target.value);
                      setSelectedEpisode(ep || null);
                    }}
                    className="jf-input w-full"
                  >
                    <option value="">Any</option>
                    {Object.keys(selectedMedia.seasons).sort((a, b) => a - b).map((s) =>
                      selectedMedia.seasons[s].map((ep) => (
                        <option key={ep.id} value={ep.id}>
                          S{s}.E{ep.episode_number} - {ep.title}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}

              <div className="flex gap-3 mb-4">
                <div className="flex-1">
                  <label className="text-sm block mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Date</label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="jf-input w-full"
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm block mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Time</label>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="jf-input w-full"
                  />
                </div>
              </div>

              <button onClick={handleCreate} disabled={creating} className="jf-btn-primary w-full">
                {creating ? 'Creating...' : 'Schedule Request'}
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--jf-text-muted)' }}>Loading...</p>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--jf-text-muted)' }}>
          <p className="text-lg mb-2">No watch requests yet</p>
          <p className="text-sm">Create one to schedule a watch party with others.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {Object.entries(grouped).map(([day, dayRequests]) => (
            <div key={day}>
              <h2 className="text-sm font-medium uppercase mb-3" style={{ color: 'var(--jf-text-secondary)' }}>{day}</h2>
              <div className="flex flex-col gap-2">
                {dayRequests.map((r) => {
                  const isActive = r.status === 'active' && r.party_id;
                  return (
                    <div
                      key={r.id}
                      className="rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                      style={{ background: 'var(--jf-surface)' }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium truncate" style={{ color: 'var(--jf-text-primary)' }}>
                            {r.media_title}
                            {r.episode_title ? ` - ${r.episode_title}` : ''}
                          </span>
                          {statusBadge(r.status)}
                        </div>
                        <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--jf-text-muted)' }}>
                          <span>{formatTime(r.scheduled_at)}</span>
                          <span>by {r.creator_name}</span>
                          <span className="flex items-center gap-1">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" /></svg>
                            {r.approved_count}
                          </span>
                          <span className="flex items-center gap-1">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                            {r.dismissed_count}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isActive ? (
                          <button onClick={() => navigate(`/scene/${r.party_id}`)} className="jf-btn-primary text-sm">
                            Join Room
                          </button>
                        ) : r.status === 'pending' ? (
                          <>
                            {r.my_response === 'approved' ? (
                              <>
                                <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>Approved</span>
                                <button onClick={() => handleRespond(r.id, 'dismissed')} className="jf-btn-outline text-sm">
                                  Dismiss
                                </button>
                                <button
                                  onClick={() => handleActivate(r.id)}
                                  className="jf-btn-primary text-sm"
                                  disabled={r.approved_count < 2}
                                  title={r.approved_count < 2 ? 'Need at least 2 approvals to start' : 'Start the watch party'}
                                >
                                  Start
                                </button>
                              </>
                            ) : r.my_response === 'dismissed' ? (
                              <>
                                <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>Dismissed</span>
                                <button onClick={() => handleRespond(r.id, 'approved')} className="jf-btn-outline text-sm">
                                  Approve
                                </button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => handleRespond(r.id, 'approved')} className="jf-btn-primary text-sm">
                                  Approve
                                </button>
                                <button onClick={() => handleRespond(r.id, 'dismissed')} className="jf-btn-outline text-sm">
                                  Dismiss
                                </button>
                              </>
                            )}
                            {r.created_by === user.id && (
                              <button onClick={() => handleCancel(r.id)} className="text-sm px-2 py-1 rounded hover:bg-white/10" style={{ color: 'var(--jf-error)' }}>
                                Cancel
                              </button>
                            )}
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

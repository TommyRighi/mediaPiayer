import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function MediaDetailPage() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [media, setMedia] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    api.media.get(id).then((data) => {
      setMedia(data.media);
      setForm({
        title: data.media.title,
        description: data.media.description,
        year: data.media.year || '',
        genre: data.media.genre,
      });
    });
  }, [id]);

  async function handleSave() {
    await api.media.update(id, form);
    const data = await api.media.get(id);
    setMedia(data.media);
    setEditing(false);
  }

  async function handleDelete() {
    if (!confirm('Delete this media permanently?')) return;
    await api.media.delete(id);
    navigate('/');
  }

  async function handleStartParty() {
    try {
      const { party } = await api.parties.create(media.id, null);
      navigate(`/scene/${party.id}`);
    } catch (err) {
      alert(err.message);
    }
  }

  if (!media) {
    return <div className="flex items-center justify-center min-h-[60vh]" style={{ color: 'var(--jf-text-muted)' }}>Loading...</div>;
  }

  return (
    <div style={{ marginTop: 'calc(var(--jf-topbar-height) * -1)' }}>
      <div className="jf-backdrop" style={media.backdrop_path ? { backgroundImage: `url(${media.backdrop_path})` } : { background: 'linear-gradient(to bottom right, #292929, #101010)' }}>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--jf-bg) 0%, transparent 60%)' }} />
      </div>

      <div className="jf-detail-ribbon">
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-end md:items-start">
            <div className="jf-detail-poster mx-auto md:mx-0">
              <div style={{ background: 'var(--jf-surface)' }}>
                {media.poster_path ? (
                  <img src={media.poster_path} alt={media.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl md:text-6xl" style={{ color: 'var(--jf-text-muted)' }}>
                    {media.title.charAt(0)}
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 pb-8 text-center md:text-left">
              {editing ? (
                <div className="flex flex-col gap-3">
                  <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="jf-input" />
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="jf-input" rows={3} />
                  <div className="flex gap-3">
                    <input type="number" placeholder="Year" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} className="jf-input" />
                    <input type="text" placeholder="Genre" value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} className="jf-input" />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={handleSave} className="jf-btn-primary">Save</button>
                    <button onClick={() => setEditing(false)} className="jf-btn-secondary">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="text-2xl md:text-4xl font-bold mb-2" style={{ color: 'var(--jf-text-primary)' }}>{media.title}</h1>
                  <div className="flex items-center justify-center md:justify-start flex-wrap gap-2 md:gap-3 text-sm mb-4" style={{ color: 'var(--jf-text-secondary)' }}>
                    {media.year && <span>{media.year}</span>}
                    {media.genre && <span>{media.genre}</span>}
                    <span className="uppercase text-xs px-2 py-0.5 rounded" style={{ background: 'var(--jf-primary-light)', color: 'var(--jf-primary)' }}>{media.type}</span>
                  </div>
                  {media.description && <p className="mb-6 max-w-xl mx-auto md:mx-0" style={{ color: 'var(--jf-text-secondary)' }}>{media.description}</p>}

                  <div className="flex items-center justify-center md:justify-start flex-wrap gap-3">
                    <Link
                      to={media.type === 'movie' ? `/watch/${media.id}` : media.type === 'series' ? `/series/${media.id}` : '#'}
                      className="jf-btn-primary flex items-center gap-2"
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                      Play
                    </Link>
                    <button onClick={handleStartParty} className="jf-btn-secondary flex items-center gap-2">
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" /></svg>
                      Watch Party
                    </button>
                    {isAdmin && (
                      <button onClick={() => setEditing(true)} className="jf-btn-outline flex items-center gap-2">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
                        Edit
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={handleDelete}
                        className="jf-btn-outline flex items-center gap-2"
                        style={{ borderColor: 'var(--jf-error)', color: '#ef5350' }}
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {media.watchProgress && media.watchProgress.progress_seconds > 0 && (
                    <div className="mt-4 text-sm" style={{ color: 'var(--jf-text-muted)' }}>
                      Resume from {Math.floor(media.watchProgress.progress_seconds / 60)}m {media.watchProgress.progress_seconds % 60}s
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {media.seasons && (
            <div className="mt-10">
              {Object.keys(media.seasons).sort((a, b) => a - b).map((seasonNum) => (
                <div key={seasonNum} className="mb-8">
                  <h3 className="text-lg font-medium mb-4" style={{ color: 'var(--jf-text-primary)' }}>Season {seasonNum}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {media.seasons[seasonNum].map((ep) => (
                      <Link
                        key={ep.id}
                        to={`/watch/${media.id}/${ep.id}`}
                        className="flex items-center gap-3 p-3 md:p-4 rounded transition group"
                        style={{ background: 'var(--jf-surface)' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--jf-surface-elevated)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'var(--jf-surface)'}
                      >
                        <div className="w-10 h-10 md:w-12 md:h-12 rounded flex items-center justify-center flex-shrink-0 transition" style={{ background: 'var(--jf-surface-elevated)' }}>
                          <span style={{ color: 'var(--jf-text-primary)' }} className="text-base md:text-lg">&#9654;</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate text-sm md:text-base" style={{ color: 'var(--jf-text-primary)' }}>
                            {ep.episode_number}. {ep.title}
                          </p>
                          <p className="text-xs truncate" style={{ color: 'var(--jf-text-muted)' }}>{ep.description}</p>
                        </div>
                        {ep.watchProgress && (
                          <div className="text-xs hidden sm:block" style={{ color: 'var(--jf-text-muted)' }}>
                            {Math.floor(ep.watchProgress.progress_seconds / 60)}m
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
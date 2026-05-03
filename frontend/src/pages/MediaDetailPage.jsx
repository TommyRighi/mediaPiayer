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
    return <div className="flex items-center justify-center min-h-screen text-gray-400">Loading...</div>;
  }

  return (
    <div className="min-h-screen">
      <div className="relative h-[60vh] min-h-[350px]">
        {media.backdrop_path ? (
          <img src={media.backdrop_path} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#141414] to-transparent" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-8 -mt-32">
        <div className="flex gap-8">
          <div className="flex-shrink-0 w-[220px] -mt-16">
            <div className="aspect-[2/3] bg-neutral-800 rounded-lg overflow-hidden shadow-2xl">
              {media.poster_path ? (
                <img src={media.poster_path} alt={media.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-600 text-6xl">
                  {media.title.charAt(0)}
                </div>
              )}
            </div>
          </div>

          <div className="pt-8 flex-1">
            {editing ? (
              <div className="flex flex-col gap-3">
                <input
                  type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white"
                />
                <textarea value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white"
                  rows={3}
                />
                <div className="flex gap-3">
                  <input type="number" placeholder="Year" value={form.year}
                    onChange={(e) => setForm({ ...form, year: e.target.value })}
                    className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white w-24"
                  />
                  <input type="text" placeholder="Genre" value={form.genre}
                    onChange={(e) => setForm({ ...form, genre: e.target.value })}
                    className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white"
                  />
                </div>
                <div className="flex gap-3">
                  <button onClick={handleSave} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition">Save</button>
                  <button onClick={() => setEditing(false)} className="bg-neutral-700 hover:bg-neutral-600 text-white px-4 py-2 rounded transition">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-4xl font-bold mb-2">{media.title}</h1>
                <div className="flex items-center gap-3 text-sm text-gray-400 mb-4">
                  {media.year && <span>{media.year}</span>}
                  {media.genre && <span>{media.genre}</span>}
                  <span className="uppercase">{media.type}</span>
                </div>
                {media.description && <p className="text-gray-300 mb-6 max-w-xl">{media.description}</p>}

                <div className="flex items-center gap-3">
                  <Link
                    to={media.type === 'movie' ? `/watch/${media.id}` : media.type === 'series' ? `/series/${media.id}` : '#'}
                    className="bg-red-600 hover:bg-red-700 text-white px-8 py-2.5 rounded font-medium flex items-center gap-2 transition"
                  >
                    <span>&#9654;</span> Play
                  </Link>
                  <button
                    onClick={handleStartParty}
                    className="bg-neutral-600/70 hover:bg-neutral-600 text-white px-6 py-2.5 rounded font-medium transition"
                  >
                    Start Watch Party
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => setEditing(true)}
                      className="text-gray-400 hover:text-white px-4 py-2.5 rounded border border-neutral-700 hover:border-white transition text-sm"
                    >
                      Edit
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={handleDelete}
                      className="text-gray-400 hover:text-red-500 px-4 py-2.5 rounded border border-neutral-700 hover:border-red-500 transition text-sm"
                    >
                      Delete
                    </button>
                  )}
                </div>

                {media.watchProgress && media.watchProgress.progress_seconds > 0 && (
                  <div className="mt-4 text-sm text-gray-400">
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
                <h3 className="text-xl font-medium text-gray-200 mb-4">Season {seasonNum}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {media.seasons[seasonNum].map((ep) => (
                    <Link
                      key={ep.id}
                      to={`/watch/${media.id}/${ep.id}`}
                      className="bg-neutral-800 hover:bg-neutral-700 rounded-lg p-4 flex items-center gap-3 transition group"
                    >
                      <div className="w-12 h-12 rounded bg-neutral-700 flex items-center justify-center flex-shrink-0 group-hover:bg-red-600 transition">
                        <span className="text-white text-lg">&#9654;</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">
                          {ep.episode_number}. {ep.title}
                        </p>
                        <p className="text-gray-500 text-xs truncate">{ep.description}</p>
                      </div>
                      {ep.watchProgress && (
                        <div className="text-xs text-gray-500">
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
  );
}

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken } from '../api';

export default function UploadPage() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [type, setType] = useState('movie');
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('');
  const [seasonNumber, setSeasonNumber] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const file = selectedFile;
    if (!file) { setError('Please select a file'); return; }
    if (!title.trim()) { setError('Title is required'); return; }

    setError('');
    setSuccess('');
    setUploading(true);

    const formData = new FormData();
    formData.append('type', type);
    formData.append('title', title);
    if (year) formData.append('year', year);
    if (description) formData.append('description', description);
    if (genre) formData.append('genre', genre);
    if (type === 'series') {
      if (!seasonNumber || !episodeNumber) {
        setError('Season and episode number are required for series');
        setUploading(false);
        return;
      }
      formData.append('seasonNumber', seasonNumber);
      formData.append('episodeNumber', episodeNumber);
    }
    formData.append('file', file);

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      const token = getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setSuccess('Upload complete! Redirecting...');
          setTimeout(() => navigate('/'), 1500);
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            setError(err.error || 'Upload failed');
          } catch {
            setError('Upload failed');
          }
        }
        setUploading(false);
      };

      xhr.timeout = 600000;
      xhr.onerror = () => { setError('Network error'); setUploading(false); };
      xhr.ontimeout = () => { setError('Upload timed out — the server may still be processing. Try checking back later.'); setUploading(false); };
      xhr.send(formData);
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  }

  return (
    <div className="min-h-[60vh] pt-8 px-4 md:px-8 pb-16">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-bold mb-8" style={{ color: 'var(--jf-text-primary)' }}>Upload Media</h1>

        {error && (
          <div className="rounded px-4 py-3 mb-6 text-sm" style={{ background: 'rgba(194,40,40,0.15)', border: '1px solid var(--jf-error)', color: '#ef5350' }}>
            {error}
          </div>
        )}
        {success && (
          <div className="rounded px-4 py-3 mb-6 text-sm" style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid var(--jf-primary)', color: 'var(--jf-primary)' }}>
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Type</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="type" value="movie" checked={type === 'movie'} onChange={() => setType('movie')} style={{ accentColor: 'var(--jf-primary)' }} />
                <span style={{ color: 'var(--jf-text-primary)' }}>Movie</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="type" value="series" checked={type === 'series'} onChange={() => setType('series')} style={{ accentColor: 'var(--jf-primary)' }} />
                <span style={{ color: 'var(--jf-text-primary)' }}>Series</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="jf-input" required />
          </div>

          {type === 'series' && (
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Season</label>
                <input type="number" value={seasonNumber} onChange={(e) => setSeasonNumber(e.target.value)} className="jf-input" required />
              </div>
              <div className="flex-1">
                <label className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Episode</label>
                <input type="number" value={episodeNumber} onChange={(e) => setEpisodeNumber(e.target.value)} className="jf-input" required />
              </div>
            </div>
          )}

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Year</label>
              <input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="jf-input" />
            </div>
            <div className="flex-1">
              <label className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Genre</label>
              <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)} className="jf-input" />
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="jf-input" rows={3} />
          </div>

          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Video File</label>
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition"
              style={{ borderColor: 'rgba(255,255,255,0.12)' }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => setSelectedFile(e.target.files[0] || null)} />
              <p style={{ color: 'var(--jf-text-secondary)' }} className="mb-2">Click to select a video file</p>
              <p className="text-xs" style={{ color: 'var(--jf-text-muted)' }}>MP4, MKV, WebM</p>
              {selectedFile && (
                <p className="mt-2" style={{ color: 'var(--jf-text-primary)' }}>{selectedFile.name}</p>
              )}
            </div>
          </div>

          {uploading && (
            <div className="rounded-lg p-3" style={{ background: 'var(--jf-surface)' }}>
              <div className="flex items-center justify-between text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>
                <span>Uploading...</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--jf-primary)' }} />
              </div>
            </div>
          )}

          <button type="submit" disabled={uploading} className="jf-btn-primary">
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </form>
      </div>
    </div>
  );
}
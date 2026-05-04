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

      xhr.onerror = () => { setError('Network error'); setUploading(false); };
      xhr.send(formData);
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen pt-20 px-4 md:px-8 pb-16">
      <div className="max-w-xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Upload Media</h1>

        {error && (
          <div className="bg-red-600/20 border border-red-600 text-red-400 rounded px-4 py-3 mb-6">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-600/20 border border-green-600 text-green-400 rounded px-4 py-3 mb-6">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Type</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="type" value="movie" checked={type === 'movie'} onChange={() => setType('movie')} className="accent-red-600" />
                <span className="text-white">Movie</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="type" value="series" checked={type === 'series'} onChange={() => setType('series')} className="accent-red-600" />
                <span className="text-white">Series</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-4 py-3 text-white focus:outline-none focus:border-white" required />
          </div>

          {type === 'series' && (
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm text-gray-400 mb-1">Season</label>
                <input type="number" value={seasonNumber} onChange={(e) => setSeasonNumber(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-4 py-3 text-white focus:outline-none focus:border-white" required />
              </div>
              <div className="flex-1">
                <label className="block text-sm text-gray-400 mb-1">Episode</label>
                <input type="number" value={episodeNumber} onChange={(e) => setEpisodeNumber(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-4 py-3 text-white focus:outline-none focus:border-white" required />
              </div>
            </div>
          )}

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Year</label>
              <input type="number" value={year} onChange={(e) => setYear(e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-4 py-3 text-white focus:outline-none focus:border-white" />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Genre</label>
              <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-4 py-3 text-white focus:outline-none focus:border-white" />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-4 py-3 text-white focus:outline-none focus:border-white" rows={3} />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Video File</label>
            <div className="border-2 border-dashed border-neutral-700 rounded-lg p-8 text-center hover:border-neutral-500 transition cursor-pointer"
              onClick={() => fileRef.current?.click()}>
              <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => setSelectedFile(e.target.files[0] || null)} />
              <p className="text-gray-400 mb-2">Click to select a video file</p>
              <p className="text-gray-500 text-xs">MP4, MKV, WebM</p>
              {selectedFile && (
                <p className="text-white mt-2">{selectedFile.name}</p>
              )}
            </div>
          </div>

          {uploading && (
            <div className="bg-neutral-800 rounded-lg p-3">
              <div className="flex items-center justify-between text-sm text-gray-400 mb-1">
                <span>Uploading...</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 bg-neutral-700 rounded-full overflow-hidden">
                <div className="h-full bg-red-600 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          <button type="submit" disabled={uploading}
            className="bg-red-600 hover:bg-red-700 text-white font-medium rounded py-3 transition disabled:opacity-50">
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </form>
      </div>
    </div>
  );
}

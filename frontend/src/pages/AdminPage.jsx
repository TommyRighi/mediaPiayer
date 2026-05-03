import { useState, useEffect } from 'react';
import { api } from '../api';
import { Link } from 'react-router-dom';

export default function AdminPage() {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [media, setMedia] = useState([]);

  useEffect(() => {
    api.media.list().then((data) => setMedia(data.media)).catch(() => {});
  }, []);

  async function handleScan() {
    setScanning(true);
    setScanResult(null);
    try {
      const result = await api.admin.scan();
      setScanResult(result);
      const data = await api.media.list();
      setMedia(data.media);
    } catch (err) {
      setScanResult({ error: err.message });
    }
    setScanning(false);
  }

  return (
    <div className="min-h-screen pt-20 px-8 pb-16">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Admin Panel</h1>

        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-medium mb-2">Folder Scanner</h2>
          <p className="text-gray-400 text-sm mb-4">
            Scan the media folders for new files. Movies go in <code className="text-gray-300 bg-neutral-800 px-1 rounded">media/movies/</code>,
            series in <code className="text-gray-300 bg-neutral-800 px-1 rounded">media/series/ShowName/Season XX/</code>.
          </p>

          <button
            onClick={handleScan}
            disabled={scanning}
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded font-medium transition disabled:opacity-50"
          >
            {scanning ? 'Scanning...' : 'Scan for new media'}
          </button>

          {scanResult && !scanResult.error && (
            <div className="mt-4 text-sm text-green-400">
              Found: {scanResult.movies} movies, {scanResult.series} series ({scanResult.episodes} episodes)
            </div>
          )}
          {scanResult?.error && (
            <div className="mt-4 text-sm text-red-400">{scanResult.error}</div>
          )}
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6">
          <h2 className="text-lg font-medium mb-4">Media Library ({media.length})</h2>
          {media.length === 0 ? (
            <p className="text-gray-500 text-sm">No media in library yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {media.map((m) => (
                <div key={m.id} className="flex items-center gap-4 bg-neutral-800 rounded p-3">
                  <div className="w-10 h-14 bg-neutral-700 rounded overflow-hidden flex-shrink-0 flex items-center justify-center text-neutral-500 text-xs">
                    {m.type === 'movie' ? 'MOV' : 'SER'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link to={`/${m.type === 'movie' ? 'movie' : 'series'}/${m.id}`} className="text-white hover:underline font-medium truncate block">
                      {m.title}
                    </Link>
                    <p className="text-gray-500 text-xs">{m.type} {m.year && `· ${m.year}`} {m.genre && `· ${m.genre}`}</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Link
                      to={`/${m.type === 'movie' ? 'movie' : 'series'}/${m.id}`}
                      className="text-gray-400 hover:text-white text-sm px-3 py-1 rounded border border-neutral-700 hover:border-white transition"
                    >
                      Edit
                    </Link>
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

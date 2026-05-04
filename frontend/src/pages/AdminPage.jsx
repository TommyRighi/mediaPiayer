import { useState, useEffect } from 'react';
import { api } from '../api';
import { Link } from 'react-router-dom';

export default function AdminPage() {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [media, setMedia] = useState([]);
  const [storageInfo, setStorageInfo] = useState(null);
  const [newDir, setNewDir] = useState('');
  const [storageMsg, setStorageMsg] = useState(null);

  useEffect(() => {
    api.media.list().then((data) => setMedia(data.media)).catch(() => {});
    api.admin.getStorage().then(setStorageInfo).catch(() => {});
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

  async function handleAddStorage() {
    if (!newDir.trim()) return;
    setStorageMsg(null);
    try {
      const currentDirs = storageInfo?.dirs?.filter(d => d.path !== storageInfo.primary).map(d => d.path) || [];
      const result = await api.admin.setStorage([...currentDirs, newDir.trim()]);
      setStorageMsg({ success: result.note });
      setNewDir('');
      const info = await api.admin.getStorage();
      setStorageInfo(info);
    } catch (err) {
      setStorageMsg({ error: err.message });
    }
  }

  async function handleRemoveStorage(dirPath) {
    setStorageMsg(null);
    try {
      const remaining = storageInfo.dirs.filter(d => d.path !== dirPath && d.path !== storageInfo.primary).map(d => d.path);
      const result = await api.admin.setStorage(remaining);
      setStorageMsg({ success: result.note });
      const info = await api.admin.getStorage();
      setStorageInfo(info);
    } catch (err) {
      setStorageMsg({ error: err.message });
    }
  }

  function formatBytes(bytes) {
    if (!bytes) return 'N/A';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(1)} ${units[i]}`;
  }

  return (
    <div className="min-h-screen pt-20 px-4 md:px-8 pb-16">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Admin Panel</h1>

        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-medium mb-2">Storage</h2>
          <p className="text-gray-400 text-sm mb-4">
            Add external USB or network paths as media storage. Files in <code className="text-gray-300 bg-neutral-800 px-1 rounded">movies/</code> and <code className="text-gray-300 bg-neutral-800 px-1 rounded">series/ShowName/Season XX/</code> subdirectories will be found by the scanner.
          </p>

          {storageInfo && (
            <div className="space-y-3 mb-4">
              {storageInfo.dirs.map((dir) => (
                <div key={dir.path} className="bg-neutral-800 rounded p-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-mono text-sm truncate">{dir.path}</span>
                      {dir.path === storageInfo.primary && (
                        <span className="text-xs bg-blue-600/30 text-blue-400 px-2 py-0.5 rounded">Primary</span>
                      )}
                      {!dir.exists && (
                        <span className="text-xs bg-red-600/30 text-red-400 px-2 py-0.5 rounded">Not Found</span>
                      )}
                    </div>
                    {dir.exists && (
                      <div className="text-gray-500 text-xs mt-1">
                        {formatBytes(dir.freeBytes)} free of {formatBytes(dir.totalBytes)}
                        {dir.entries.length > 0 && ` · ${dir.entries.join(', ')}`}
                      </div>
                    )}
                  </div>
                  {dir.path !== storageInfo.primary && (
                    <button
                      onClick={() => handleRemoveStorage(dir.path)}
                      className="text-red-400 hover:text-red-300 text-sm flex-shrink-0"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={newDir}
              onChange={(e) => setNewDir(e.target.value)}
              placeholder="/mnt/usb or /Volumes/MyUSB"
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-neutral-500"
              onKeyDown={(e) => e.key === 'Enter' && handleAddStorage()}
            />
            <button onClick={handleAddStorage} className="jf-btn-primary text-sm whitespace-nowrap">
              Add Path
            </button>
          </div>

          {storageMsg?.success && <p className="text-sm" style={{ color: 'var(--jf-primary)' }}>{storageMsg.success}</p>}
          {storageMsg?.error && <p className="text-sm text-red-400">{storageMsg.error}</p>}
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-medium mb-2">Folder Scanner</h2>
          <p className="text-gray-400 text-sm mb-4">
            Scan all configured storage directories for new media files.
          </p>

          <button
            onClick={handleScan}
            disabled={scanning}
            className="jf-btn-primary"
          >
            {scanning ? 'Scanning...' : 'Scan for new media'}
          </button>

          {scanResult && !scanResult.error && (
            <div className="mt-4 text-sm" style={{ color: 'var(--jf-primary)' }}>
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

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function JoinPartyPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin(e) {
    e.preventDefault();
    if (!code.trim()) { setError('Enter an invite code'); return; }

    setLoading(true);
    setError('');
    try {
      const { party } = await api.parties.join(code.trim());
      navigate(`/scene/${party.id}`);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen pt-20 px-4 md:px-8 flex items-start justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-8">Join Watch Party</h1>

        {error && (
          <div className="rounded px-4 py-3 mb-6 text-sm" style={{ background: 'rgba(229,9,20,0.12)', border: '1px solid var(--jf-primary)', color: '#ff6b6b' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleJoin} className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 flex flex-col gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Invite Code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter the invite code..."
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-4 py-3 text-white focus:outline-none focus:border-white font-mono text-lg tracking-wider"
              autoFocus
            />
          </div>
          <button type="submit" disabled={loading}
            className="jf-btn-primary w-full">
            {loading ? 'Joining...' : 'Join'}
          </button>
        </form>
      </div>
    </div>
  );
}

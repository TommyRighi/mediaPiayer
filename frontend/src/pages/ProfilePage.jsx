import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProfilePage() {
  const { user, updateProfile, logout } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await updateProfile({ displayName });
      setMessage('Profile updated');
    } catch (err) {
      setMessage(err.message);
    }
    setSaving(false);
  }

  return (
    <div className="min-h-screen pt-20 px-8 pb-16 flex items-start justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-8">Profile</h1>

        {message && (
          <div className={`rounded px-4 py-3 mb-6 text-sm ${message.includes('updated') ? 'bg-green-600/20 border border-green-600 text-green-400' : 'bg-red-600/20 border border-red-600 text-red-400'}`}>
            {message}
          </div>
        )}

        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 mb-6">
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email</label>
              <input type="email" value={user?.email || ''} disabled
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-4 py-3 text-gray-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Display Name</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-4 py-3 text-white focus:outline-none focus:border-white" />
            </div>
            <button type="submit" disabled={saving}
              className="bg-red-600 hover:bg-red-700 text-white font-medium rounded py-3 transition disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </form>
        </div>

        <button
          onClick={() => { logout(); navigate('/login'); }}
          className="w-full bg-neutral-800 hover:bg-neutral-700 text-gray-300 rounded py-3 transition"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

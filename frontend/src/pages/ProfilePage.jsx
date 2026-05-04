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
    <div className="min-h-[60vh] px-4 md:px-8 pb-16 flex items-start justify-center pt-12">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-8" style={{ color: 'var(--jf-text-primary)' }}>Profile</h1>

        {message && (
          <div className="rounded px-4 py-3 mb-6 text-sm" style={{
            background: message.includes('updated') ? 'rgba(34,197,94,0.15)' : 'rgba(194,40,40,0.15)',
            border: message.includes('updated') ? '1px solid var(--jf-primary)' : '1px solid var(--jf-error)',
            color: message.includes('updated') ? 'var(--jf-primary)' : '#ef5350'
          }}>
            {message}
          </div>
        )}

        <div className="p-6 mb-6" style={{ background: 'var(--jf-surface)', borderRadius: '0.6em' }}>
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Email</label>
              <input type="email" value={user?.email || ''} disabled className="jf-input" style={{ opacity: 0.5, cursor: 'not-allowed' }} />
            </div>
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Display Name</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="jf-input" />
            </div>
            <button type="submit" disabled={saving} className="jf-btn-primary">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </form>
        </div>

        <div className="p-6 mb-6" style={{ background: 'var(--jf-surface)', borderRadius: '0.6em' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold" style={{ background: 'var(--jf-primary)', color: 'var(--jf-bg)' }}>
              {user?.display_name?.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-medium" style={{ color: 'var(--jf-text-primary)' }}>{user?.display_name}</div>
              <div className="text-sm" style={{ color: 'var(--jf-text-muted)' }}>{user?.email}</div>
            </div>
          </div>
          {user?.role === 'admin' && (
            <div className="text-xs px-2 py-1 rounded inline-block mb-2" style={{ background: 'var(--jf-primary-light)', color: 'var(--jf-primary)' }}>
              Admin
            </div>
          )}
        </div>

        <button
          onClick={() => { logout(); navigate('/login'); }}
          className="w-full text-center py-3 rounded transition"
          style={{ background: 'var(--jf-surface)', color: 'var(--jf-text-secondary)' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--jf-surface-elevated)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--jf-surface)'}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
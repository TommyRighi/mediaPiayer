import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
  const { socialEnabled, downloadsEnabled, refreshFeatures } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function change(key, value) {
    setBusy(true); setError(''); setMessage('');
    try {
      await api.admin.updateSettings({ [key]: value });
      await refreshFeatures();
      setMessage('Settings saved.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="max-w-3xl mx-auto p-4 md:p-8">
    <h1 className="text-2xl font-bold mb-6">Settings</h1>
    {error && <p role="alert" className="mb-4" style={{ color: 'var(--jf-error)' }}>{error}</p>}
    {message && <p role="status" className="mb-4">{message}</p>}
    <div className="space-y-4">
      {[
        ['socialEnabled', socialEnabled, 'Calendar and watch parties', 'Schedule shared screenings, invite other accounts and watch together with chat. Scheduled screenings are visible to other signed-in users.'],
        ['downloadsEnabled', downloadsEnabled, 'Media downloads', 'Enable Transmission downloads and YouTube music imports. Transmission and yt-dlp must be installed and configured on the server.'],
      ].map(([key, checked, title, description]) => <section key={key} className="rounded-lg p-6" style={{ background: 'var(--jf-surface)' }}>
        <label className="flex items-start gap-4"><input type="checkbox" checked={checked} disabled={busy} onChange={event => change(key, event.target.checked)} className="mt-1" /><span><span className="block font-medium mb-2">{title}</span><span className="text-sm" style={{ color: 'var(--jf-text-secondary)' }}>{description}</span></span></label>
      </section>)}
    </div>
    <p className="text-sm mt-6" style={{ color: 'var(--jf-text-secondary)' }}>These settings apply to all accounts. Personal viewing history stays under Profile.</p>
  </div>;
}

import { useState, useEffect } from 'react';
import { api } from '../api';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProfilePage() {
  const { user, updateProfile, updatePrivacy, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [invite, setInvite] = useState('');
  const [passwords, setPasswords] = useState({ current: '', next: '' });
  useEffect(() => { api.auth.sessions().then(data => setSessions(data.sessions)).catch(() => {}); }, []);
  async function action(fn, success) {
    setSaving(true); setMessage('');
    try { await fn(); setMessage(success); setMessageError(false); } catch (err) { setMessage(err.message); setMessageError(true); }
    finally { setSaving(false); }
  }


  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await updateProfile({ displayName });
      setMessage('Profile updated'); setMessageError(false);
    } catch (err) {
      setMessage(err.message); setMessageError(true);
    }
    setSaving(false);
  }

  return (
    <div className="min-h-[60vh] px-4 md:px-8 pb-16 flex items-start justify-center pt-12">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-8" style={{ color: 'var(--jf-text-primary)' }}>Profile</h1>

        {message && (
          <div role={messageError ? "alert" : "status"} className="rounded px-4 py-3 mb-6 text-sm" style={{
            background: !messageError ? 'rgba(34,197,94,0.15)' : 'rgba(194,40,40,0.15)',
            border: !messageError ? '1px solid var(--jf-primary)' : '1px solid var(--jf-error)',
            color: !messageError ? 'var(--jf-primary)' : '#ef5350'
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

        <section className="p-6 mb-6" style={{ background: 'var(--jf-surface)', borderRadius: '0.6em' }} aria-labelledby="privacy-heading">
          <h2 id="privacy-heading" className="text-lg mb-3">Privacy della visione</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--jf-text-secondary)' }}>La modalità privata non salva film, episodi o ascolti nella cronologia del server. Il server deve comunque leggere il contenuto per trasmetterlo.</p>
          <label className="flex gap-3 items-start text-sm">
            <input type="checkbox" checked={!!user?.history_enabled} disabled={saving} onChange={e => action(() => updatePrivacy(e.target.checked), 'Preferenze aggiornate.')} />
            <span>Salva cronologia e avanzamento per riprendere su altri dispositivi.</span>
          </label>
          <p className="text-xs mt-3" style={{ color: 'var(--jf-text-muted)' }}>Disattivando questa opzione elimini anche i progressi esistenti. Eventuali vecchi backup richiedono una gestione separata.</p>
          <button disabled={saving} onClick={() => action(() => api.auth.clearHistory(), 'Cronologia eliminata.')} className="jf-btn-primary mt-4">Elimina cronologia</button>
        </section>

        <section className="p-6 mb-6" style={{ background: 'var(--jf-surface)', borderRadius: '0.6em' }} aria-labelledby="sessions-heading">
          <h2 id="sessions-heading" className="text-lg mb-3">Sessioni autorizzate</h2>
          <ul className="space-y-3">
            {sessions.map((session, index) => <li key={session.id} className="text-sm flex justify-between gap-4">
              <span>{session.current ? 'Questa sessione' : `Sessione ${index + 1}`}<br /><span style={{ color: 'var(--jf-text-muted)' }}>Scade {new Date(session.expires_at * 1000).toLocaleDateString()}</span></span>
              {!session.current && <button disabled={saving} onClick={() => action(async () => { await api.auth.revokeSession(session.id); setSessions(previous => previous.filter(s => s.id !== session.id)); }, 'Sessione revocata.')} className="underline">Revoca</button>}
            </li>)}
          </ul>
          <button disabled={saving} className="jf-btn-primary mt-4" onClick={() => action(async () => { await api.auth.revokeAll(); await logout(); navigate('/login'); }, 'Sessioni revocate.')}>Disconnetti tutte le sessioni</button>
        </section>

        <section className="p-6 mb-6" style={{ background: 'var(--jf-surface)', borderRadius: '0.6em' }}>
          <h2 className="text-lg mb-3">Cambia password</h2>
          <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); action(async () => { await changePassword(passwords.current, passwords.next); setPasswords({ current: '', next: '' }); const data = await api.auth.sessions(); setSessions(data.sessions); }, 'Password aggiornata. Le altre sessioni sono state revocate.'); }}>
            <label htmlFor="current-password">Password attuale</label><input id="current-password" type="password" autoComplete="current-password" required className="jf-input" value={passwords.current} onChange={e => setPasswords({ ...passwords, current: e.target.value })} />
            <label htmlFor="new-password">Nuova password, almeno 12 caratteri</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} required className="jf-input" value={passwords.next} onChange={e => setPasswords({ ...passwords, next: e.target.value })} />
            <button disabled={saving} type="submit" className="jf-btn-primary">Aggiorna password</button>
          </form>
        </section>
        {user?.role === 'admin' && <section className="p-6 mb-6" style={{ background: 'var(--jf-surface)', borderRadius: '0.6em' }}>
          <h2 className="text-lg mb-3">Invita un amico</h2>
          <p className="text-sm mb-3">Questo invito crea un account personale, è monouso e scade dopo 48 ore. La chiave Tailscale va generata separatamente nella sua console.</p>
          <button disabled={saving} className="jf-btn-primary" onClick={() => action(async () => { const result = await api.auth.invite(); setInvite(result.code); }, 'Invito creato.')}>Genera invito</button>
          {invite && <div className="mt-4"><label htmlFor="generated-invite">Invito da condividere privatamente</label><input id="generated-invite" className="jf-input mt-2" readOnly value={invite} onFocus={e => e.target.select()} /></div>}
        </section>}

        <button
          onClick={async () => { await logout(); navigate('/login'); }}
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
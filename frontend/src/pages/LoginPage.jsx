import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', displayName: '', inviteCode: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        await register(form.email, form.password, form.displayName, form.inviteCode);
      } else {
        await login(form.email, form.password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative px-4" style={{ background: 'var(--jf-bg)' }}>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center top, rgba(34,197,94,0.08) 0%, transparent 60%)' }} />
      
      <div className="absolute top-4 left-4 sm:top-6 sm:left-8 flex items-center gap-2 z-10">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--jf-primary)" strokeWidth="2">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span className="text-xl font-bold" style={{ color: 'var(--jf-primary)' }}>MediaPiayer</span>
      </div>

      <div className="relative z-10 w-full max-w-md p-6 sm:p-10" style={{ background: 'var(--jf-surface)', borderRadius: '0.6em' }}>
        <h2 className="text-2xl sm:text-3xl font-medium mb-6 sm:mb-8" style={{ color: 'var(--jf-text-primary)' }}>
          {isRegister ? 'Sign Up' : 'Sign In'}
        </h2>

        {error && (
          <div role="alert" className="rounded px-4 py-3 mb-4 text-sm" style={{ background: 'rgba(194,40,40,0.15)', border: '1px solid var(--jf-error)', color: '#ef5350' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isRegister && <div><label htmlFor="invite-code" className="block text-sm mb-1">Invito mediaPiayer</label><input id="invite-code" type="password" autoComplete="off" value={form.inviteCode} onChange={e => setForm({ ...form, inviteCode: e.target.value })} className="jf-input" required /><p className="text-xs mt-2">Usa l’invito per creare l’account. La chiave Tailscale serve invece a collegare l’app.</p></div>}
          {isRegister && (
            <div>
              <label htmlFor="login-displayName" className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Display Name</label>
              <input
                id="login-displayName" autoComplete={'name'} type="text"
                placeholder="Your name"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className="jf-input"
                required
              />
            </div>
          )}
          <div>
            <label htmlFor="login-email" className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Email</label>
            <input
              id="login-email" autoComplete={'email'} type="email"
              placeholder="email@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="jf-input"
              required
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm mb-1" style={{ color: 'var(--jf-text-secondary)' }}>Password</label>
            <input
              id="login-password" autoComplete={isRegister ? 'new-password' : 'current-password'} type="password"
              placeholder="Enter your password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="jf-input"
              required
              minLength={isRegister ? 12 : undefined}
            />
          </div>

          <button type="submit" disabled={loading} className="jf-btn-primary mt-2">
            {loading ? 'Please wait...' : isRegister ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-sm" style={{ color: 'var(--jf-text-muted)' }}>
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
            style={{ color: 'var(--jf-primary)' }}
            className="hover:underline"
          >
            {isRegister ? 'Sign in' : 'Sign up'}
          </button>
        </p>
      </div>
    </div>
  );
}
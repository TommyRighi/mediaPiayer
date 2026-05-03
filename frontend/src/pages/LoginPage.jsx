import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        await register(form.email, form.password, form.displayName);
      } else {
        await login(form.email, form.password);
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#141414] relative">
      <div className="absolute inset-0 bg-black/60" />
      <div className="absolute top-6 left-8">
        <h1 className="text-red-600 font-bold text-3xl tracking-tighter">NEXTFLIX</h1>
      </div>

      <div className="relative z-10 bg-black/75 rounded-lg p-16 w-full max-w-md mx-4">
        <h2 className="text-white text-3xl font-medium mb-7">
          {isRegister ? 'Sign Up' : 'Sign In'}
        </h2>

        {error && (
          <div className="bg-red-600/20 border border-red-600 text-red-400 rounded px-4 py-2 mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isRegister && (
            <input
              type="text"
              placeholder="Display name"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              className="bg-neutral-800 border border-neutral-700 rounded px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-white"
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="bg-neutral-800 border border-neutral-700 rounded px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-white"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="bg-neutral-800 border border-neutral-700 rounded px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-white"
            required
            minLength={6}
          />

          <button
            type="submit"
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white font-medium rounded py-3 mt-2 transition disabled:opacity-50"
          >
            {loading ? 'Please wait...' : isRegister ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <p className="text-gray-400 mt-6 text-sm">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
            className="text-white hover:underline"
          >
            {isRegister ? 'Sign in' : 'Sign up'}
          </button>
        </p>
      </div>
    </div>
  );
}

import { Link, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/80 to-transparent px-8 py-3 flex items-center gap-8">
        <Link to="/" className="text-red-600 font-bold text-2xl tracking-tighter">MediaPiayer</Link>

        <div className="flex items-center gap-6 text-sm text-gray-300">
          <Link to="/" className="hover:text-white transition">Home</Link>
          {isAdmin && <Link to="/upload" className="hover:text-white transition">Upload</Link>}
          {isAdmin && <Link to="/admin" className="hover:text-white transition">Admin</Link>}
        </div>

        <div className="ml-auto relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition"
          >
            <div className="w-7 h-7 rounded bg-red-600 flex items-center justify-center text-white text-xs font-bold">
              {user?.display_name?.charAt(0).toUpperCase()}
            </div>
            {user?.display_name}
          </button>

          {showDropdown && (
            <div className="absolute right-0 top-10 w-40 bg-neutral-900 border border-neutral-700 rounded shadow-lg py-1">
              <Link
                to="/profile"
                className="block px-4 py-2 text-sm text-gray-300 hover:bg-neutral-800 hover:text-white"
                onClick={() => setShowDropdown(false)}
              >
                Profile
              </Link>
              <button
                onClick={() => { logout(); navigate('/login'); }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-neutral-800 hover:text-white"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

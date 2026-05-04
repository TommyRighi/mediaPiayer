import { Link, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';
import OnlineUsers from './OnlineUsers';

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/80 to-transparent px-4 md:px-8 py-3 flex items-center gap-4 md:gap-8">
        <Link to="/" className="text-red-600 font-bold text-xl md:text-2xl tracking-tighter">MediaPiayer</Link>

        <div className="hidden md:flex items-center gap-6 text-sm text-gray-300">
          <Link to="/" className="hover:text-white transition">Home</Link>
          {isAdmin && <Link to="/upload" className="hover:text-white transition">Upload</Link>}
          {isAdmin && <Link to="/admin" className="hover:text-white transition">Admin</Link>}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <OnlineUsers />
          <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition"
          >
            <div className="w-7 h-7 rounded bg-red-600 flex items-center justify-center text-white text-xs font-bold">
              {user?.display_name?.charAt(0).toUpperCase()}
            </div>
            <span className="hidden sm:inline">{user?.display_name}</span>
          </button>

          {showDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
              <div className="absolute right-0 top-10 w-48 bg-neutral-900 border border-neutral-700 rounded-lg shadow-lg py-1 z-50">
                <Link
                  to="/"
                  className="block px-4 py-2.5 text-sm text-gray-300 hover:bg-neutral-800 hover:text-white md:hidden"
                  onClick={() => setShowDropdown(false)}
                >
                  Home
                </Link>
                {isAdmin && (
                  <Link
                    to="/upload"
                    className="block px-4 py-2.5 text-sm text-gray-300 hover:bg-neutral-800 hover:text-white md:hidden"
                    onClick={() => setShowDropdown(false)}
                  >
                    Upload
                  </Link>
                )}
                {isAdmin && (
                  <Link
                    to="/admin"
                    className="block px-4 py-2.5 text-sm text-gray-300 hover:bg-neutral-800 hover:text-white md:hidden"
                    onClick={() => setShowDropdown(false)}
                  >
                    Admin
                  </Link>
                )}
                <div className="border-t border-neutral-700 md:hidden" />
                <Link
                  to="/profile"
                  className="block px-4 py-2.5 text-sm text-gray-300 hover:bg-neutral-800 hover:text-white"
                  onClick={() => setShowDropdown(false)}
                >
                  Profile
                </Link>
                <button
                  onClick={() => { logout(); navigate('/login'); }}
                  className="block w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-neutral-800 hover:text-white"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
          </div>
        </div>

        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden text-gray-300 hover:text-white p-1"
          aria-label="Menu"
        >
          {menuOpen ? (
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" /></svg>
          )}
        </button>
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 top-12 z-40 bg-black/95 pt-4 px-6 md:hidden" onClick={() => setMenuOpen(false)}>
          <div className="flex flex-col gap-4 text-lg" onClick={(e) => e.stopPropagation()}>
            <Link to="/" className="text-gray-200 hover:text-white py-2 border-b border-neutral-800" onClick={() => setMenuOpen(false)}>Home</Link>
            {isAdmin && <Link to="/upload" className="text-gray-200 hover:text-white py-2 border-b border-neutral-800" onClick={() => setMenuOpen(false)}>Upload</Link>}
            {isAdmin && <Link to="/admin" className="text-gray-200 hover:text-white py-2 border-b border-neutral-800" onClick={() => setMenuOpen(false)}>Admin</Link>}
            <Link to="/profile" className="text-gray-200 hover:text-white py-2 border-b border-neutral-800" onClick={() => setMenuOpen(false)}>Profile</Link>
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="text-gray-200 hover:text-white py-2 text-left"
            >
              Sign out
            </button>
          </div>
        </div>
      )}

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
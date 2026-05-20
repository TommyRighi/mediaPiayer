import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PlayerProvider } from '../context/PlayerContext';
import Sidebar from './Sidebar';
import AudioPlayer from './AudioPlayer';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  return (
    <PlayerProvider>
      <div className="min-h-screen" style={{ background: 'var(--jf-bg)' }}>
        <Sidebar
          collapsed={sidebarCollapsed}
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
        />

        <header className={`jf-topbar ${sidebarCollapsed ? 'jf-topbar-collapsed' : ''}`}>
          <button
            onClick={() => {
              if (window.innerWidth < 768) {
                setMobileOpen(!mobileOpen);
              } else {
                setSidebarCollapsed(!sidebarCollapsed);
              }
            }}
            className="p-2 rounded hover:bg-white/10 transition"
            aria-label="Toggle sidebar"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="rgba(255,255,255,0.7)"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" /></svg>
          </button>

          <div className="flex-1" />

          <OnlineIndicator />

          <div className="relative ml-3">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2"
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--jf-primary)', color: 'var(--jf-bg)' }}>
                {user?.display_name?.charAt(0).toUpperCase()}
              </div>
            </button>

            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div className="absolute right-0 top-10 w-48 rounded-lg shadow-lg py-1 z-50" style={{ background: 'var(--jf-surface)', border: '1px solid var(--jf-divider)' }}>
                  <div className="px-4 py-2.5 text-sm" style={{ color: 'var(--jf-text-secondary)' }}>
                    {user?.display_name}
                  </div>
                  <div style={{ borderTop: '1px solid var(--jf-divider)' }} />
                  <button
                    onClick={() => { setShowUserMenu(false); navigate('/profile'); }}
                    className="block w-full text-left px-4 py-2.5 text-sm hover:bg-white/10"
                    style={{ color: 'var(--jf-text-primary)' }}
                  >
                    Profile
                  </button>
                  <button
                    onClick={() => { logout(); navigate('/login'); }}
                    className="block w-full text-left px-4 py-2.5 text-sm hover:bg-white/10"
                    style={{ color: 'var(--jf-text-primary)' }}
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className={`jf-main ${sidebarCollapsed ? 'jf-main-collapsed' : ''}`}>
          <Outlet />
        </main>

        <AudioPlayer />
      </div>
    </PlayerProvider>
  );
}

function OnlineIndicator() {
  return (
    <div className="hidden md:flex items-center gap-1.5 text-xs" style={{ color: 'var(--jf-text-muted)' }}>
      <div className="w-2 h-2 rounded-full" style={{ background: 'var(--jf-primary)' }} />
    </div>
  );
}
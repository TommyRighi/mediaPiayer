import { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PlayerProvider } from '../context/PlayerContext';
import Sidebar from './Sidebar';
import AudioPlayer from './AudioPlayer';
import { WatchlistProvider } from '../context/WatchlistContext';
import useMobileViewport from '../hooks/useMobileViewport';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMobileViewport();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const menuButton = useRef(null);
  const profileButton = useRef(null);
  const search = () => { setMobileOpen(false); setShowUserMenu(false); navigate('/', { state: { searchRequest: Date.now() } }); };
  useEffect(() => {
    const keydown = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMobileOpen(false); setShowUserMenu(false);
        navigate('/', { state: { searchRequest: Date.now() } });
      }
      if (event.key === 'Escape') {
        if (mobileOpen) menuButton.current?.focus();
        else if (showUserMenu) profileButton.current?.focus();
        setMobileOpen(false); setShowUserMenu(false);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [navigate, mobileOpen, showUserMenu]);
  useEffect(() => {
    if (!mobileOpen || !isMobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [mobileOpen, isMobile]);
  const pageName = location.pathname.startsWith('/music') ? 'Music' : location.pathname === '/my-list' ? 'My List' : location.pathname === '/calendar' ? 'Calendar' : location.pathname === '/profile' ? 'Profile' : location.pathname === '/join' ? 'Watch Party' : location.pathname === '/admin' ? 'Admin' : location.pathname === '/settings' ? 'Settings' : location.pathname === '/downloads' ? 'Downloads' : location.pathname === '/upload' ? 'Upload' : location.pathname.startsWith('/movie') || location.pathname.startsWith('/series') ? 'Details' : location.search.includes('type=movie') ? 'Movies' : location.search.includes('type=series') ? 'Series' : new URLSearchParams(location.search).get('q') ? 'Search results' : 'Home';

  return (
    <PlayerProvider><WatchlistProvider>
      <div className="min-h-screen" style={{ background: 'var(--jf-bg)' }}>
        <a className="jf-skip-link" href="#main-content">Skip to content</a>
        <Sidebar
          collapsed={!isMobile && sidebarCollapsed}
          isMobile={isMobile}
          mobileOpen={mobileOpen}
          onClose={() => { setMobileOpen(false); if (isMobile) menuButton.current?.focus(); }}
        />

        <header className={`jf-topbar ${sidebarCollapsed ? 'jf-topbar-collapsed' : ''}`}>
          <button
            ref={menuButton}
            aria-controls="primary-navigation"
            aria-expanded={isMobile ? mobileOpen : !sidebarCollapsed}
            onClick={() => {
              if (isMobile) {
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

          <span className="jf-page-name">{pageName}</span>
          <div className="flex-1" />
          <button className="jf-search-shortcut" onClick={search} aria-label="Search library" aria-keyshortcuts="Meta+K Control+K"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg><span>Search</span><kbd>⌘ / Ctrl K</kbd></button>

          <div className="relative ml-3">
            <button
              ref={profileButton}
              aria-label="Account menu"
              aria-expanded={showUserMenu}
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
                    onClick={async () => { await logout(); navigate('/login'); }}
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

        <main id="main-content" tabIndex={-1} className={`jf-main ${sidebarCollapsed ? 'jf-main-collapsed' : ''}`}>
          <Outlet />
        </main>

        <AudioPlayer />
      </div>
    </WatchlistProvider></PlayerProvider>
  );
}

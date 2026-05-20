import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/?type=movie', label: 'Movies', icon: 'movie' },
  { path: '/?type=series', label: 'Series', icon: 'series' },
  { path: '/music', label: 'Music', icon: 'music' },
];

const adminItems = [
  { path: '/upload', label: 'Upload', icon: 'upload' },
  { path: '/admin', label: 'Admin', icon: 'admin' },
];

function NavIcon({ icon }) {
  switch (icon) {
    case 'home':
      return <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg>;
    case 'movie':
      return <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z" /></svg>;
    case 'series':
      return <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z" /></svg>;
    case 'music':
      return <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>;
    case 'upload':
      return <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" /></svg>;
    case 'admin':
      return <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z" /></svg>;
    case 'party':
      return <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" /></svg>;
    case 'profile':
      return <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>;
    case 'logout':
      return <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" /></svg>;
    default:
      return null;
  }
}

export default function Sidebar({ collapsed, mobileOpen, onClose }) {
  const { isAdmin } = useAuth();
  const location = useLocation();

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/' && !location.search;
    if (path.includes('?')) return location.pathname + location.search === path;
    return location.pathname.startsWith(path);
  };

  const allItems = [...navItems, ...(isAdmin ? adminItems : [])];

  return (
    <>
      <div className={`jf-sidebar-overlay ${mobileOpen ? 'jf-sidebar-overlay-mobile-open' : ''}`} onClick={onClose} />
      <nav className={`jf-sidebar ${collapsed ? 'jf-sidebar-collapsed' : ''} ${mobileOpen ? 'jf-sidebar-mobile-open' : ''}`}>
        <div className="jf-sidebar-brand">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          {!collapsed && <span>MediaPiayer</span>}
        </div>

        <div className="jf-sidebar-nav">
          {allItems.map(({ path, label, icon }) => (
            <Link
              key={path}
              to={path}
              onClick={onClose}
              className={`jf-sidebar-item ${isActive(path) ? 'jf-sidebar-item-active' : ''}`}
              title={collapsed ? label : undefined}
            >
              <NavIcon icon={icon} />
              {!collapsed && <span>{label}</span>}
            </Link>
          ))}
        </div>

        <div className="jf-sidebar-footer">
          <Link
            to="/join"
            onClick={onClose}
            className={`jf-sidebar-item ${isActive('/join') ? 'jf-sidebar-item-active' : ''}`}
            title={collapsed ? 'Watch Party' : undefined}
          >
            <NavIcon icon="party" />
            {!collapsed && <span>Watch Party</span>}
          </Link>
          <Link
            to="/profile"
            onClick={onClose}
            className={`jf-sidebar-item ${isActive('/profile') ? 'jf-sidebar-item-active' : ''}`}
            title={collapsed ? 'Profile' : undefined}
          >
            <NavIcon icon="profile" />
            {!collapsed && <span>Profile</span>}
          </Link>
        </div>
      </nav>
    </>
  );
}
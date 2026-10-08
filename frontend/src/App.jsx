import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
const WatchlistPage = lazy(() => import('./pages/WatchlistPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DownloadsPage = lazy(() => import('./pages/DownloadsPage'));
const MusicManagePage = lazy(() => import('./pages/MusicManagePage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const BrowsePage = lazy(() => import('./pages/BrowsePage'));
const MediaDetailPage = lazy(() => import('./pages/MediaDetailPage'));
const WatchPage = lazy(() => import('./pages/WatchPage'));
const UploadPage = lazy(() => import('./pages/UploadPage'));
const PartyRoom = lazy(() => import('./pages/PartyRoom'));
const JoinPartyPage = lazy(() => import('./pages/JoinPartyPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const MusicPage = lazy(() => import('./pages/MusicPage'));
const AlbumDetailPage = lazy(() => import('./pages/AlbumDetailPage'));
const PlaylistDetailPage = lazy(() => import('./pages/PlaylistDetailPage'));

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="flex items-center justify-center min-h-screen text-gray-400">Loading...</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  return children;
}

function AdminRoute({ children }) {
  const { user, loading, isAdmin } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen text-gray-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

function PublicRoute({ children }) {
  const location = useLocation();
  const from = location.state?.from;
  const destination = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login') ? from : '/';
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen text-gray-400">Loading...</div>;
  if (user) return <Navigate to={destination} replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<div className="min-h-[60vh] grid place-items-center" role="status">Loading…</div>}>
        <Routes>
          <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<BrowsePage />} />
            <Route path="movie/:id" element={<MediaDetailPage />} />
            <Route path="series/:id" element={<MediaDetailPage />} />
            <Route path="upload" element={<AdminRoute><UploadPage /></AdminRoute>} />
            <Route path="scene/:partyId" element={<PartyRoom />} />
            <Route path="join" element={<JoinPartyPage />} />
            <Route path="admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
            <Route path="my-list" element={<WatchlistPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
            <Route path="downloads" element={<AdminRoute><DownloadsPage /></AdminRoute>} />
            <Route path="music/manage" element={<AdminRoute><MusicManagePage /></AdminRoute>} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="music" element={<MusicPage />} />
            <Route path="music/album/:id" element={<AlbumDetailPage />} />
            <Route path="music/playlist/:id" element={<PlaylistDetailPage />} />
          </Route>
          <Route path="/watch/:mediaId" element={<ProtectedRoute><WatchPage /></ProtectedRoute>} />
          <Route path="/watch/:mediaId/:episodeId" element={<ProtectedRoute><WatchPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

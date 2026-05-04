import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import BrowsePage from './pages/BrowsePage';
import MediaDetailPage from './pages/MediaDetailPage';
import WatchPage from './pages/WatchPage';
import UploadPage from './pages/UploadPage';
import PartyRoom from './pages/PartyRoom';
import JoinPartyPage from './pages/JoinPartyPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen text-gray-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen text-gray-400">Loading...</div>;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<BrowsePage />} />
            <Route path="movie/:id" element={<MediaDetailPage />} />
            <Route path="series/:id" element={<MediaDetailPage />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="scene/:partyId" element={<PartyRoom />} />
            <Route path="join" element={<JoinPartyPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
          <Route path="/watch/:mediaId" element={<ProtectedRoute><WatchPage /></ProtectedRoute>} />
          <Route path="/watch/:mediaId/:episodeId" element={<ProtectedRoute><WatchPage /></ProtectedRoute>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

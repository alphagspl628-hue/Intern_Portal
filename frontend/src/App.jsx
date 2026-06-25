import { Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './LandingPage'
import Login from './Login'
import AdminDashboard from './AdminDashboard'
import InternDashboard from './InternDashboard'
import TeamLeaderDashboard from './TeamLeaderDashboard'
import NotFound from './NotFound'

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/intern" element={<InternDashboard />} />
        <Route path="/team-leader" element={<TeamLeaderDashboard />} />
        {/* Backwards-compatible aliases */}
        <Route path="/dashboard" element={<Navigate to="/admin" replace />} />
        <Route path="/intern-login" element={<Navigate to="/login" replace />} />
        {/* Catch-all 404 for any unknown URL */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  )
}

export default App

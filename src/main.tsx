import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ProfilePage } from './components/profile/ProfilePage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Main app - must be first to avoid catching as username */}
        <Route path="/" element={<App />} />
        {/* Profile pages - voyomusic.com/username */}
        <Route path="/:username" element={<ProfilePage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)

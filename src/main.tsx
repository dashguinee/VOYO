import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ProfilePage } from './components/profile/ProfilePage'

// ── Service worker auto-update wiring (ported from Tivi+) ──
// Register the SW with `updateViaCache: 'none'` so the browser always
// refetches sw.js (not the cached version). Schedule reg.update() every
// 5 minutes so a long-lived tab catches new builds without a manual refresh.
// When the SW activates with a new cache, it postMessages SW_UPDATED — we
// translate that into a `voyo-update-available` window event for the
// UpdateButton component to consume.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' })
      .then((reg) => {
        setInterval(() => { reg.update(); }, 5 * 60 * 1000);
      })
      .catch((err) => console.warn('[VOYO] SW registration failed:', err));
  });

  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'SW_UPDATED') {
      window.dispatchEvent(new CustomEvent('voyo-update-available'));
    }
  });
}

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

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ProfilePage } from './components/profile/ProfilePage'

// ── PWA rotation safety net ──
// Manifest sets "orientation": "any" and no code locks orientation today,
// but a stale WebAPK (built when the manifest was "portrait") can keep the
// installed PWA locked until Chrome rebuilds it. Calling unlock() on boot
// makes runtime rotation work immediately — some engines throw
// NotSupportedError unless in fullscreen, so we swallow.
try { (screen.orientation as { unlock?: () => void } | undefined)?.unlock?.(); } catch { /* expected on iOS / non-fullscreen */ }

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
        // Battery: skip updates when tab is backgrounded; bumped 5min → 15min
        // (still surfaces fresh deploys quickly, ~96 wakes/day → ~32, and
        // the visibility guard stops idle/locked-screen wakes entirely).
        setInterval(() => {
          if (document.hidden) return;
          reg.update();
        }, 15 * 60 * 1000);
      })
      .catch(() => { /* SW registration failed — non-critical, app works without it */ });
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

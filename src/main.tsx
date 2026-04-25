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
        // Battery: skip updates when tab is backgrounded. Bumped 15min → 60min
        // (~32 wakes/day → ~8). Most user sessions are <60min anyway, so the
        // window between deploy and the user seeing the prompt rarely matters
        // — and visibilitychange below handles foreground returns immediately.
        setInterval(() => {
          if (document.hidden) return;
          reg.update();
        }, 60 * 60 * 1000);
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

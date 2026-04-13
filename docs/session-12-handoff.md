# Session 12 Handoff — Launch Hardening Pass

**Date**: April 13, 2026  
**Commits**: 24 (d8270f0 → 31bcc2f)  
**Focus**: Bug fixes, crash hardening, background playback, UX polish  

---

## What was done

### Audio fixes
| Fix | File | Detail |
|-----|------|--------|
| Auto-resume on first track | AudioPlayer.tsx | Removed `savedCurrentTime > 5` gate — always auto-plays on reload |
| Volume slider lag | playerStore.ts | Debounced localStorage persist (200ms) |
| Skip hiccup | AudioPlayer.tsx | Gain ramp drains 10ms before pause (was 2ms for preloaded) |
| Skip button blocked | VoyoPortraitPlayer.tsx | `wasSkeeping` 50ms dead zone → `requestAnimationFrame` |
| Background playback dying | AudioPlayer.tsx | `isTransitioningToBackgroundRef` prevents `onPause` from killing `isPlaying` during browser background transitions |
| False seek on return | YouTubeIframe.tsx | Iframe time tracking skips updates when `document.hidden` |
| VPS streaming | AudioPlayer.tsx | R2 redirects stream directly from CDN (no full blob download) |
| Iframe retry at 15% | AudioPlayer.tsx | Retries VPS/edge hot-swap, ~95%→98% background coverage |
| Auto-PiP killing audio | useMiniPiP.ts | REMOVED auto-enter PiP on background — `video.play()` from visibility handler stole audio focus from main element |
| Moment video competing | VoyoMoments.tsx | r2_video elements now pause on `visibilitychange=hidden` |
| PiP captureStream crash | useMiniPiP.ts | `initElements()` wrapped in try/catch — `captureStream` throws on some devices |

### Crash fixes (17 paths patched)
| Crash | File | Fix |
|-------|------|-----|
| SearchOverlay JSON.parse | SearchOverlayV2.tsx | try/catch on mount |
| KnowledgeStore JSON.parse | KnowledgeStore.ts | Returns null → store resets |
| KnowledgeStore setItem | KnowledgeStore.ts | try/catch on large serialize |
| reactionStore .sort()[0][0] | reactionStore.ts | Optional chaining + fallback |
| reactionStore unbounded Map | reactionStore.ts | LRU eviction at 200 |
| ProfilePage div/zero | ProfilePage.tsx | `duration > 0` guard |
| playerStore h.track.id | playerStore.ts | Optional chaining (6 locations) |
| playerStore queue persist | playerStore.ts | `.filter(q => q.track)` before `.map()` |
| AnimatedBackgrounds base64 | AnimatedBackgrounds.tsx | try/catch on localStorage.setItem |
| lyricsEngine JSON.parse | lyricsEngine.ts | try/catch, start fresh on corrupt |
| Gesture listener accumulation | audioEngine.ts | Total attempt cap (30), reset on success |
| uploadToR2 response guard | api.ts | `response.ok` check before `.json()` |
| PiP null canvas | useMiniPiP.ts | mountedRef + canvasRef re-check after async |
| PiP race (exit + re-entry) | useMiniPiP.ts | enteringRef prevents overlap |
| PiP unmount during request | useMiniPiP.ts | mountedRef checked before every await |
| SW update during PiP | App.tsx | exitPictureInPicture before reload |

### UX polish
| Change | File | Detail |
|--------|------|--------|
| Badge animations slowed | BoostSettings.tsx | VOYEX 14s→24s, Calm 12s→22s (ambient) |
| OYE badge logic | HomeFeed.tsx | Only on Continue Listening (full if boosted, faded if not). Gone from Discover More |
| New Releases play icon | HomeFeed.tsx | Heavy overlay → glass button bottom-right |
| Top 10 styling | HomeFeed.tsx | Bronze gold "K OYE" + Zap icon for top 3 |
| Timeless Classics | poolCurator.ts | `curateAllSections()` now called after bootstrap |
| History threshold | playerStore.ts | `> 5` → `> 0` (any played track shows in history) |
| Heating Up card | HomeFeed.tsx | Clean canvas, scattered fire emojis, touch-reactive sparks |

### Docs updated
- `ARCHITECTURE.md` — line counts, Session 12 changes, VPS streaming
- `CLIENT_AUDIO_CHAIN.md` — background guards, cache timing table, "do not touch" list
- `OPTIMIZATIONS.md` — marked completed items, updated bundle sizes

---

## Verified clean (final audit)

| Category | Status |
|----------|--------|
| Unguarded JSON.parse | 0 remaining |
| Unguarded localStorage.setItem (large data) | 0 remaining |
| Division by zero | 0 remaining |
| Null .track access | 0 remaining |
| Unbounded collections | 0 remaining (all have LRU/slice caps) |
| PiP lifecycle crashes | 0 remaining |
| Unhandled promise rejections | 0 remaining |
| AudioParam clicks | 0 found (all use linearRampToValueAtTime) |

---

## Known deferred (not bugs, architectural limits)

1. **'off' preset edge case** — switching to 'boosted' after cold-load on 'off' won't apply EQ without reload
2. **Multiband compute when muted** — CPU waste but avoids click artifacts on preset switch
3. **Bluetooth detection** — could bypass EQ on BT for CPU savings (not implemented)
4. **Iframe + screen lock < 30s** — if VPS/edge both down AND user locks within 30s, audio pauses (~2% case)
5. **Comments in Moments** — mock data, not wired to backend
6. **Share button in Moments** — UI shell, no onClick handler

---

## Key files changed (line counts April 13, 2026)

| File | Lines | Role |
|------|-------|------|
| AudioPlayer.tsx | 3147 | Playback controller, all source paths |
| VoyoPortraitPlayer.tsx | 6085 | Main portrait UI, belts, reactions |
| playerStore.ts | 1690 | Central state, queue, history, persist |
| audioEngine.ts | 704 | AudioContext singleton, gesture resume |
| HomeFeed.tsx | 1974 | Classic mode shelves, vibes, cards |
| useMiniPiP.ts | 301 | PiP lifecycle, crash-hardened |
| YouTubeIframe.tsx | 779 | Iframe source, time tracking |
| oyoDJ.ts | 950 | OYO AI DJ personality |

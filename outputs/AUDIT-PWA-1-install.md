# AUDIT PWA 1 — Install flow (first visit → standalone on device)

Scope: the install funnel as shipped in v385–v389. Two install surfaces are
rendered unconditionally at the bottom of `App.tsx` (line 1119–1120): a
floating `<InstallButton/>` pill (bottom-right) and a top-of-screen
`<InstallBanner/>` that fires 8s after mount once per session. Both consume
`usePWA()` which owns platform detection, the `beforeinstallprompt` deferred
event, the `appinstalled` event, a persistent `voyo-pwa-installed-at`
localStorage latch, and the `getInstalledRelatedApps()` probe. On iOS, and on
Android Chrome when `beforeinstallprompt` is suppressed, both surfaces route
to `<IOSInstallSheet/>` — a bottom-sheet with branch-by-platform manual
instructions guarded by `useBackGuard`. Install telemetry is wired end-to-end
(`pwa_install_shown` / `_clicked` / `_sheet_opened` / `_accepted` / `_dismissed`
/ `_completed`). Manifest has maskable icons from 192px up, a self-referencing
`related_applications` entry, `display: standalone`, two `shortcuts` and a
`share_target`. The flow is mostly coherent but has several sharp corners —
platform fall-through bugs, a dismiss cooldown that also catches genuinely
uninstalled users, a race between the banner 8s delay and the pill rendering
immediately, and an install-detection gap that lets the banner keep firing
after the user has actually installed.

---

## P0 · `setIsInstallable(true)` fires on EVERY platform including `unknown`, before we know if we can actually install

**Location:** `src/hooks/usePWA.ts:88`
**Severity:** P0 — this is the root of almost every platform-fallthrough
bug below, including iOS users getting the pill on a device we can never
programmatically install to, and desktop browsers that straight-up don't
support PWA install (Firefox, Safari macOS) still showing install UI.

```
// Always installable otherwise — the click handler routes to native
// prompt if Chrome fires one, else to manual instructions.
setIsInstallable(true);
```

The line runs unconditionally after the related-apps branch. This means:

1. **`platform === 'unknown'`** (SSR, odd UA strings, WebView, in-app
   browsers like Instagram/TikTok/Facebook): `isInstallable = true`, user
   taps pill, `hasNativePrompt` is false, so we open `IOSInstallSheet` with
   `isIOS === false` → "Open the browser menu (⋮ top-right). Tap Install
   app or Add to Home screen." That instruction is WRONG for every in-app
   browser (Instagram has no install menu), every desktop Safari (no Add
   to Home screen), and every embedded WebView. The user can't follow the
   steps and has no escape hatch. This is the single worst UX leak in the
   install flow.
2. **Desktop Firefox / Safari macOS**: `hasNativePrompt = false` permanently
   (neither browser fires `beforeinstallprompt`), so the fallback path
   shows the "Open the browser menu" instructions. Firefox on desktop
   doesn't have PWA install at all. The user clicks, reads the steps,
   nothing maps to reality.
3. **iOS Chrome / iOS Firefox / iOS Edge**: `platform === 'ios'`
   (detected by UA, all iOS browsers use WebKit so the UA test passes),
   but the Share → Add to Home Screen path only works in Safari. iOS
   Chrome has no A2HS path at all — the sheet's instructions are
   impossible to execute. Same for iOS Firefox.

**Why:** `isInstallable` is really two orthogonal states: "we have a native
prompt to fire" and "we can show manual instructions that will actually
work on this UA." The code conflates them.

**Fix:**
1. Only set `isInstallable = true` when:
   - `platform === 'android'` (any Android browser can at least get
     through the menu)
   - `platform === 'ios'` AND the UA test proves Safari (exclude CriOS,
     FxiOS, EdgiOS)
   - `platform === 'desktop'` AND `hasNativePrompt` (i.e. wait for
     `beforeinstallprompt`, don't preemptively show UI)
2. In `detectPlatform()`, add an `embeddedBrowser` sentinel based on UA
   fragments (`Instagram`, `FBAN`, `FBAV`, `Line`, `Twitter`, `TikTok`,
   `; wv)` WebView marker). Return `isInstallable = false` for these and
   optionally show a different sheet: "Open in Safari/Chrome to install."
3. For desktop non-Chromium (`platform === 'desktop'` && no
   `beforeinstallprompt` within 5s of mount), just hide the UI — there
   is no install path.

---

## P0 · `isInstalled` localStorage latch is one-way: an uninstalled user can never clear it

**Location:** `src/hooks/usePWA.ts:19, 36–42, 47, 64–67`
**Severity:** P0 — this is the "silent install UI disappearance" bug. Once
`voyo-pwa-installed-at` is written (by the `appinstalled` event, by
`getInstalledRelatedApps`, by the standalone check, or by the install
callback on accept), no code path ever clears it. If the user then
uninstalls the PWA from their home screen, every subsequent visit to
voyomusic.com reads the latch and skips the entire install flow. The user
is permanently opted out.

```
function readInstalledFlag(): boolean {
  try { return !!localStorage.getItem(INSTALLED_KEY); } catch { return false; }
}

function writeInstalledFlag() {
  try { localStorage.setItem(INSTALLED_KEY, String(Date.now())); } catch {}
}
// No clearInstalledFlag anywhere in the file.
```

Note: uninstalling a PWA does NOT clear its localStorage by default on
either Chrome Android or Safari iOS — the origin's storage is separate
from the installed WebAPK shell. So the latch survives uninstall and
continues to gate the install UI in the browser tab.

Secondary failure: if the user installs on Device A (same Google account,
same Chrome sync) and then opens the site in Chrome on Device B where the
PWA is NOT installed, `getInstalledRelatedApps()` returns empty but
localStorage is likely NOT synced across devices (it's per-origin per-
browser-profile but NOT Chrome Sync'd by default). So Device B works
correctly. But if the user clears storage on Device A then re-opens, they
get the install UI back only because storage was cleared, not because of
a deliberate "am I actually installed right now" check.

**Why:** `isStandaloneDisplay()` is the only ground-truth signal — it's
measured at open time in the running document. `getInstalledRelatedApps()`
is the only other real-time signal. `localStorage` is a CACHE of prior
signals and is not invalidated when the underlying state changes.

**Fix:**
1. On every mount, run `getInstalledRelatedApps()` (when available) and
   use its result to CLEAR the localStorage latch if it returns empty on
   a platform where it's reliable (Android Chrome, desktop Chrome). Do
   NOT clear on iOS Safari (the API isn't supported there, so empty
   doesn't mean "uninstalled").
2. Treat the localStorage latch as an optimistic hint only — boot initial
   state as `isStandaloneDisplay() || readInstalledFlag()` (as today) for
   first-paint, but within the effect override to `isStandaloneDisplay()
   || relatedApps.length > 0`. Do this synchronously after the probe
   lands.
3. Alternative simpler fix: make the latch TTL-expire — e.g. 90 days.
   If the user hasn't appeared in standalone-mode or shown up in
   `getInstalledRelatedApps()` within 90 days, assume uninstalled and
   clear.

---

## P1 · Banner and pill render the same install CTA in parallel — double-firing telemetry and cognitive noise

**Location:** `src/App.tsx:1119–1120` + `InstallButton.tsx:46` +
`InstallBanner.tsx:164`
**Severity:** P1 — user sees two install pills on screen at once for up to
10 seconds, and `pwa_install_shown` fires twice per session on every
installable session (once pill, once banner), inflating the funnel's
"shown" count and breaking the shown-to-accepted conversion metric.

The pill is rendered immediately on mount and stays forever (`fixed bottom-24
right-4`). The banner shows 8s after mount and auto-hides after 10s
(`InstallBanner.tsx:13, 17`). Between seconds 8 and 18, both are visible.
Both trace `pwa_install_shown` with different `surface` values, both are
tappable, both route to the same install code path. If a user taps the
pill AND the banner's Install button (or opens the sheet twice because the
first pill tap routed them to the sheet and a second tap on the banner
opens a parallel sheet), they get double state transitions.

Specifically:
- `pwa_install_shown` fires at t=0 (pill) and t=8s (banner) for every
  installable session. Funnel math reads "two shows per session" which is
  wrong — the user saw one install concept.
- Both surfaces open `IOSInstallSheet` via their own local `iosSheetOpen`
  state. Tapping pill → sheet opens. Behind the sheet, the banner is
  still rendering its own JSX (see `InstallBanner.tsx:252`) and its own
  separate `<IOSInstallSheet/>` instance with its own `open` flag. If the
  banner auto-dismisses while the pill's sheet is open, nothing visible
  happens — but telemetry fires `pwa_install_dismissed surface=banner
  dismiss_type=auto` while the user is mid-read of the sheet instructions.
  The "dismissed" event is a false signal.

**Why:** Two surfaces for the same CTA was the v387 plan ("banner moves to
profile-icon + swipe-up dismiss + 10s auto-hide") but the old pill from
v385 is still mounted — InstallButton.tsx:46 wasn't removed when the
banner was added.

**Fix:**
1. Decide: the banner is the primary surface (v387's intent), the pill is
   the fallback. When the banner is showing or has been seen this session,
   the pill should NOT render. Add a shared piece of state (`usePWAStore`
   Zustand, or a ref on the hook return) indicating "banner owns the
   install moment right now."
2. Consolidate the `pwa_install_shown` event — fire it ONCE per session
   regardless of which surface rendered, with `surfaces: ['pill',
   'banner']` in meta.
3. Dedupe the `IOSInstallSheet` — lift it to `App.tsx` level, have both
   surfaces dispatch "open sheet" through a shared store. One sheet
   instance, one open flag, no parallel copies.

---

## P1 · 14-day dismiss cooldown is independent from `isInstalled` — dismissing once after uninstall hides the install UI for 2 weeks

**Location:** `src/components/ui/InstallBanner.tsx:6–7, 23–33, 69, 91–100`
**Severity:** P1 — interacts with the P0 latch bug above. Even after fixing
the latch to correctly detect uninstall, a user who dismissed the banner
anywhere in the prior 14 days will not see it again.

```
const DISMISS_KEY = 'voyo-install-banner-dismissed-at';
const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
// ...
if (wasSeenThisSession() || isDismissedRecently()) return;
```

The cooldown key is not cleared on `appinstalled` and not cleared on
uninstall. Scenario:
1. Day 0: user visits, banner shows at 8s, user swipes up → `DISMISS_KEY`
   set to today, cooldown until Day 14.
2. Day 2: user decides they DO want to install. Opens voyomusic.com. The
   pill is still there (that's the escape hatch), but the banner — the
   v385 "install moment" — is gone. Pill-only install is fine on desktop
   but the banner's higher prominence is exactly what was designed to
   convert on mobile where the pill is small and in the thumb's way.
3. User taps pill → install succeeds → `voyo-pwa-installed-at` set.
4. Day 5: user uninstalls from home screen.
5. Day 6: user opens voyomusic.com. The P0 latch bug means install UI is
   hidden entirely. Even if we fix that, the banner dismiss cooldown is
   still active until Day 14.

The install ACCEPT path (`InstallBanner.tsx:115–118`) does NOT clear
`DISMISS_KEY`. If the user accepts install and later uninstalls, the
stale dismiss timestamp (from the very first dismissal weeks earlier) is
still there — except in this case `accepted` actually writes a FRESH
`DISMISS_KEY = Date.now()` via the `installed` dismiss branch (line 112,
via the manual-instructions path). Wait, but the native-install-accept
branch at line 116–118 does NOT set `DISMISS_KEY`. So behavior diverges
by platform.

**Why:** The cooldown encodes "user dismissed" but is used as "don't
show." Those diverge when the user's install state changes.

**Fix:**
1. On `appinstalled` event, clear `DISMISS_KEY` and `SESSION_KEY`
   (InstallBanner's sessionStorage flag). If the user later uninstalls,
   they're fresh for the next visit.
2. On cooldown check, first check `isInstalled` — if false (genuinely
   uninstalled), cooldown is moot. Shorten it to 3–7 days for
   uninstalled users.
3. Don't call `DISMISS_KEY` writes on the install-accept branch at all
   — the install success already hides the banner via `isInstalled`
   changing. Current code only writes `DISMISS_KEY` on the iOS/manual
   path at line 111, which is inconsistent and also means an iOS user
   who opens the sheet and taps "Got it" gets a 14-day cooldown before
   the banner comes back — even if they never actually installed.

---

## P1 · `getInstalledRelatedApps()` Promise doesn't gate the `setIsInstallable(true)` call, so install UI flashes even on installed devices

**Location:** `src/hooks/usePWA.ts:74–88`
**Severity:** P1 — on Chrome Android with the PWA installed, a returning
user opening voyomusic.com in a browser tab (not the standalone) will
briefly see the pill render before the related-apps Promise resolves and
hides it. The comment at line 72–73 acknowledges this:

```
// Runs async so the first render may still flash install UI briefly on
// installed devices — that's why writeInstalledFlag() above latches the
// state permanently.
```

The latch protects subsequent visits — but the FIRST visit ever, before
the latch exists (fresh storage, cleared storage, incognito/private tab
that matches a Chrome profile that DID install the PWA), will always
flash. Relying on `writeInstalledFlag` for persistence doesn't help the
one case where it matters most: someone who installed but later cleared
their browser data.

On top of the flash, the pill fires `pwa_install_shown` telemetry during
the flash window (because the InstallButton effect runs before the
related-apps Promise lands). So the funnel's "shown" count is inflated
by returning-installed users even though the UI was visible for <100ms.

**Fix:**
1. Add a `resolving: boolean` state (initial `true`) to the hook. Render
   install UI only when `!resolving && isInstallable && !isInstalled`.
2. Set `resolving = false` either after the related-apps Promise resolves
   or after a 500ms timeout (fallback for browsers without the API) —
   whichever comes first.
3. Alternatively, latch the `pwa_install_shown` trace inside a
   `setTimeout(..., 100)` that's cancelled if `isInstalled` flips before
   firing — so a resolve-within-100ms doesn't log a false shown.

---

## P1 · `appinstalled` event listener is never attached when user lands in standalone mode — loses completion telemetry and persists stale `isInstallable=true`

**Location:** `src/hooks/usePWA.ts:56–60, 104–110`
**Severity:** P1 — edge but important for telemetry integrity and future
UI logic.

```
if (isStandaloneDisplay()) {
  setIsInstalled(true);
  writeInstalledFlag();
  return;   // ← exits the effect early, listeners never attached
}
```

The early return at line 59 happens for anyone opening the app AS the
PWA (standalone). That's the correct outcome for UI (hide install
prompts) — BUT the `beforeinstallprompt` and `appinstalled` event
listeners are never wired up. In theory this is fine (a standalone-mode
document can't fire `appinstalled` for itself). In practice:

1. On Chrome Android, if the user opens the standalone PWA AND the PWA
   is uninstalled via a sibling tab's API or a desktop action while the
   standalone is open, there's no cleanup.
2. The `pwa_install_completed` trace at line 101 only fires when the
   handler runs — which requires the listener. If the user installed
   from the browser tab BUT Chrome opened the standalone before the
   `appinstalled` dispatch resolved (rare race), we miss the event.
   This is a minor telemetry gap, not a UX bug.

The similar early return at line 66 (`readInstalledFlag`) also skips the
listener wiring — so a returning user with the latch will never observe
`appinstalled` if they uninstall and reinstall in the same session.

**Why:** Early return pattern saved 4 lines but cost observability and
defensive cleanup.

**Fix:**
1. Always attach the `appinstalled` and `beforeinstallprompt` listeners
   regardless of initial installed state. The listeners are cheap and
   only fire when they fire.
2. Move the `setIsInstalled(true)` + `writeInstalledFlag` calls BEFORE
   the listener wiring, don't return early.

---

## P1 · `install()` doesn't handle the native Chrome re-prompt timing — `deferredPrompt.prompt()` can throw on a second call

**Location:** `src/hooks/usePWA.ts:113–131`
**Severity:** P1 — user taps install on pill, dismisses native dialog,
taps install on banner → second `install()` call.

```
const install = useCallback(async () => {
  if (!deferredPrompt) return false;
  try {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // ...
    setDeferredPrompt(null);
    return outcome === 'accepted';
  } catch { return false; }
}, [deferredPrompt]);
```

Per spec, `BeforeInstallPromptEvent.prompt()` can only be called ONCE —
Chrome will reject `InvalidStateError` on a second call. The try/catch
swallows it (returns false), but the user experience is:
- Tap pill → native dialog appears → user dismisses
- Tap banner → `deferredPrompt` is still the same reference (we set it
  to null AFTER `userChoice` resolves, so during the dialog's open time
  the ref survives) → banner calls `install()` → `prompt()` throws →
  `userChoice` never resolves → we're stuck in an in-flight state.

Actually rereading: the second click can happen AFTER the first dialog
resolves if `setDeferredPrompt(null)` hasn't flushed to the next render
yet (between `await` resolution and React commit). Unlikely but possible
on a slow device.

More practically: in Chrome, after the user dismisses the native dialog,
Chrome will NOT re-dispatch `beforeinstallprompt` for a few minutes. We
`setDeferredPrompt(null)` on dismiss (line 126) → `hasNativePrompt` goes
false → pill/banner now route through the "manual instructions" sheet
which tells the user "Open browser menu → Install app." On Chrome
Android that's technically still installable (the menu has the item),
but the UX is "I tapped install, dismissed it, tapped install again,
now it's showing me instructions for a menu item" — confusing.

**Why:** The deferred-prompt lifecycle is a finite-state thing that
deserves explicit modeling. Currently we model it as a ref that goes
null after one fire.

**Fix:**
1. Track three states: `native-ready`, `native-in-flight`,
   `native-consumed`. In `in-flight`, return early from `install()`
   with `false`, don't re-call `prompt()`.
2. After `native-consumed`, keep showing "Install" with a helpful
   tooltip/sheet but CHANGE the sheet copy: "Chrome's install shortcut
   is used — find it under ⋮ menu → Install app" (not the generic
   manual instructions).
3. Listen for a fresh `beforeinstallprompt` dispatch to flip back to
   `native-ready` — Chrome re-fires eventually, re-arming the UI.

---

## P2 · Session-storage sessionKey makes the banner skip even after a real install-complete in the same tab

**Location:** `src/components/ui/InstallBanner.tsx:9, 35–41, 64–78`
**Severity:** P2 — minor edge, but the banner's "seen this session" check
can fire after the install UI was shown and tapped.

```
const SESSION_KEY = 'voyo-install-banner-seen';
// ...
if (wasSeenThisSession() || isDismissedRecently()) return;

const showTimer = window.setTimeout(() => {
  setVisible(true);
  markSeenThisSession();
  // ...
}, SHOW_DELAY_MS);
```

The session-seen marker is written when the banner shows, not when it's
dismissed. That's fine for the main case. But: if the user opens a long
session, banner shows, user ignores it, auto-hides, user keeps using the
app for 30 minutes, user hits the pill and installs. The banner never
re-shows (correct — they installed). Fine.

Edge: user opens tab, banner shows (t=8s, `SESSION_KEY=1` written), user
dismisses via ×. Then they uninstall another origin's PWA and the storage
gets shared accidentally? Unlikely. More likely: user has two tabs open
— tab A already showed the banner (both storage keys set). Tab B never
sees the banner even though it's a "fresh" tab from their POV. Minor.

**Why:** sessionStorage is tab-scoped but read on mount, which was the
intent — the concern above isn't actually a bug. The real issue is
coordination with the install-accepted branch:

Line 117 (install accepted on native path): calls `dismiss(false,
'installed')` which sets `leaving=true` but doesn't touch `SESSION_KEY`.
Fine. But the `dismiss` function's `remember=false` means `DISMISS_KEY`
is NOT set. If the user then uninstalls in the same session and clears
the installed latch, the banner won't re-show (SESSION_KEY still says
seen). Small edge, most users won't uninstall mid-session.

**Fix:** Clear `SESSION_KEY` on `appinstalled` (let the hook notify the
banner, or move these keys into the hook). Minor cleanup.

---

## P2 · `isInstalled` resets visible to false without resetting `leaving` or `iosSheetOpen` — sheet can linger after install succeeds

**Location:** `src/components/ui/InstallBanner.tsx:64–68, 102–122`
**Severity:** P2 — cosmetic, brief.

```
useEffect(() => {
  if (isInstalled || !isInstallable) {
    setVisible(false);
    return;
  }
  // ...
}, [isInstallable, isInstalled]);
```

When `isInstalled` flips true mid-session (after native-accept or after
an out-of-band install), we set `visible=false` but don't touch
`iosSheetOpen` or `leaving`. If the user had just tapped the banner's
Install button on Android Chrome with no native prompt → sheet opens →
they use the Chrome menu → install succeeds → `appinstalled` fires →
`isInstalled=true` → banner hides → but `iosSheetOpen=true` still, so
the bottom sheet stays visible with "Install VOYO on your Home Screen"
instructions the user no longer needs. Requires user to tap × to
dismiss.

**Fix:** In the same effect, also `setIosSheetOpen(false)` when
`isInstalled` becomes true.

---

## P2 · iOS install detection is effectively impossible — the sheet has no "did the user actually add to home screen" signal

**Location:** `src/components/ui/IOSInstallSheet.tsx:17–118`
**Severity:** P2 — fundamental iOS limitation, but no mitigation applied.

The sheet walks the user through Share → Add to Home Screen → Add. After
they complete those steps, they're BACK on the Safari tab with the sheet
still open. Our code has no way to detect that the install happened.
When the user next opens the PWA from the home screen, it opens as
standalone → `isStandaloneDisplay()` returns true → `writeInstalledFlag()`
fires. Good. But between now and then, the Safari tab still thinks:
- `isInstalled === false`
- Sheet is open (until user taps "Got it" or ×)
- Banner's `DISMISS_KEY` was written (at line 111) — OK
- But `INSTALLED_KEY` is NOT written

If the user DOESN'T tap "Got it" and just switches to the home screen to
launch the installed icon (very common iOS flow — "I did it, now I'll
open it"), then later returns to the Safari tab, the tab still has the
sheet open and install UI in state. They see a stale install moment.

**Fix:**
1. When the sheet is open on iOS, listen for `document.visibilitychange`
   — if the user backgrounds the tab for >5s (they switched to home
   screen) and returns, pre-emptively call `getInstalledRelatedApps()`
   (no-op on iOS) AND check `window.matchMedia('(display-mode:
   standalone)').matches` (still false — Safari tab is not standalone).
   So we have no positive signal. BUT: close the sheet on return and
   show a toast "Installed? Tap here to launch" with a `target="_blank"`
   link to `/` that, on the standalone, will set the latch.
2. Add a "Did it work?" confirmation tap at the bottom of the sheet:
   "I added it to my home screen." Tapping writes `INSTALLED_KEY`
   optimistically, hides all install UI. Self-attestation. Better than
   nothing.
3. On iOS, shorten the `DISMISS_KEY` cooldown to 3 days — iOS users
   need more nudges because there's no auto-detection of install.

---

## P2 · Banner's 8s delay intersects with `AuthProvider` / `FirstTimeLoader` splash — the banner can show while the greeting is still animating off

**Location:** `src/components/ui/InstallBanner.tsx:13, 64–78` +
`src/App.tsx` (AuthProvider / FirstTimeLoader mount time)
**Severity:** P2 — depends on network.

Comment says "The GreetingBanner plays for 5.2s. Land at 8s so the two
moments never overlap — greeting exits, a beat of quiet, install appears."

The 8s delay is measured from InstallBanner's own mount, which is when
App.tsx renders. But:
- AuthProvider mounts synchronously with App.
- FirstTimeLoader may also be rendering ITS own splash for first-time
  users (see `AUDIT-6` footnote on `FirstTimeLoader`) — that splash has
  its own animation timing.
- On a slow device, the 5.2s GreetingBanner can actually take 7–8s
  before it visibly exits (due to CSS animation queueing, Suspense
  fallbacks, etc.). An 8s fixed delay then overlaps.
- On a VERY slow device or slow network, the whole App shell appears
  with spinners for 5+ seconds. The 8s timer counts from that. User
  finally sees content, and the banner slams in 3s later — feels
  reactive to them interacting, not premeditated.

**Why:** Fixed timer, no coordination with actual boot-complete signal.

**Fix:**
1. Instead of `SHOW_DELAY_MS = 8000` from mount, dispatch a custom event
   `voyo:greeting-done` from the GreetingBanner when it actually exits,
   and have the InstallBanner listen. Fallback: 12s hard ceiling.
2. OR: gate on `app.isBooted` / `PlayerStore.hasCurrentTrack` — show the
   banner after the user has had at least one successful interaction,
   not after a wall-clock delay.

---

## P2 · Swipe-up dismiss can double-commit with auto-hide in a narrow race

**Location:** `src/components/ui/InstallBanner.tsx:82–89, 136–148`
**Severity:** P2 — user sees no visible bug but telemetry logs two
`pwa_install_dismissed` events.

Auto-hide timer fires at `visible + 10s`. If the user starts swiping at
t+9.9s, `dragActive.current = true` is set at `pointerdown`. Auto-hide
callback fires at t+10s, checks `!dragActive.current` → false → does
nothing. Good. But at t+10.01s the user releases past threshold:
`onPointerUp` fires → `dragged <= -SWIPE_DISMISS_PX` → `dismiss(true,
'swipe')`. Good, single dismiss.

BUT: if the user starts swiping at t+9.5s, doesn't exceed the 48px
threshold, and releases at t+9.9s → `setDragY(0)` → dragActive cleared
at t+9.9s — but the pending auto-hide timer runs at t+10s and finds
`dragActive.current = false` → fires `dismiss(false, 'auto')`. This is
correct behavior (user "tried to dismiss but snapped back, then auto-
hide kicked in anyway") but the telemetry says `dismiss_type: auto`
when the user clearly engaged with the banner first. Minor.

More concerning: there's no cleanup on unmount for the `setLeaving`
timer at line 93:
```
window.setTimeout(() => setVisible(false), 360);
```
If the user navigates away (profile panel opens, etc.) the timer fires
on an unmounted component. React will warn. Low impact but noisy.

**Fix:**
1. Track the setLeaving timeout id in a ref, clear on unmount.
2. When `onPointerDown` fires, clear the pending auto-hide timer
   (cancel it and re-create when user lifts without dismissing). Cleaner
   state machine.

---

## P2 · `InstallButton` trace `pwa_install_shown` fires even when UI is immediately replaced by banner

**Location:** `src/components/ui/InstallButton.tsx:22–27`
**Severity:** P2 — telemetry bleed.

```
useEffect(() => {
  if (isInstalled || !isInstallable) return;
  if (shownLogged.current) return;
  shownLogged.current = true;
  trace('pwa_install_shown', null, { surface: 'pill', ... });
}, [isInstallable, isInstalled, platform, hasNativePrompt]);
```

This fires on FIRST render when the pill renders. On a returning-
installed user (P1 above), the related-apps Promise resolves ~50–200ms
after mount. During that window the pill IS rendered. The effect
runs (no `isInstalled` yet). Trace fires. Then `isInstalled` flips
true, pill disappears.

Net: every returning-installed user who clears localStorage (and some
who don't, thanks to the async flash) logs a `pwa_install_shown` event.
Funnel sees shown → no click → reads as low-intent user. Actually they
never saw the UI for long enough to register.

**Fix:** Same as P1 flash fix — add a `resolving` gate to the hook, don't
log `shown` until `resolving === false`.

---

## P3 · Manifest `related_applications` URL is the manifest itself, not a Play Store ID

**Location:** `public/manifest.json:32`
**Severity:** P3 — functional but gives weaker signal.

```
"related_applications": [
  { "platform": "webapp", "url": "https://voyomusic.com/manifest.json" }
]
```

`getInstalledRelatedApps()` accepts this form, but the stronger signal is
the Play Store ID once a TWA is published, and the iOS App Store ID if
an iOS companion exists. For now the self-reference works for Chrome
Android WebAPK detection — this is the canonical pattern. Keep as is,
but if/when a Play Store TWA is published, add `{ "platform": "play",
"id": "com.voyo.music" }` alongside.

---

## P3 · `share_target` is declared but no route handles `?text=q` in the app shell

**Location:** `public/manifest.json:36–41`
**Severity:** P3 — user shares from another app → VOYO opens → nothing
happens with the shared text.

```
"share_target": {
  "action": "/",
  "method": "GET",
  "enctype": "application/x-www-form-urlencoded",
  "params": { "text": "q" }
}
```

App.tsx's query-parsing (`?action=search|player`) doesn't read `q`. So if
a user on installed VOYO Android shares a song title from YouTube/Spotify
to VOYO, the app opens at `/?q=<title>` and just lands at home. Missed
opportunity.

**Fix:** In App.tsx boot-time query parser, read `q` and open
`SearchOverlay` pre-filled with that text. Doesn't affect install but the
install-completed user's first impression of "what does the installed app
do" is blank when they intended to share-search.

---

## P3 · No `scope` lint — `start_url: "/"` + `scope: "/"` lets the PWA capture cross-origin inbound links

**Location:** `public/manifest.json:4, 8`
**Severity:** P3 — not a bug, just worth noting.

Both are `/`. On Android Chrome, the installed PWA will intercept any
`voyomusic.com/*` link from other apps (per WebAPK link-handling). This
is what we want for music share links. But `start_url: "/"` resets
everything — a share-target-handled link goes to `/?q=...` and the
install bonus of "open to the shared content" is lost. Combine with
the P3 share_target fix above.

---

## Summary

Top 3 to fix first:

1. **P0 — `setIsInstallable(true)` fires on unknown / unsupported
   platforms** (`usePWA.ts:88`). In-app browsers (Instagram, TikTok,
   FB), desktop Firefox / Safari, iOS Chrome all get install UI they
   cannot follow. Highest UX leak in the funnel.

2. **P0 — One-way `voyo-pwa-installed-at` localStorage latch**
   (`usePWA.ts:19, 36–42`). Uninstalling the PWA doesn't clear the
   origin's localStorage, so `isInstalled` returns true forever.
   Genuinely uninstalled users can never get the install prompt back.

3. **P1 — Banner and pill both render a `pwa_install_shown`
   unconditionally on every installable session** (`App.tsx:1119–1120`
   + `InstallButton.tsx:22–27` + `InstallBanner.tsx:74`). Two competing
   CTAs on screen for 10 seconds, and the funnel's shown-count is
   double-counted, breaking conversion math. Consolidate to one surface,
   fire one shown event.

The install flow is thoughtful (v387's banner restraint + swipe-to-
dismiss is premium, telemetry coverage is mostly complete, iOS sheet
copy is tight) but the persistence model conflates three different
things — "is installed right now," "was installed once," and "was
dismissed recently" — in ways that can lock legitimate users out of
the CTA for 14 days or forever.

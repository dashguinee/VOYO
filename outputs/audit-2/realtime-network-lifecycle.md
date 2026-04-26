# Realtime / Network / Lifecycle Audit (audit-2)

Scope: `src/main.tsx`, `public/service-worker.js`, `src/providers/AuthProvider.tsx`, `src/lib/voyo-api.ts`, `src/lib/dash-auth.tsx`, `src/lib/supabase.ts`, `src/lib/realtime/reconnect.ts`, `src/services/telemetry.ts`, `src/components/voyo/navigation/VoyoBottomNav.tsx`, `src/components/social/SignInPrompt.tsx`, `src/hooks/useDashNotifications.ts`, `src/hooks/usePushNotifications.ts`, `src/hooks/usePushSubscribe.ts`, `src/player/useHotSwap.ts`.

Eight findings, glitch / race / leak only.

---

## P0-RT-1 — Cross-tab login/logout never triggers profile load or clear (broken transition diff)

**File**: `src/providers/AuthProvider.tsx:225–249`

**Glitch**: The cross-tab `storage` handler is meant to detect the login → logout (and vice-versa) transition and react. The logic compares `wasLoggedIn` to `isNowLoggedIn`. Both are derived from `getDashSession('V')`:

```ts
const newSession = getDashSession('V');
const currentSession = getDashSession('V'); // Get fresh current state
const wasLoggedIn = Boolean(currentSession);
const isNowLoggedIn = Boolean(newSession);
```

Both reads happen against the SAME `localStorage` key in the same synchronous tick — they ALWAYS return the same value. The comment "Get fresh current state" is wrong: there is no "previous" state to compare against. The two diff branches at lines 236 (`!wasLoggedIn && isNowLoggedIn`) and 242 (`wasLoggedIn && !isNowLoggedIn`) are mathematically unreachable.

**Repro**:
- Open VOYO in tab A (logged out). Open `hub.dasuperhub.com` in tab B and sign in. Tab A receives the storage event.
  - Expected: profile is loaded and the auth state flips to logged-in (with profile populated).
  - Actual: `setSession(newSession)` runs, so `isLoggedIn` flips to true, but `loadOrCreateProfile` is NEVER called. The user sees themselves as logged in but `profile` stays `null` — every component reading `useAuth().profile` (totalListens, preferences hydration, sync gate) gets stale or empty data until manual refresh.
- Conversely, signing out in tab B never calls `setProfile(null)` in tab A. `isLoggedIn` flips to false but `profile` lingers — UI may render the previous user's stats.

**Severity**: P0 — silent data integrity bug across every multi-tab session change. Profile load/clear is the entire purpose of this handler.

**Note**: The `handleFocus` handler at line 253 covers part of this, but only when the user re-focuses the tab. Pure background tabs stay broken.

---

## P0-RT-2 — Auto-sync subscriber returns useless cleanup; preference changes spawn unbounded sync timers

**File**: `src/providers/AuthProvider.tsx:326–345`

**Race / leak**: The auto-sync effect calls `usePreferenceStore.subscribe(...)` and INSIDE the subscribe callback creates a 5s `setTimeout` that calls `syncToCloud()`, then returns `() => clearTimeout(timeout)`:

```ts
const unsubscribe = usePreferenceStore.subscribe((state, prevState) => {
  const prefsChanged = state.trackPreferences !== prevState.trackPreferences;
  if (prefsChanged) {
    const timeout = setTimeout(() => {
      syncToCloud();
    }, 5000); // Wait 5s after last change

    return () => clearTimeout(timeout);
  }
});
```

Zustand's `subscribe(listener)` listener signature is `(state, prevState) => void`. The return value is **discarded** — there is no per-event cleanup hook. The `() => clearTimeout(timeout)` is silently dropped on every change.

`preferenceStore.ts:110` confirms `create<PreferenceStore>()(...)` — plain `create`, no `subscribeWithSelector` middleware that exposes per-call unsubscribe.

**Consequence**: every track-preference mutation queues a fresh, unkillable 5s timeout that fires `syncToCloud()`. With rapid likes/plays (a normal listening session) you get N parallel pending syncs, all firing at +5s offsets, hammering `profileAPI.updatePreferences` instead of the intended single trailing-edge debounce.

The closure-local `let debounceTimer` pattern from the now-playing effect (line 354–365) is the correct shape, but was not applied here.

**Severity**: P0 — network amplification under normal use, plus race conditions inside `updatePreferences` writes (last-write-wins on overlapping responses).

---

## P0-RT-3 — `makeReconnectingChannel` never `removeChannel()`s — Supabase client registry leaks per reconnect

**File**: `src/lib/realtime/reconnect.ts:44–50, 57–60`

**Leak**: The reconnect helper only calls `channel.unsubscribe()` — never `client.removeChannel(channel)`. `unsubscribe()` closes the WebSocket subscription but does NOT remove the channel from the Supabase client's internal `channels` array (Supabase requires both calls).

Two leak paths:

1. **Reconnect path** (line 44-49): On `TIMED_OUT`/`CLOSED`/`CHANNEL_ERROR`, `setTimeout` fires → calls `channel?.unsubscribe()` then `wire()` which constructs a NEW `channel` and assigns it. The old channel object stays in the client registry. Over a long session of WS flaps the registry grows monotonically.

2. **Disposal path** (line 57-60): The returned `unsubscribe()` is `try { channel?.unsubscribe(); }` only — same leak, every callsite that mounts/unmounts (e.g. `messagesAPI.subscribe`, `subscribeToConversation`, `subscribeToFriendsPresence`) leaks one entry per cycle.

3. **Registry collision**: All callers use stable channel names (`messages:${dashId}`, `convo:${sortedPair}`, `friends_presence`, `incoming:${dashId}`). Re-creating the same name with the prior channel still in the registry causes Supabase to log warnings and (depending on version) reject duplicate subscriptions silently.

Compare with the in-tree correct pattern in `useHotSwap.ts:535-538` and `:631`:
```ts
if (channelRef.current && supabase) {
  supabase.removeChannel(channelRef.current);
}
```

**Severity**: P0 — unbounded growth across the lifetime of a session, with realtime delivery degrading after the first WS death/recover cycle.

---

## P1-RT-4 — Five separate Supabase clients (3 against Command Center, 2 against VOYO DB) — duplicate WebSocket connections

**File**: `src/lib/supabase.ts:27`, `src/lib/voyo-api.ts:26`, `src/lib/voyo-api.ts:37`, `src/lib/dash-auth.tsx:18`, `src/lib/dahub/dahub-api.ts:31`

**Leak / waste**: Five `createClient()` calls instantiated at module load, each with its own realtime socket:

```
src/lib/supabase.ts:27        → VOYO Supabase  (eventsPerSecond: 10)
src/lib/voyo-api.ts:26        → VOYO Supabase  (eventsPerSecond: 10, storageKey: 'voyo-data')
src/lib/voyo-api.ts:37        → Command Center (eventsPerSecond: 10, storageKey: 'voyo-cc-data')
src/lib/dash-auth.tsx:18      → Command Center (storageKey: 'dash-auth-v1')
src/lib/dahub/dahub-api.ts:31 → Command Center (no opts)  — falls back to `supabase` if env unset
```

Two duplicate VOYO clients, three duplicate Command Center clients. Each opens a separate `wss://...realtime/v1/websocket` connection on first realtime subscription, doubles auth/cookie bookkeeping, and each holds its own channel registry (so a channel mounted on one client is invisible to the others; cross-API cleanup is impossible).

The `dahub-api.ts:33` fallback `: supabase` (re-export of `src/lib/supabase.ts`) only kicks in when CC env is unset — in production CC env IS set, so two distinct CC clients are live simultaneously.

**Repro**: Open the network tab on a logged-in session — observe ≥3 concurrent `wss://*.supabase.co/realtime/v1/websocket` connections.

**Severity**: P1 — burns mobile battery, doubles CC quota usage on `eventsPerSecond`, and any "removeChannel from supabase" code is wrong half the time depending on which client created the channel.

---

## P1-RT-5 — `SignInPrompt.loadData` 30s polling has no AbortController; stale fetches resolve into unmounted/stale state

**File**: `src/components/social/SignInPrompt.tsx:115–163`

**Race**: The `loadData` effect (gated on `dashId, isLoggedIn`) does:

```ts
const loadData = async () => {
  const [friendsList, activity] = await Promise.all([
    friendsAPI.getFriends(dashId),
    activityAPI.getFriendsActivity(dashId),
  ]);
  setFriends(friendsList);
  setFriendsActivity(activity);
  // ...
  if (realList.length > 0) setFriendsListening(realList);
};

loadData();
const interval = setInterval(loadData, 30000);
return () => clearInterval(interval);
```

No AbortController. No `cancelled` flag. The 30s `setInterval` plus the `currentTrack` dep (line 163) means every track change re-runs the effect. The OLD effect's last-launched `loadData()` is still in flight against the OLD `dashId` closure; on resolve it calls `setFriendsListening` with stale-context data, overriding what the new effect just wrote.

If the user signs out mid-fetch, the in-flight request resolves and writes friend data into a now-logged-out UI (`isLoggedIn === false`). No data corruption (it's display state) but it's a visible glitch — the friend ring/avatars repopulate after sign-out.

Compare with the correct pattern at `src/hooks/useDashNotifications.ts:78-98` which uses `let cancelled = false` and a cleanup `return () => { cancelled = true; }`.

**Severity**: P1 — display glitch on every track change + auth-transition flash.

---

## P1-RT-6 — `VoyoBottomNav` prompt sequence: nested setTimeouts uncleared on isPlaying/isOnFeed change

**File**: `src/components/voyo/navigation/VoyoBottomNav.tsx:207–229`

**Glitch**: The prompt animation sequence chains three nested `setTimeout`s but only the outermost is captured for cleanup:

```ts
const showPromptTimer = setTimeout(() => {
  setPromptState('love');
  setTimeout(() => {                          // not tracked
    setPromptState('keep');
    setTimeout(() => {                        // not tracked
      setPromptState('clean');
      setPromptCount(prev => prev + 1);
    }, 2500);
  }, 2000);
}, 8000);

return () => clearTimeout(showPromptTimer);
```

If `isPlaying` toggles off (or `isOnFeed` flips) AFTER the 8s outer timer has fired but BEFORE the 2s/2.5s inner timers run, the inner timers continue and:

1. Force `promptState` to `'love'`/`'keep'`/`'clean'` despite the user having moved away from the feed (visible flash on the orb if the user comes back fast).
2. Increment `promptCount` even though no prompt was actually completed in the user's view, exhausting the per-session budget of 3.

The same timer-not-cleared problem also means a rapid play/pause spam can stack the inner-timer callbacks — multiple `setPromptCount(prev => prev + 1)` fires can burn the entire session budget in a single animation cycle.

**Severity**: P1 — UX glitch (orb flickers post-navigation) + correctness bug (promptCount over-increments).

---

## P1-RT-7 — `usePushNotifications` calls `setIsSubscribed` from render body (state-during-render)

**File**: `src/hooks/usePushNotifications.ts:51–59`

**Glitch**: The subscription-status check runs in the function body, NOT inside `useEffect`:

```ts
if (supported && !checkedRef.current) {
  checkedRef.current = true;
  navigator.serviceWorker.ready.then(reg => {
    reg.pushManager.getSubscription().then(sub => {
      setIsSubscribed(!!sub);   // setState resolved from render-time async
    });
  });
}
```

Issues:
1. **StrictMode dev double-invocation** — render runs twice. First render sets `checkedRef.current = true`; second render skips. OK in practice but it does mean if the component unmounts before SW ready resolves, `setIsSubscribed` fires on a destroyed component (React warns "state on unmounted").
2. **No cleanup / cancellation** — there is no way to cancel the chained promises. If the consumer remounts (route change, etc.) the ref guards a SECOND check, but the first chain still runs against captured-then-unmounted `setIsSubscribed`.
3. **Anti-pattern** — should be in `useEffect` with a cancellation flag, like the (correct) sister hook `usePushSubscribe.ts:55-63`.

**Repro**: Mount/unmount the consumer rapidly (e.g. dev hot-reload) — watch the React warning fire intermittently.

**Severity**: P1 — masks a future correctness bug if SW ready ever races with a fast unmount; harmless today but unconventional.

---

## P2-RT-8 — SW `SW_UPDATED` message can fire before any window listener is wired (cold-boot race)

**File**: `src/main.tsx:38-42` and `src/App.tsx:358 / :421-425`

**Race**: Module-load order in `main.tsx`:

```ts
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' })
      .then((reg) => { setInterval(() => { ... reg.update(); }, 15 * 60 * 1000); });
  });

  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'SW_UPDATED') {
      window.dispatchEvent(new CustomEvent('voyo-update-available'));
    }
  });
}
```

The `voyo-update-available` window event is registered inside an `App.tsx` `useEffect` (line 358), which runs AFTER React mounts. If the SW activates (and posts `SW_UPDATED`) between module load and React mount — possible on a cold boot where the previous SW had been waiting and `skipWaiting()` lets it activate within milliseconds — the `voyo-update-available` event fires into a void. The UI's update-prompt path stays dark until the next 15-minute `reg.update()` succeeds again.

Note: per `service-worker.js:68`, the `SW_UPDATED` postMessage only fires when `oldCaches.length > 0` — i.e. only for the second-and-later boots. So the cold-boot race specifically affects users who previously had a SW and are loading a new build.

**Severity**: P2 — edge case (only a fraction of cold boots will land in the millisecond window), but when it does, the user gets no update prompt for that session.

---

## Verified-not-bugs (per the v634 false-positive lesson)

- **`useHotSwap.ts:631` channel cleanup**: confirmed `supabase.removeChannel(channelRef.current)` is called both in cleanup AND in the reconnect path (line 535-538). Properly cleaned.
- **`useDashNotifications.ts:126`**: confirmed `client.removeChannel(channel)` is called on cleanup. Properly cleaned.
- **`AuthProvider.tsx` presence interval (line 285-321)**: confirmed cleanup clears interval + removes visibilitychange listener. Properly cleaned. The visibility-gated re-ping logic is correct.
- **`telemetry.ts` module-scoped `pagehide` / `visibilitychange` listeners (line 215-221)**: not removed, but they're module-scoped for the page lifetime — correct by design, not a leak.
- **`VoyoBottomNav.tsx:73-81` global pointerdown/up/cancel listeners**: cleanup pairs all three correctly. Removal options don't need to match `passive: true`. Not a leak.
- **`AuthProvider.tsx` now_playing effect (line 350-444)**: deps `[dashId]` correct. Cleanup unsubscribes the zustand listener AND clears the debounce timer. The closure does carry stale `dashId` for in-flight `await profileAPI.updateNowPlaying(dashId, ...)` calls — but those writes target the previous user's row, which is acceptable best-effort behavior.

# VOYO MOMENTS — Deep Audit: Feed Gestures, Nav, Playback, Preload

**Agent**: MOMENTS-1 (Feed + Gestures district)
**Date**: 2026-04-22 (post-v403 `f860750`)
**Scope**: `VoyoMoments.tsx`, `useMoments.ts`, `momentsService.ts`, feed/* cards, `PortraitVOYO.tsx`

---

## TL;DR — Priority Ranked

| # | Severity | Finding | File |
|---|----------|---------|------|
| 1 | **P0** | v403 "preload inactives" is architecturally moot — only ONE card rendered, `isActive=true` hard-coded | `VoyoMoments.tsx:1596-1617` |
| 2 | **P0** | **RLS: anon can INSERT/UPDATE voyo_moments** (create fake viral moments, rewrite counts) | `migrations/003_moments_schema.sql:323-329` |
| 3 | **P0** | OYE double-tap bypasses `voyo_signals` entirely — race-conditioned read-then-write on `voyo_reactions` | `useMoments.ts:531-550` |
| 4 | **P1** | `goUp` auto-paginate uses stale `moments` closure — can fire once per swipe near end, N dup fetches | `useMoments.ts:365-367` |
| 5 | **P1** | Arrow keys are **inverted** on desktop (`ArrowLeft` → `goLeft` via `nav('right'`)) — stuck state easy | `VoyoMoments.tsx:1397-1398` |
| 6 | **P1** | Video R2 `/check` fetch fires on every `source_id` change with no dedup/cache, no AbortController — leaks on fast swipe | `VoyoMoments.tsx:521-536` |
| 7 | **P1** | `recordPlay` re-fires on ANY `currentMoment.id` flip, including MIX mode index flips — inflates voyo_plays | `VoyoMoments.tsx:1238` |
| 8 | **P2** | Double-tap + swipe: `starHoldTimer` starts on TS of 2nd tap; if user then swipes, timer is cleared in `onTM` but a fast swipe <10px does NOT clear, can still pop Star panel mid-swipe | `VoyoMoments.tsx:1283-1307` |
| 9 | **P2** | Feed never refreshes — `fetchedRef` marks cache permanent. Pull-down / tab re-entry shows stale data until reload | `useMoments.ts:222, 276` |
| 10 | **P2** | Empty state leaks: if `momentsService` 500s, circuit breaker blocks ALL future categories until page reload | `useMoments.ts:25, 252` |
| 11 | **P2** | Comments drawer is mock-only — `MOCK_COMMENTS` array, nothing persists | `VoyoMoments.tsx:769-775` |
| 12 | **P2** | Share button is a no-op (just an icon with "Share" label, no onClick) | `VoyoMoments.tsx:650-653` |
| 13 | **P3** | `goLeft` trail depth math is wrong — `depth = MAX_TRAIL - trailEntries.length` counts from cap, not from now. A fresh user with 2 trail entries gets `depth=48` → "APPROXIMATE" instead of "EXACT" | `useMoments.ts:439` |
| 14 | **P3** | No skip telemetry (`voyo_skips` never incremented) despite service having the method | `momentsService.ts:560` vs `useMoments.ts` |
| 15 | **P3** | `pushTrail` before `setPosition` = trail records the OLD position as if it's where we're going; LEFT/memory replays the prev location, not target | `useMoments.ts:322-334` |

---

## 1. v403 PRELOAD FIX — Dead Code Path (P0)

**Commit `f860750` (v403)**: changed `preload={isActive ? 'metadata' : 'none'}` → `preload={isActive ? 'auto' : 'metadata'}`.

**The bug the fix was meant to address**: when a card flips from inactive→active, the poster blinks because nothing was buffered.

**Why the fix doesn't actually do anything**:

Look at the render tree in `VoyoMoments.tsx:1596-1617`:
```tsx
) : currentMoment ? (
  <div key={`m-${currentMoment.id}-${mKey}`} ...>
    <MomentCard
      moment={currentMoment}
      ...
      isActive={true}   // ← HARD-CODED
```

Only `currentMoment` is rendered. There is NO card stack, NO offscreen neighbors, NO inactive card prerendered. `isActive` is the literal value `true`. So `preload={isActive ? 'auto' : 'metadata'}` always evaluates to `'auto'`. The `'metadata'` branch is **unreachable**.

The actual poster-flash kill is a side effect of: (a) thumbnail rendered behind video (line 588), (b) the `key={m-${id}-${mKey}}` unmount on swipe forces a brand-new `<video>` element which has to fetch from zero again.

**What the fix should be** (if we actually want preload-neighbors):
- Render `prev`, `current`, `next` `<MomentCard>` stacked with CSS transforms (TikTok model)
- Only pass `isActive={idx === currentIndex}` — then v403's change would matter
- OR pre-issue HEAD requests to warm R2/CDN on `nextMoment.source_id`

Right now: every swipe tears down the `<video>`, rebuilds from scratch, reposts the `/r2/feed/.../check` round-trip (see finding #6). The poster flash is currently masked by the thumbnail `S.thumb` sitting behind the video, which is purely cosmetic.

---

## 2. RLS — Anon Can Write Moments (P0, SECURITY)

`supabase/migrations/003_moments_schema.sql:323-329`:
```sql
CREATE POLICY "Moments are viewable by everyone" ON voyo_moments FOR SELECT USING (true);
...
CREATE POLICY "Backend can insert moments" ON voyo_moments FOR INSERT WITH CHECK (true);
CREATE POLICY "Backend can update moments" ON voyo_moments FOR UPDATE USING (true);
```

`WITH CHECK (true)` / `USING (true)` with anon-role access = **any browser client can INSERT arbitrary moments or UPDATE any row**. Vector:
- Anon attacker opens console, grabs VITE_SUPABASE_ANON_KEY, calls `POST /rest/v1/voyo_moments` with fake creator_username + high `heat_score` → shows up top of feed for everyone
- Same attacker UPDATEs `voyo_reactions: 999999` on their enemy's moment

Likely the intent was "service role only" but the policies name "Backend" without actually restricting `role`. Fix:
```sql
CREATE POLICY "Service can insert" ON voyo_moments FOR INSERT
  TO service_role WITH CHECK (true);
```
And drop the anon write policies. Same class of issue on `voyo_moment_tracks` line 329.

---

## 3. OYE Bypasses voyo_signals + Has Race Condition (P0)

From `MEMORY.md`: today's flag says `voyo_signals.track_id FK` is broken (all signals frozen since 2026-04-18). That's tracks — but Moments has its OWN broken engagement path:

`useMoments.ts:531-550` — `recordOye`:
```ts
const { data: current } = await supabase.from('voyo_moments')
  .select('voyo_reactions').eq('id', momentId).maybeSingle();
if (current) {
  await supabase.from('voyo_moments')
    .update({ voyo_reactions: (current.voyo_reactions || 0) + 1 })
    .eq('id', momentId);
}
```

Problems:
1. **Read-then-write race**: two rapid OYEs land `current=5`, both write `6`. Counter loses increments under load. Classic anti-pattern — should be `rpc('increment_moment_reaction', ...)` using Postgres atomic `UPDATE ... SET x = x + 1`.
2. **Doesn't fanout to voyo_signals** — which means the Moments OYEs do NOT contribute to the taste graph at all. If the taste graph recovers (once the FK fix lands), Moments won't populate it until `recordOye` routes through `voyo_signals`.
3. **No momentId user binding** — anyone can fire reactions for any moment unlimited times (there's no `oyed_by` table). The client-side `oyedMoments` Set (line 1313) is per-session only; refresh = spam again.

Same pattern pollutes `recordPlay` (line 519) via the RPC `record_moment_play` — at least that one's atomic.

---

## 4. goUp Auto-Paginate Stale Closure (P1)

`useMoments.ts:348-382` — `goUp`:
```ts
setPosition(prev => {
  const cats = CATEGORY_PRESETS[categoryAxis];
  const cat = cats[prev.categoryIndex] || '';
  const key = cacheKey(categoryAxis, cat);
  const categoryMoments = moments.get(key) || [];    // ← captured `moments` from closure
  ...
  if (newTimeIndex >= categoryMoments.length - 3 && cat) {
    fetchMomentsForCategory(categoryAxis, cat, categoryMoments.length);
  }
```

`moments` is the closure-captured Map at render time. When user swipes fast near the end, each swipe sees `categoryMoments.length = 20` (pre-fetch), calls `fetchMomentsForCategory(..., 20)`. That fetch is async — before it returns, the next swipe still sees `length=20` and calls it AGAIN with offset 20. `fetchingRef.current.has(key)` guard only applies to `offset === 0` (line 220), so non-zero-offset fetches can duplicate freely.

The dedup at `offset===0` line is:
```ts
if (fetchingRef.current.has(key) && offset === 0) return;
```
Pagination offsets are NOT guarded. Fix: remove the `&& offset === 0` clauses (lines 220, 222) OR key the fetching ref as `${key}::${offset}`.

---

## 5. Desktop Arrow Keys Semantically Inverted (P1)

`VoyoMoments.tsx:1392-1404`:
```ts
case 'ArrowLeft':  nav('right', goLeft); break;   // anim goes right, but calls goLeft
case 'ArrowRight': nav('left', goRight); break;   // anim goes left, but calls goRight
```

Compare with swipe mapping (lines 1353-1358):
```ts
if (dx < 0) { nav('left', () => goRight(velocity)); }    // swipe LEFT → goRight
else        { nav('right', () => goLeft(velocity)); }    // swipe RIGHT → goLeft
```

On swipe, drag-left-with-finger means "I want next" → goRight; fine. But on keyboard, `ArrowLeft` common intent is "previous" → should call `goLeft` (memory). Instead it calls `goLeft` via `nav('right', goLeft)` — semantically this matches swipe but the keyboard convention is the opposite. Users hitting arrow keys will find it confusing. Also the animation direction is swapped (ArrowLeft plays the "slide right" variant) which reads as reversed.

Recommendation: Arrow keys should mirror mental model (Left=prev, Right=next), not mirror swipe-delta.

---

## 6. R2 /check Fetch Leaks on Fast Swipe (P1)

`VoyoMoments.tsx:521-536`:
```ts
useEffect(() => {
  let cancelled = false;
  setVideoAvailable(null);
  setVideoError(false);
  fetch(`${videoUrl}/check`)
    .then(r => r.json())
    .then(data => { if (!cancelled) setVideoAvailable(data.exists === true); })
    .catch(() => { if (!cancelled) setVideoAvailable(false); });
  return () => { cancelled = true; };
}, [moment.source_id, videoUrl]);
```

- Uses `cancelled` flag for state race, but the actual `fetch` is NOT aborted — no `AbortController`. Fast swiper generates N in-flight `/check` requests. Each consumes a Cloudflare worker invocation.
- No result cache. Swipe A→B→A rechecks A every time despite result never changing.
- No retry backoff. If `/r2/feed/xxx/check` 502s once for a given moment, it'll 502 every swipe back to it.

Recommendation: wrap in an `AbortController` + session-scoped Map<source_id, boolean> cache. Cheap win.

---

## 7. recordPlay Re-Fires in MIX Mode (P1)

`VoyoMoments.tsx:1238`:
```ts
useEffect(() => { if (currentMoment) recordPlay(currentMoment.id); }, [currentMoment?.id, recordPlay]);
```

`currentMoment` flips whenever `mixIndex` changes in MIX mode (line 1224-1226). Each flip fires `record_moment_play` RPC for the landed moment. User who MIX-swipes through 20 moments in a row registers 20 plays even if they never actually watched any.

Also no debounce: tap OYE → if that causes a re-render that changes moment.id (shouldn't, but if isOyed state triggered a cascade), double-count.

---

## 8. Star Panel Can Pop Mid-Swipe (P2)

`VoyoMoments.tsx:1282-1307`:

On 2nd tap in `onTS`:
```ts
if (now - lastTap.current < DOUBLE_TAP_MS && currentMoment) {
  starHoldTimer.current = setTimeout(() => {
    if (!swiping.current) { ... setShowStarPanel(true); }
  }, STAR_HOLD_MS);  // 500ms
}
```

`onTM` clears `starHoldTimer` only if dx OR dy > 10px:
```ts
if (Math.abs(...) > 10 || Math.abs(...) > 10) {
  swiping.current = true;
  ...
  if (starHoldTimer.current) clearTimeout(starHoldTimer.current);
}
```

Edge case: user double-taps then holds stationary for 500ms (star panel intent) — fine. But user double-taps then drags 8px — `swiping.current` stays `false`, timer fires, **star panel opens mid-micro-swipe**. With the `!swiping.current` guard inside the timer this partially helps, but since `swiping` only gets set after >10px move, there's a 10px dead-zone where both can be true.

Also, the double-tap OYE detection is in `onTE` (line 1373), not `onTS`. So the timer in `onTS` fires based on "did the previous tap end within 300ms" — i.e. it starts the star hold timer on a 2nd TOUCHSTART without knowing if the user's first tap was a single tap or part of a swipe sequence. Result: swiping the screen, lifting finger, swiping again within 300ms = starts star hold timer even though no double-tap occurred.

---

## 9. Feed Never Refreshes (P2)

`useMoments.ts:222`:
```ts
if (fetchedRef.current.has(key) && offset === 0) return;
```

`fetchedRef` is a `Set` that only grows. Once a category is fetched, subsequent mounts (e.g. re-entering the Feed tab) return cached data. No TTL, no pull-to-refresh, no tab-switch invalidation.

User who opens Feed, scrolls, switches to Music for 20 min, switches back = sees the same 20 moments they already saw. For a "what's happening now" surface, this is invisible rot.

Fix: stamp `fetchedAt` with key, TTL ~5min, or expose a `refresh()` method.

---

## 10. Circuit Breaker Blocks All Categories Forever (P2)

`useMoments.ts:25, 250-253`:
```ts
let _momentsBlocked = false;  // module-level
...
if (error.message?.includes('timeout')) {
  _momentsBlocked = true;
  devWarn('DB timeout — moments queries disabled until next reload');
}
```

One transient timeout on ONE category (say, `#afrobeats` with a huge index scan) → entire Moments feature is dead until page reload for every user in that session. The breaker has no reset, no exponential backoff, no per-category scope.

Given the recent `voyo_signals.track_id FK` flag (MEMORY.md — 34k rows frozen), and the fact that Moments cross-queries `cultural_tags` / `content_type` / `vibe_tags` — these are likely GIN-indexed but if any one is missing, whole feed goes dark.

Fix: scope breaker per-category, reset after 30s, OR remove breaker and just let errors surface with toast.

---

## 11. Comments Are Mock-Only (P2)

`VoyoMoments.tsx:769-775`:
```ts
const MOCK_COMMENTS: CommentItem[] = [
  { id: '1', author: 'kenza', text: 'this hits different at 2am 🔥', ... },
```

Every moment shows the same 5 fake comments. `handleSend` adds locally to component state — lost on close. No `voyo_moment_comments` table, no service call. If you ship this to users they'll notice fast ("wait, kenza commented on every single moment?").

`moment.comment_count` is displayed from DB (line 648) but that count has no corresponding persistence layer. Disconnect.

---

## 12. Share Button Is Dead (P2)

`VoyoMoments.tsx:650-653`:
```tsx
<div style={S.actBtn}>
  <div style={actIcon(false)}><ExternalLink ... /></div>
  <span style={S.actLbl}>Share</span>
</div>
```

No `onClick`. No `navigator.share()`. No copy-to-clipboard. It's a decorative icon.

Given the product lives or dies on viral spread (the point of Moments), this is the single highest-leverage dead surface. A `navigator.share({ url: voyomusic.com/m/${source_id}, title: moment.title })` fallback-to-clipboard is ~10 lines.

---

## 13. Trail Depth Math Bug (P3)

`useMoments.ts:439`:
```ts
const depth = MAX_TRAIL - trailEntries.length; // how far back we're going
```

Comment says "how far back" but the formula computes "how full the trail is NOT". On a fresh session with only 2 entries, `depth = 50 - 2 = 48` → hits the "APPROXIMATE" branch (lines 452-464) which may reroute to an adjacent category. User expects LEFT=exact retrace but gets random drift.

Should be `const depth = trailEntries.length` (how many steps back) or we flip the <= comparisons.

---

## 14. Skip Telemetry Unwired (P3)

`momentsService.ts:560` has `recordSkip(momentId)` but `useMoments.ts` never calls it. `voyo_skips` in the DB stays 0 forever. The `heat_score` formula likely weights `voyo_skips` negatively — skipless history biases old content to stay on top.

Simple heuristic: if `mKey` flips within < 3s of the previous flip, call `recordSkip(prevMomentId)` before letting the new one play.

---

## 15. pushTrail Records Wrong Position (P3)

`useMoments.ts:322-334, 348-352`:

```ts
const pushTrail = useCallback((action: NavAction) => {
  const entry: TrailEntry = {
    momentId: currentMoment?.id || null,
    categoryAxis,
    category: currentCategory,
    categoryIndex: position.categoryIndex,
    timeIndex: position.timeIndex,
    ...
  };
  ...
}, [currentMoment, categoryAxis, currentCategory, position]);
```

And in `goUp`:
```ts
pushTrail('up');      // ← pushes the PRE-navigation position
setNavAction('up');
...
setPosition(prev => { ... });
```

The trail records position BEFORE the move. So `trail[last]` = where we were; goLeft pops that and goes back to it. This is actually... fine for memory retrace. BUT:

The `action: 'up'` stored is the action that MOVED AWAY from the entry, not the action that arrived. So when LEFT pops, it replays the pre-up position, and if later code reads `entry.action` to decide anything (it doesn't currently, but it's listed in the type) — confusing.

Semi-bug but also: `pushTrail` uses `useCallback([...position])`, and `setPosition(prev => ...)` inside the nav handlers. The captured `position` in `pushTrail` can be stale vs what's in state when multiple navs fire in quick succession. Small window, but a rapid double-tap + swipe could enqueue a push with outdated position.

---

## What I did NOT find (good news)

- **Gesture leaks on unmount**: cleanup effect at line 1407-1412 clears all four timers (`lpTimer`, `tapTimer`, `volTimer`, `starHoldTimer`). OK.
- **Visibility listener on MomentCard video**: properly removed in cleanup (line 567-568). OK.
- **playerStore bleed**: Moments does NOT sync with `playerStore` — moment video is separate `<video>` element, doesn't touch the main music player state. That's intentional (Moments are silent micro-clips, music is separate). No conflict.
- **"Play Full Track" hand-off**: `onPlayFullTrack` (line 1605-1609) correctly calls `app.playTrack(track, 'moment')` and switches to music tab. Clean.

---

## Recommended action sequence

1. **SECURITY (tonight)**: drop the anon INSERT/UPDATE policies on voyo_moments and voyo_moment_tracks. Replace with `TO service_role`.
2. **Fix finding #1**: Either actually stack prev/current/next cards (the v403 intent) OR delete the dead preload branch and document that v403 was a no-op.
3. **Wire share**: 10-line fix, biggest product win.
4. **Atomize reaction writes**: RPC `increment_moment_reaction(p_moment_id)` — kills the race + gets us off read-then-write.
5. **Fan OYE into voyo_signals** once the FK-drop lands (flagged in MEMORY.md).
6. **TTL / refresh on `fetchedRef`**: 5min stale + pull-to-refresh.

---

*Agent MOMENTS-1, signing off. Ready for the file-based orchestrator pass.*

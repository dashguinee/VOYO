# AUDIT-SOCIAL-1 — Messaging, Real-time Delivery, Presence

**Scope**: DMs, real-time delivery, presence sync, message notifications.
**Date**: 2026-04-22
**Auditor**: Agent 1 of 9 — Social District
**Supabase projects touched**: `anmgyxhnyhbyxzpjhxgx` (VOYO) + `mclbbkmpovnvcfmwsoqt` (Command Center / Hub shared)

---

## TL;DR — Severity Count

- **P0 (broken, users can't do it)**: 4
- **P1 (critical UX / perf / scale)**: 6
- **P2 (polish / edge case)**: 5

The social subsystem is wired against a **Command Center Supabase** which is literally the same project as the Hub (`mclbbkmpovnvcfmwsoqt`). The same migration-hygiene disease that caused the voyo_signals FK + trigger tangle (`outputs/AUDIT-5-signal-flywheel.md`) is here too, with one confirmed P0 duplicate table, one non-existent table queried in production code, and a replicated RT-channel-death bug that we *already fixed* in `useHotSwap.ts` on commit `0ce3fb5` — but has NOT been ported to the messaging RT subscriptions.

---

## P0-1: `sendFriendRequest` / `acceptFriendRequest` target a non-existent `friendships` table

**File**: `/home/dash/voyo-music/src/lib/dahub/dahub-api.ts`
- Line 376 — `ccSupabase.from('friendships').upsert(...)`
- Line 400 — `ccSupabase.from('friendships').upsert(...)`
- Line 180 — code comment literally says: `// (No friendships table exists - friends are people on same accounts)`

The entire "Connect to shared account member" button in the DaHub suggestions list is dead-on-arrival: it calls `handleConnect()` → `friendsAPI.sendFriendRequest()` → `.from('friendships').upsert(...)` — which returns `{ error: { message: 'relation "public.friendships" does not exist' } }` → function returns `false` → UI flips `friend_status: 'pending'` optimistically (Dahub.tsx:1010) but **the flip is never persisted**. Next page-load rolls it back.

The actual table is named `friends` (per `/home/dash/Hub/supabase/SOCIAL_SCHEMA.sql:11` AND `/home/dash/Hub/supabase/shared-accounts-schema.sql:26`). See P0-2 for how those two fight.

**Fix**: rename to `friends` and use the `add_friend` RPC (SECURITY DEFINER) that already exists — same pattern as `friendsAPI.addFriend()` on dahub-api.ts:210.

---

## P0-2: TWO competing `friends` schemas live in Hub/supabase — one references `users(core_id)`, the other references `citizens(core_id)`

**Files**:
- `/home/dash/Hub/supabase/SOCIAL_SCHEMA.sql:15-16` — `REFERENCES users(core_id)` with `status IN ('active','blocked','pending')`
- `/home/dash/Hub/supabase/shared-accounts-schema.sql:28-29` — `REFERENCES citizens(core_id)` with `status IN ('suggested','pending','accepted','blocked')`

Whichever one was applied second errored out or got force-dropped. The client code at `dahub-api.ts:375-379` uses the `shared-accounts-schema` status vocabulary (`status: 'pending'`), while `voyo-api.ts:375-377` and `Dahub.tsx:968` assume the `SOCIAL_SCHEMA` vocabulary (`f.friend_status !== 'accepted'`, `.eq('status','active')`). Half the code is broken whichever schema actually exists.

**Fix**: run a migration that unifies to ONE definition (most likely SOCIAL_SCHEMA since it's referenced by `add_friend`/`remove_friend` RPCs which voyo-api.ts uses in production), drop the other file, and make all client code use the one vocabulary.

---

## P0-3: `dash_notifications.status` column is queried and inserted but never created in any migration we can see

**Files**:
- Query: `/home/dash/voyo-music/src/hooks/useDashNotifications.ts:86` — `.eq('status', 'sent')`
- Query: `/home/dash/voyo-music/src/hooks/useDashNotifications.ts:60` — `if (row.status && row.status !== 'sent') return false;`
- Insert: `/home/dash/voyo-music/src/lib/dahub/dahub-api.ts:505` — `status: 'sent'`
- Schema: `/home/dash/Hub/push-schema.sql:22-33` — **no `status` column defined**

Either (a) it was added by a stray `ALTER TABLE` in the dashboard (same violation that bit voyo_signals — see memory `voyo-signals-fk-flag.md`), (b) the insert silently 400s because the column doesn't exist and the `void` promise at dahub-api.ts:496 throws it away, or (c) the `useDashNotifications` filter drops every row server-returns because the column is null.

The `void ccSupabase.from('dash_notifications').insert(...)` at dahub-api.ts:496-511 is fire-and-forget — only logs on `.then()` — so an insert failure leaves the DM sent successfully but **zero notification surface**: no push, no DynamicIsland for the recipient who's offline or on a different device. That's a silent whole-feature outage.

**Fix**: run `ALTER TABLE public.dash_notifications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent';`, commit as a proper migration file, and add a test that the insert actually lands.

---

## P0-4: Two competing `DirectMessageChat` components wired to two different `messagesAPI` surfaces

**Files**:
- `/home/dash/voyo-music/src/components/dahub/DirectMessageChat.tsx` — uses `dahub-api.ts messagesAPI` (411 lines, the newer one used by DaHub panel)
- `/home/dash/voyo-music/src/components/chat/DirectMessageChat.tsx` — uses `voyo-api.ts messagesAPI` (295 lines, older)

The two APIs have **different field names on the same wire format**:
- dahub `Message`: `from_id`, `to_id`
- voyo-api `DirectMessage`: `from_user`, `to_user`

The voyo-api version (line 519-526) *maps* Command Center's `from_id→from_user` on read. But on write, voyo-api.ts:474-481 sends `{from_id, to_id}`. On line 120 of `components/chat/DirectMessageChat.tsx`, there's a `newMessage.from_user === otherUser.toLowerCase()` check that will compare undefined to a lowercase string when voyo-api's subscribe fires and payload has `from_id` not `from_user` (grep voyo-api.ts:654-656 — it DOES map, but the `toLowerCase()` call on `otherUser` breaks comparisons since `dash_id` is mixed-case like `'0046AAD'`).

Which component is actually mounted depends on route. Whichever code path reaches `components/chat/DirectMessageChat.tsx` gets subtly broken read-receipt / self-detection logic plus duplicated API surface.

**Fix**: delete `components/chat/DirectMessageChat.tsx` and its import graph; keep the `components/dahub/` version; remove voyo-api.ts's entire messagesAPI block (lines 456-701) since `dahub-api.ts messagesAPI` is the canonical one.

---

## P1-1: Messages RT subscribe is INSERT-only — sender never sees "read" transition in real time

**Files**:
- `/home/dash/voyo-music/src/lib/dahub/dahub-api.ts:560` — `event: 'INSERT'`
- `/home/dash/voyo-music/src/lib/voyo-api.ts:615, 643, 681` — `event: 'INSERT'` all three subscribes

When recipient marks messages as read (via `mark_messages_read` RPC → UPDATE messages SET read_at=NOW()), the sender's subscribe channel fires no event. The sender's check-mark (DirectMessageChat.tsx:143-149 — `<Check>` vs `<CheckCheck>`) NEVER flips from grey to purple until the chat remounts or `getMessages` re-runs. Read receipts look dead in prod even though the server writes them correctly.

**Fix**: add a second subscription `.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `from_id=eq.${currentUserId}` }, ...)` that updates the local message's `read_at` when the row UPDATE fires.

---

## P1-2: No RT channel lifecycle recovery — messaging silently dies on TIMED_OUT / CLOSED / CHANNEL_ERROR

**Files**:
- `/home/dash/voyo-music/src/lib/dahub/dahub-api.ts:553-575` — `subscribeToMessages`: no `.subscribe(status => ...)` callback
- `/home/dash/voyo-music/src/lib/dahub/dahub-api.ts:625-648` — `subscribeToPresence`: same
- `/home/dash/voyo-music/src/lib/voyo-api.ts:609-700` — all 3 messaging subscribes: same
- `/home/dash/voyo-music/src/hooks/useDashNotifications.ts:124` — same

Contrast with `src/player/useHotSwap.ts:440-499` which WAS just fixed in commit `0ce3fb5` to handle `TIMED_OUT/CLOSED/CHANNEL_ERROR` with 3 retries at 10s backoff. The same bug class exists unfixed in every messaging/presence/notification channel in the app. When the WS dies (mobile BG, bad wifi), **messages stop arriving**. User sees "we're live" but the pipe is dead.

**Fix**: port the reconnect pattern from useHotSwap.ts:440-499 into a shared helper `utils/resilientRealtimeChannel.ts` and call it from all 5 subscribe sites. Tag each with its own trace subtype (`messages_rt_reconnect_*`, `presence_rt_reconnect_*`, `dash_notifications_rt_reconnect_*`).

---

## P1-3: Presence 30s interval is throttled to ~60s+ on backgrounded tabs — friends see "away" for active users

**File**: `/home/dash/voyo-music/src/providers/AuthProvider.tsx:284-304`

`setInterval(updatePresence, 30000)` is the ONLY heartbeat. Per Chromium / Safari policy, background tabs throttle timers to ≥1/min (Chrome, from ≥2020) or even ≥1/5min after 5 minutes hidden. On iOS PWA backgrounded, timers stop entirely until resume. Consequence: a user playing music in another tab appears "away" / "offline" to friends, which also defeats the DaHub "who's listening" filter at `activityAPI.getLiveListeners` (voyo-api.ts:740-755).

Worse: there's **no pagehide / beforeunload hook** to set presence to `offline` on tab close — users appear "online" indefinitely until the next login elsewhere flips it.

**Fix**: (a) add a `visibilitychange` listener that fires immediate `updatePresence('away')` on hidden and `updatePresence('online')` on visible, (b) add a `pagehide` listener firing `updatePresence('offline')` with `navigator.sendBeacon` for sync teardown, (c) optionally migrate to Supabase's Presence primitive (`channel.presence`) which handles this automatically via WS disconnect detection.

---

## P1-4: Conversation channel subscribes to ALL message INSERTs, filters client-side — bandwidth + RLS leak

**File**: `/home/dash/voyo-music/src/lib/voyo-api.ts:634-663`

```ts
.channel(`convo:${channelId}`)
.on('postgres_changes', {
  event: 'INSERT',
  schema: 'public',
  table: 'messages',
  // NO filter
}, ...)
```

Every opened chat receives the INSERT stream for **every message between every pair of users in the entire platform**, then filters with `if ((m.from_id===currentUser && m.to_id===otherUser) || ...)`. Since RLS on messages is `SELECT USING(true)` (SOCIAL_SCHEMA.sql:302-303), other users' private DMs leak into every client's WS stream. Users can read them in devtools Network tab.

**Fix**: the canonical pattern (used correctly elsewhere) is `filter: 'to_id=eq.${currentUser}'`. Server-side PostgREST filter. RLS should also tighten to something like `from_id = auth.uid() OR to_id = auth.uid()` — but that needs a real JWT, which voyo-music currently doesn't have (persistSession:false + anon key).

---

## P1-5: Optimistic send race — message content duplicates on slow network

**File**: `/home/dash/voyo-music/src/components/dahub/DirectMessageChat.tsx:215-252`

Flow:
1. User hits Send → optimistic message with `id = 'temp-${Date.now()}'` pushed to state.
2. `sendMessage` RPC fires.
3. RT subscribe (line 202-212) fires when the server echo arrives, pushing the SAME message with the SERVER id.

Result: the user sees their own message twice. The subscribe callback does NOT de-dup by `id` before `setMessages(prev => [...prev, msg])`. The voyo-api.ts subscribeToConversation at line 634 DOES have a check (`if (prev.some(m => m.id === newMessage.id))` at line 116 of `components/chat/DirectMessageChat.tsx`) but the dahub variant (line 205) does not. It also doesn't match the temp-id against the server id so even with dedup-by-id the optimistic bubble stays forever.

**Fix**: replace `setMessages(prev => [...prev, msg])` at line 205 with:
```ts
setMessages(prev => {
  if (prev.some(m => m.id === msg.id)) return prev;
  // Replace the matching optimistic (temp-*) from the same sender
  const optimistic = prev.find(m => m.id.startsWith('temp-') && m.from_id === msg.from_id && m.message === msg.message);
  if (optimistic) return prev.map(m => m.id === optimistic.id ? msg : m);
  return [...prev, msg];
});
```

---

## P1-6: AFTER INSERT trigger on `dash_notifications` calls `pg_net.http_post` under anon — silently swallows all errors

**File**: `/home/dash/Hub/supabase/PASTE_THIS_push_notifications.sql:19-42`

The trigger is SECURITY DEFINER (good — bypasses RLS & role-specific grants). But:
1. `exception when others then return new` at line 38-40 means **every push-dispatch failure is silently swallowed**. If the edge function is down, VAPID keys rotated, or Supabase quota hit, the INSERT succeeds and the message appears sent — but no push lands. No log, no telemetry, no user feedback.
2. The service_role JWT is **hardcoded in plaintext** in the function body (line 26). Same issue flagged in the most recent Hub commit `fc7760a`, but now it's a security leak vector: any user with `pg_dump` access (e.g. via the Management API token leaked in action logs, see MEMORY.md line 99) can read the key.

**Fix**: (a) add `RAISE LOG` inside the exception block so Supabase logs see the failure, (b) write failures into a `dash_notification_dispatch_errors` table for observability, (c) move the JWT to a GUC or secret table readable only by postgres.

---

## P2-1: DM message body does not escape `<` / `&` but React `{message.message}` saves it

**File**: `/home/dash/voyo-music/src/components/dahub/DirectMessageChat.tsx:103`

Content is rendered via JSX `{message.message}` — React escapes by default. No XSS here. But `whitespace-pre-wrap break-words [overflow-wrap:anywhere]` means a single pasted 2000-char URL will overflow wrap but also stretch the bubble vertically without bound. There's a 1000-char server-side limit (dahub-api.ts:484 `message.slice(0, 1000)`), so bounded — but no client-side feedback so 1500 typed chars silently truncate to 1000 on the wire, user sees the full message locally but the recipient sees 1000. Confusing.

**Fix**: add `maxLength={1000}` on the `<textarea>` at DirectMessageChat.tsx:377-385 (or display counter).

---

## P2-2: Attachment_data is JSON but `message.attachment_data.title` rendered raw — potential XSS surface

**File**: `/home/dash/voyo-music/src/components/dahub/DirectMessageChat.tsx:116-118`

`{message.attachment_data.title}` and `{message.attachment_data.artist}` — React escapes, so not XSS. But there's no Zod/schema validation: a malicious user with a service key who inserts `{attachment_type: 'track', attachment_data: {title: <React-unsafe thing>}}` could confuse the UI. Low priority but worth a schema guard.

---

## P2-3: DynamicIsland notification id `dm-${newMessage.id}` can collide with demo ids `'1','2','3'`

**Files**:
- `/home/dash/voyo-music/src/App.tsx:752` — `id: \`dm-${newMessage.id}\``
- `/home/dash/voyo-music/src/components/ui/DynamicIsland.tsx:134-161` — demo ids `'1'`, `'2'`, `'3'`

Unlikely collision in practice (dm-<uuid> vs short numerics), but the demo timers fire on every mount of DynamicIsland, which is once per auth session. They spam real notification queues with fake Burna Boy / Aziz messages for 15s after every login. Noise in production.

**Fix**: gate demos behind `if (import.meta.env.DEV)` at DynamicIsland.tsx:134-161.

---

## P2-4: Unread badge stays stale across chats — `getUnreadCount` cached on mount only

**File**: `/home/dash/voyo-music/src/components/dahub/Dahub.tsx:981, 998`

`loadData()` fetches `unreadCount` once. The subscribe callback at line 990-999 increments `setUnreadCount(c => c + 1)` on INSERT but never decrements on `markAsRead`. Open chat → read all → close chat → badge still shows "+3". Only refresh clears it.

**Fix**: when `activeChat` is cleared (line 962), call `messagesAPI.getUnreadCount(userId)` and set it; OR decrement when `markAsRead` is invoked.

---

## P2-5: Message ordering relies purely on client clock (`created_at` default NOW() server-side, good) but UI doesn't handle out-of-order RT arrivals

**File**: `/home/dash/voyo-music/src/components/dahub/DirectMessageChat.tsx:205`

`setMessages(prev => [...prev, msg])` appends by arrival order, not `created_at`. If two messages are inserted within the same ms on different PostgreSQL connections, the RT stream can deliver them out-of-order. Groups by `toDateString()` at line 264 — fine. But ordering within a group is arrival-order, not creation-order, so a lag spike can flip two adjacent messages.

Same for optimistic: `temp-${Date.now()}` sort-sorts correctly numerically only within one client, but cross-client ordering isn't guaranteed until getMessages reruns.

**Fix**: on insert, `setMessages(prev => [...prev, msg].sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()))`. Small O(n) cost, predictable UX.

---

## No block / mute mechanism exists

Grepped the entire `dahub/` and `lib/dahub/` trees for `block|mute|ban` — zero hits. The `friends.status='blocked'` enum value exists in SOCIAL_SCHEMA.sql:22, but no client code path sets it, and RLS `SELECT USING(true)` wouldn't hide blocked users' messages anyway. Parking as "missing feature" rather than a bug — flag for P1/roadmap when users start complaining about harassment.

---

## Summary of Action Items (sorted by blast radius)

| # | Issue | Effort | Blast radius |
|---|-------|--------|--------------|
| P0-1 | Rename `friendships` → `friends` + use `add_friend` RPC | 30min | "Add friend" button broken for all users |
| P0-2 | Unify the two `friends` schemas | 1h + SQL migration | Whole friends subsystem |
| P0-3 | Add `dash_notifications.status` column | 10min | All message notifications |
| P0-4 | Delete `components/chat/DirectMessageChat.tsx` + messagesAPI in voyo-api.ts | 1h | Kill dead code, simplify surface |
| P1-1 | Add UPDATE subscribe on messages for read-receipt | 30min | Read receipts never update |
| P1-2 | Port useHotSwap RT-reconnect to all 5 subscribe sites | 2h | Messages silently stop on WS death |
| P1-3 | visibilitychange + pagehide presence hooks | 1h | Presence drift → wrong "live friends" |
| P1-4 | Server-side `filter: 'to_id=eq.${id}'` on conversation channels | 20min | Bandwidth + RLS leak |
| P1-5 | De-dup optimistic vs server echo | 30min | Duplicate message bubbles |
| P1-6 | Error logging in push trigger + rotate service JWT out of function body | 2h + secret ops | Silent push-dispatch outages |
| P2-1 → P2-5 | Polish items, ~30min each | 2.5h total | UX quality |

**Est. total cleanup**: ~12 engineering hours to close P0 + P1.

---

## Cross-references

- Signal-flywheel FK+trigger+RLS playbook: `outputs/AUDIT-5-signal-flywheel.md`
- RT channel reconnect pattern: commit `0ce3fb5` on `src/player/useHotSwap.ts:440-499`
- Push trigger pattern: `/home/dash/Hub/supabase/PASTE_THIS_push_notifications.sql`
- Memory flag (still open): `~/.claude/projects/-home-dash-Hub/memory/voyo-signals-fk-flag.md`

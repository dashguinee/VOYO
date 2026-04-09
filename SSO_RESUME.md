# SSO Implementation - WORKING ARCHITECTURE
**Updated**: 2026-01-26
**Status**: IMPLEMENTED - voyo-fork's working pattern adopted
**Commit**: `eae398a`

---

## THE WORKING ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│  ONE DAHUB - Command Center as Single Source of Truth          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User clicks "Login with DASH"                               │
│     → loginWithDash() in universeStore                          │
│     → Redirects to: dash-command.vercel.app?returnUrl=...&app=V │
│                                                                 │
│  2. Command Center authenticates                                │
│     → Redirects back: voyo.app?dashAuth=base64(FLAT citizen)    │
│                                                                 │
│  3. App.tsx useEffect runs handleDashCallback()                 │
│     → Parses ?dashAuth param                                    │
│     → Saves FLAT to localStorage: { coreId, fullName, ... }     │
│     → Updates universeStore: isLoggedIn=true, coreId=xxx        │
│     → Cleans URL                                                │
│                                                                 │
│  4. User opens DaHub                                            │
│     → useDashIdentity() reads localStorage FLAT                 │
│     → Gets coreId directly: citizen.coreId                      │
│     → friendsAPI.getFriends(coreId) → Command Center Supabase   │
│     → FRIENDS LOAD!                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `src/store/universeStore.ts` | `loginWithDash()`, `handleDashCallback()` |
| `src/App.tsx` | Calls `handleDashCallback()` on mount |
| `src/components/dahub/Dahub.tsx` | Unified DaHub with `useDashIdentity()` |
| `src/lib/dahub/dahub-api.ts` | Friends/Messages API → Command Center Supabase |

## Storage Format (FLAT - matches Command Center)

```javascript
// localStorage key: 'dash_citizen_storage'
{
  coreId: "0046AAD",
  fullName: "Abdoul Aziz",
  initials: "AA",
  sequence: 46,
  phone: "+224..."
}
```

**NOT nested.** Command Center sends flat, we store flat.

## What Was Removed

- `VoyoDahub.tsx` - OG VOYO-specific Dahub (RIP, you served well)
- `DahubCore.tsx` - Old core component
- Complex SSO token exchange in `dash-auth.tsx` (kept only Badge component)

## What Was Kept

- Now Playing cards in ProfileCard (when `appContext='V'`)
- `useDashIdentity()` handles both flat and nested formats (backward compat)
- `DashAuthBadge` component for header display

## Test Flow

1. Go to https://voyo-music.vercel.app
2. Clear localStorage: `localStorage.clear()`
3. Open DaHub → Click "Login with DASH"
4. Should redirect to Command Center
5. Sign in → Should redirect back with `?dashAuth=...`
6. URL should clean, user should be logged in
7. DaHub should show friends (if any)

## Philosophy

ONE Dahub. ONE social graph. ONE support layer. ONE sense of "here".
Different vibes. Same gravity.

You in DASH, G.

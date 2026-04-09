# DynamicIsland Notifications - Realtime Integration

## Overview

The DynamicIsland notification system is now connected to Supabase realtime events. Notifications appear as iPhone-style pills at the top of the VOYO interface with smooth wave animations.

## Connected Events

### 1. Portal Reactions (Real-time OYÉ)
**Trigger**: When someone reacts to a track you're currently playing via the portal
**Source**: `reactionStore.subscribeToReactions()`
**Notification Type**:
- `music` - For 'fire' reactions (purple dot)
- `message` - For 'oye' reactions (blue dot)
- `music` - For 'like' reactions (purple dot)

**Example**:
```
Title: aziz
Subtitle: 🔥 fire on Higher
```

### 2. Category Pulse (MixBoard Hot)
**Trigger**: When a category gets 5+ reactions and becomes "hot"
**Source**: `reactionStore.categoryPulse`
**Notification Type**: `music` (purple dot)

**Example**:
```
Title: MixBoard
Subtitle: afro-heat is heating up
```

### 3. Portal Visits
**Trigger**: When someone visits your universe at voyomusic.com/yourusername
**Source**: `universeStore.viewingUniverse`
**Notification Type**: `system` (red dot)

**Example**:
```
Title: Portal Visit
Subtitle: dash is checking out your vibe
```

### 4. Portal Now-Playing Updates
**Trigger**: When viewing someone's portal and their track changes
**Source**: `universeStore.viewingUniverse.nowPlaying`
**Notification Type**: `music` (purple dot)

**Example**:
```
Title: aziz
Subtitle: now playing Higher
```

## Testing

### Console Testing
Open browser console and run:

```javascript
// Test music notification (purple dot)
testNotification('music', 'Burna Boy', 'Higher just dropped')

// Test message notification (blue dot)
testNotification('message', 'Aziz', 'yo come check this out')

// Test system notification (red dot)
testNotification('system', 'VOYO', 'notification system ready')
```

### Supabase Testing
1. **Test Reactions**:
   - Open two browser windows/tabs
   - Login with different users
   - Play same track in both
   - React with OYÉ/FIRE in one window
   - See notification appear in other window

2. **Test Portal Visits**:
   - User A opens their portal
   - User B visits voyomusic.com/userA
   - User A sees "Portal Visit" notification

3. **Test Now-Playing**:
   - User A opens portal and plays a track
   - User B views User A's portal
   - User A changes track
   - User B sees "now playing" notification

## Implementation Details

### File: `/home/dash/voyo-music/src/App.tsx`

**Lines 892-973**: Realtime subscription effect
- Subscribes to `reactionStore.subscribeToReactions()`
- Listens to `useReactionStore.subscribe()` for state changes
- Listens to `useUniverseStore.subscribe()` for portal events
- Calls `window.pushNotification()` with formatted data

**Key Features**:
- Filters out notifications from self (no self-notifications)
- Only notifies when reactions are on YOUR currently playing track
- Category pulse requires 5+ reactions to trigger
- Proper cleanup on unmount

### Notification Format

```typescript
interface Notification {
  id: string;           // Unique ID (e.g., "reaction-123" or "pulse-afro-heat-1234567")
  type: 'music' | 'message' | 'system';  // Determines dot color
  title: string;        // Main text (username or source)
  subtitle: string;     // Detail text (action/message)
  read?: boolean;       // For unread count
  color?: string;       // Optional custom color override
}
```

### Notification Types & Colors

| Type | Dot Color | Use Case |
|------|-----------|----------|
| `music` | Purple (#a855f7) | Reactions, track drops, MixBoard pulse |
| `message` | Blue (#3b82f6) | OYÉ reactions, messages, social |
| `system` | Red (#ef4444) | Portal visits, system alerts |

## User Flow

1. **Wave Phase (3s)**: Animated gradient wave announces new notification
2. **Dark Phase (3s)**: Settles into dark pill with dot indicator
3. **Auto-fade (0.6s)**: Fades out if not interacted with
4. **Manual Resurface**: Tap header when hidden to bring back
5. **Expand**: Tap to see full notification with actions
6. **Navigate**: Swipe left/right to see other notifications
7. **Dismiss**: Swipe up to remove

## Anti-Spam Features

- **Self-filtering**: Never notify for your own reactions
- **Context-aware**: Only notify for relevant events (e.g., reactions on YOUR track)
- **Threshold**: Category pulse needs 5+ reactions to trigger
- **Cooldown**: Category "hot" state expires after 30s
- **Queue limit**: Max 50 notifications stored

## Future Enhancements

1. **Track Boosts**: Notify when a track you're playing gets boosted by others
2. **User Follows**: Notify when someone follows your universe
3. **Playlist Adds**: Notify when your tracks get added to playlists
4. **Comment Replies**: Notify when someone replies to your track comment
5. **Portal Sessions**: Notify when friends join your portal session

## Dependencies

- `reactionStore.ts` - Social reactions with realtime subscription
- `universeStore.ts` - Portal/universe state and realtime updates
- `supabase.ts` - Realtime database connection
- Framer Motion - Wave animations
- Zustand - Store subscriptions

## Cleanup

On unmount:
- Unsubscribes from `reactionStore` realtime channel
- Unsubscribes from store state listeners
- Cancels any pending timers/animations

# DaHub Universal Architecture

## Overview

DaHub is the social layer that connects ALL DASH apps. Same friends, same chat, everywhere.

```
┌─────────────────────────────────────────────────────────────┐
│                        DaHub                                 │
├─────────────────────────────────────────────────────────────┤
│  UNIVERSAL (Command Center)        │  APP-SPECIFIC          │
│  ├── Friends List                  │  ├── Stories (VOYO)    │
│  ├── Chat / Messages               │  ├── Artist Views (V)  │
│  ├── Online Presence               │  ├── Watch Party (TV)  │
│  └── Notifications                 │  └── Study Groups (E)  │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│    VOYO      │    │   DashTV     │    │  Dash Edu    │
│  sent_from=V │    │  sent_from=T │    │  sent_from=E │
│              │    │              │    │              │
│  App-specific│    │  App-specific│    │  App-specific│
│  Supabase    │    │  Supabase    │    │  Supabase    │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │   COMMAND   │
                    │   CENTER    │
                    │             │
                    │  friends    │
                    │  messages   │
                    │  presence   │
                    └─────────────┘
```

## Database Schema

### Command Center (Universal)

| Table | Purpose |
|-------|---------|
| `users` | Global identity (core_id = DASH ID) |
| `friends` | Bidirectional friendships |
| `messages` | Universal chat (tagged by `sent_from`) |
| `user_presence` | Who's online, which app, what activity |

### VOYO Supabase (App-Specific)

| Table | Purpose |
|-------|---------|
| `voyo_profiles` | Music preferences, likes, history |
| `voyo_playlists` | User playlists |
| `voyo_reactions` | Track reactions |

## Message Flow

```
User A (in VOYO):                    User B (in DashTV):
"Hey check this track!"              "Fire! Come watch the match"
        │                                     │
        ▼                                     ▼
┌───────────────────┐               ┌───────────────────┐
│ messagesAPI.send( │               │ messagesAPI.send( │
│   fromId: 'A',    │               │   fromId: 'B',    │
│   toId: 'B',      │               │   toId: 'A',      │
│   message: '...'  │               │   message: '...'  │
│   sent_from: 'V'  │               │   sent_from: 'T'  │
│ )                 │               │ )                 │
└─────────┬─────────┘               └─────────┬─────────┘
          │                                   │
          └───────────────┬───────────────────┘
                          ▼
              ┌───────────────────────┐
              │   Command Center      │
              │   messages table      │
              │                       │
              │   SAME CONVERSATION   │
              └───────────────────────┘
```

## Environment Variables

### VOYO (.env)
```bash
# VOYO's own Supabase (profiles, playlists, reactions)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx

# Command Center (friends, messages, presence)
VITE_COMMAND_CENTER_URL=https://mclbbkmpovnvcfmwsoqt.supabase.co
VITE_COMMAND_CENTER_KEY=xxx
```

### DashTV (.env) - Same Command Center!
```bash
# DashTV's own Supabase (channels, watch history)
VITE_SUPABASE_URL=https://yyy.supabase.co
VITE_SUPABASE_ANON_KEY=yyy

# Command Center - SAME as VOYO
VITE_COMMAND_CENTER_URL=https://mclbbkmpovnvcfmwsoqt.supabase.co
VITE_COMMAND_CENTER_KEY=xxx
```

## API Structure (voyo-api.ts)

```typescript
// Dual Supabase clients
const supabase = createClient(voyoUrl, voyoKey);           // VOYO data
const commandCenter = createClient(commandUrl, commandKey); // Universal

// friendsAPI → Command Center
friendsAPI.getFriends(dashId)      // Query Command Center
friendsAPI.addFriend(me, friend)   // Bidirectional in Command Center
friendsAPI.updatePresence(dashId)  // "on VOYO, listening to X"

// messagesAPI → Command Center
messagesAPI.send(from, to, msg)    // Inserts with sent_from='V'
messagesAPI.getConversations()     // Gets ALL messages (any app)
messagesAPI.subscribe(dashId)      // Real-time via Command Center

// profileAPI → VOYO Supabase
profileAPI.get(dashId)             // VOYO-specific preferences
profileAPI.updatePreferences()     // Music taste, history
```

## Hub.tsx (DaHub in VOYO)

Already wired up! Uses:
- `useAuth()` → DASH ID from Command Center
- `friendsAPI` → Friends from Command Center
- `messagesAPI` → Chat from Command Center
- `profileAPI` → VOYO profiles for now_playing

App-specific features:
- Stories (notes with now_playing)
- Artist Following
- Portal (live listening)

## Setup Steps

1. Run `SOCIAL_SCHEMA.sql` in Command Center Supabase
2. Add `VITE_COMMAND_CENTER_*` env vars to each DASH app
3. That's it - same friends, same chat, everywhere

---
*Created: Jan 2026*
*Status: Production Ready*

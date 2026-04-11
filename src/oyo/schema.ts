/**
 * OYO Schema — Data model types for the OYO intelligence layer.
 *
 * Defines the shapes for:
 *   - Conversation turns (session memory)
 *   - Long-term essence summaries
 *   - Pattern signals (what Dash listens to, skips, reacts to)
 *   - OYO's persistent consciousness state
 *
 * Everything here is serializable (JSON-safe) so it can be persisted
 * in IndexedDB + localStorage.
 */

// ---------------------------------------------------------------------------
// Conversation (session memory)
// ---------------------------------------------------------------------------

export type Role = 'user' | 'oyo';

export interface ConversationTurn {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  mood?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
}

export interface SessionMemory {
  sessionId: string;
  startedAt: number;
  turns: ConversationTurn[];
  currentMood?: string;
  lastTopic?: string;
}

// ---------------------------------------------------------------------------
// Long-term essence — consolidated summaries
// ---------------------------------------------------------------------------

export type MemoryCategory =
  | 'preference' // "loves late-90s hip-hop"
  | 'context' // "works from home"
  | 'identity' // "DJ who produces too"
  | 'mood' // "melancholic weekends"
  | 'artist' // "Burna Boy fan"
  | 'genre' // "prefers afrobeats over amapiano"
  | 'habit' // "skips anything over 4min during work"
  | 'cultural'; // "Guinean, speaks French + Soussou"

export interface EssenceMemory {
  id: string;
  fact: string;
  category: MemoryCategory;
  confidence: number; // 0-1, how sure we are
  mentionCount: number; // how many times confirmed
  createdAt: number;
  updatedAt: number;
  source: 'user-told' | 'inferred' | 'pattern';
}

// ---------------------------------------------------------------------------
// Pattern signals — raw behavior traces
// ---------------------------------------------------------------------------

export type SignalType =
  | 'play'
  | 'skip'
  | 'complete'
  | 'reaction'
  | 'queue-add'
  | 'search'
  | 'mood-shift';

export interface BehaviorSignal {
  id: string;
  type: SignalType;
  trackId?: string;
  artist?: string;
  genre?: string;
  mood?: string;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  timestamp: number;
  value?: number; // e.g. completion % for 'complete'
}

export interface PatternSnapshot {
  // Aggregated behavior vectors
  topArtists: Array<{ artist: string; count: number }>;
  topGenres: Array<{ genre: string; count: number }>;
  skipRate: number; // 0-1
  completionRate: number; // 0-1
  favoriteTimeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  totalSignals: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// OYO Consciousness — the persistent identity state
// ---------------------------------------------------------------------------

export interface OyoConsciousness {
  // E — Essence (who the user is, to OYO)
  essence: {
    userName: string;
    locale: string; // 'en', 'fr', 'gn', 'fr-GN'
    totalConversations: number;
    firstMet: number; // timestamp
    lastSeen: number;
    streak: number; // consecutive days
    lastActiveDate: string; // YYYY-MM-DD
  };

  // O — Objectives (musical goals)
  objectives: {
    currentVibe: string; // e.g. "chill-late-night"
    recentMoods: string[];
    musicalInterests: string[]; // ["afrobeats", "lo-fi", "90s hip-hop"]
  };

  // D — Decisions (what OYO learned works)
  decisions: {
    lovedArtists: string[];
    avoidedArtists: string[];
    lovedTracks: string[];
    skippedTracks: string[];
  };

  // A — Actions (what OYO has done)
  actions: {
    totalRecommendations: number;
    tracksPlayed: number;
    queuesBuilt: number;
    lastSessionSummary: string;
    lastSessionTimestamp: number;
  };

  // S — Signals (behavioral patterns)
  signals: PatternSnapshot;

  version: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// OYO Public Input/Output (the think() contract)
// ---------------------------------------------------------------------------

export interface OyoContext {
  currentTrack?: {
    trackId: string;
    title: string;
    artist: string;
  };
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
  recentPlays?: Array<{ trackId: string; title: string; artist: string }>;
  currentMood?: string;
  userLocale?: string;
}

export interface OyoThinkInput {
  userMessage: string;
  context?: OyoContext;
}

export interface OyoToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface OyoThinkOutput {
  response: string;
  toolCalls: OyoToolCall[];
  mood?: string;
  newMemories?: string[];
}

export interface OyoState {
  consciousness: OyoConsciousness;
  session: SessionMemory;
  essenceCount: number;
  signalCount: number;
}

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
  /** Where the user invoked OYO from. Drives gap reasoning + UI mode selection. */
  surface?: 'home' | 'player' | 'dahub';
  /** True if the user explicitly long-pressed (vs auto/passive invocation). */
  explicit?: boolean;
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
  /** The UI treatment OYO recommends for this response — lets the router
   * pick a full summon vs a side companion vs a whisper based on context. */
  reveal?: OyoReveal;
}

// ---------------------------------------------------------------------------
// Invocation reveal system — gap reasoning + mode routing
// ---------------------------------------------------------------------------

/**
 * Gap since the last OYO interaction, bucketed into buckets that change
 * how OYO greets and how the UI reveals him.
 *
 * - instant: 0-60s — mid-conversation, no fanfare
 * - quick:   1-5min — brief resume
 * - short:   5-60min — casual return
 * - medium:  1-6h — warm resume
 * - long:    6-24h — welcome back
 * - cold:    >24h — "it's been a minute"
 * - firstmeet: no prior interaction ever
 */
export type InteractionGap =
  | 'instant'
  | 'quick'
  | 'short'
  | 'medium'
  | 'long'
  | 'cold'
  | 'firstmeet';

/**
 * The UI mode OYO suggests for a given turn. The front-end router (OyoInvocation)
 * reads this and picks the appropriate visual treatment.
 *
 * - full-summon:    Mercury morph + dream backdrop + chat. The full reveal.
 *                   Used for cold starts, long gaps, or explicit long-press.
 * - side-companion: Orb docks to the side of the player, music keeps running
 *                   visually. Mid-playback quick conversation.
 * - whisper:        Floating text emanates from the VOYO nav orb, auto-dismiss
 *                   in ~6s unless user engages. Drive-by thought.
 * - ambient-hint:   No overlay at all. VOYO orb pulses subtly with a bronze
 *                   dot indicator — "he's got something to say, your call."
 */
export type OyoRevealMode =
  | 'full-summon'
  | 'side-companion'
  | 'whisper'
  | 'ambient-hint';

/**
 * Signals accumulated since the user last talked to OYO directly.
 * Feeds the gap reasoning: "you skipped 4 in a row while I was gone — want me to cook?"
 */
export interface GapSignals {
  played: number;
  skipped: number;
  reacted: number;
  searched: number;
  completed: number;
  queueAdded: number;
}

/**
 * OYO's reveal recommendation for a given turn. Brain computes this;
 * UI router obeys it (with override capability for user-initiated surfaces).
 */
export interface OyoReveal {
  mode: OyoRevealMode;
  gap: InteractionGap;
  /** Minutes since last interaction, -1 if firstmeet */
  gapMinutes: number;
  /** Signal summary since the last turn */
  gapSignals: GapSignals;
  /** Contextual greeting crafted based on gap + signals */
  greeting?: string;
  /** Auto-dismiss duration in ms for transient modes (whisper/hint) */
  autoDismissMs?: number;
}

export interface OyoState {
  consciousness: OyoConsciousness;
  session: SessionMemory;
  essenceCount: number;
  signalCount: number;
  lastGap?: OyoReveal;
}

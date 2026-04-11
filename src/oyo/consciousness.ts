/**
 * OYO Consciousness — Persistent identity + state about the user.
 *
 * EODAS-H lite adapted from Guinius giro-consciousness. Stored in localStorage
 * for instant read (no async required at boot). Tracks:
 *
 *   E — Essence: name, locale, streak, meet date
 *   O — Objectives: current vibe, recent moods, musical interests
 *   D — Decisions: loved/avoided artists + tracks
 *   A — Actions: conversation + recommendation counts
 *   S — Signals: behavior pattern snapshot
 */

import type { OyoConsciousness, PatternSnapshot } from './schema';

const STORAGE_KEY = 'voyo-oyo-consciousness';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function emptySnapshot(): PatternSnapshot {
  return {
    topArtists: [],
    topGenres: [],
    skipRate: 0,
    completionRate: 0,
    favoriteTimeOfDay: 'evening',
    totalSignals: 0,
    updatedAt: 0,
  };
}

function defaultConsciousness(): OyoConsciousness {
  return {
    essence: {
      userName: '',
      locale: 'en',
      totalConversations: 0,
      firstMet: Date.now(),
      lastSeen: Date.now(),
      streak: 0,
      lastActiveDate: '',
    },
    objectives: {
      currentVibe: '',
      recentMoods: [],
      musicalInterests: [],
    },
    decisions: {
      lovedArtists: [],
      avoidedArtists: [],
      lovedTracks: [],
      skippedTracks: [],
    },
    actions: {
      totalRecommendations: 0,
      tracksPlayed: 0,
      queuesBuilt: 0,
      lastSessionSummary: '',
      lastSessionTimestamp: 0,
    },
    signals: emptySnapshot(),
    version: 1,
    updatedAt: 0,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function loadConsciousness(): OyoConsciousness {
  try {
    if (typeof localStorage === 'undefined') return defaultConsciousness();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConsciousness();
    const parsed = JSON.parse(raw) as Partial<OyoConsciousness>;
    return { ...defaultConsciousness(), ...parsed };
  } catch {
    return defaultConsciousness();
  }
}

export function saveConsciousness(state: OyoConsciousness): void {
  try {
    if (typeof localStorage === 'undefined') return;
    state.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function resetConsciousness(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Streak handling
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function touchStreak(state: OyoConsciousness): OyoConsciousness {
  const t = today();
  if (state.essence.lastActiveDate === t) return state;

  const next: OyoConsciousness = { ...state };
  next.essence = { ...state.essence };

  if (state.essence.lastActiveDate === yesterday()) {
    next.essence.streak = state.essence.streak + 1;
  } else if (state.essence.lastActiveDate === '') {
    next.essence.streak = 1;
  } else {
    next.essence.streak = 1;
  }
  next.essence.lastActiveDate = t;
  next.essence.lastSeen = Date.now();
  return next;
}

// ---------------------------------------------------------------------------
// Recording helpers
// ---------------------------------------------------------------------------

function uniquePush(arr: string[], val: string, max: number): string[] {
  const cleaned = val.trim();
  if (!cleaned) return arr;
  const filtered = arr.filter((v) => v.toLowerCase() !== cleaned.toLowerCase());
  filtered.push(cleaned);
  return filtered.slice(-max);
}

export function recordInterest(state: OyoConsciousness, interest: string): OyoConsciousness {
  return {
    ...state,
    objectives: {
      ...state.objectives,
      musicalInterests: uniquePush(state.objectives.musicalInterests, interest, 15),
    },
    updatedAt: Date.now(),
  };
}

export function recordMood(state: OyoConsciousness, mood: string): OyoConsciousness {
  return {
    ...state,
    objectives: {
      ...state.objectives,
      currentVibe: mood,
      recentMoods: uniquePush(state.objectives.recentMoods, mood, 10),
    },
    updatedAt: Date.now(),
  };
}

export function recordLovedArtist(state: OyoConsciousness, artist: string): OyoConsciousness {
  return {
    ...state,
    decisions: {
      ...state.decisions,
      lovedArtists: uniquePush(state.decisions.lovedArtists, artist, 20),
    },
    updatedAt: Date.now(),
  };
}

export function recordRecommendation(state: OyoConsciousness, summary?: string): OyoConsciousness {
  return {
    ...state,
    actions: {
      ...state.actions,
      totalRecommendations: state.actions.totalRecommendations + 1,
      lastSessionSummary: summary || state.actions.lastSessionSummary,
      lastSessionTimestamp: Date.now(),
    },
    updatedAt: Date.now(),
  };
}

export function bumpConversation(state: OyoConsciousness): OyoConsciousness {
  return {
    ...state,
    essence: {
      ...state.essence,
      totalConversations: state.essence.totalConversations + 1,
      lastSeen: Date.now(),
    },
    updatedAt: Date.now(),
  };
}

export function updateSignals(state: OyoConsciousness, snapshot: PatternSnapshot): OyoConsciousness {
  return { ...state, signals: snapshot, updatedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// System prompt injection
// ---------------------------------------------------------------------------

export function buildConsciousnessBlock(state: OyoConsciousness): string {
  const parts: string[] = [];

  if (!state.essence.userName && state.essence.totalConversations === 0) {
    return '=== OYO MEMORY ===\nFirst time meeting this listener — be welcoming, curious about their taste, light.';
  }

  parts.push('=== OYO MEMORY (what you remember about this listener) ===');

  if (state.essence.userName) {
    parts.push(`Listener: ${state.essence.userName}`);
  }
  if (state.essence.streak > 1) {
    parts.push(`Streak: ${state.essence.streak} days in a row`);
  }
  if (state.essence.totalConversations > 0) {
    parts.push(`Total chats: ${state.essence.totalConversations}`);
  }

  if (state.objectives.currentVibe) {
    parts.push(`Current vibe: ${state.objectives.currentVibe}`);
  }
  if (state.objectives.recentMoods.length > 0) {
    parts.push(`Recent moods: ${state.objectives.recentMoods.slice(-5).join(', ')}`);
  }
  if (state.objectives.musicalInterests.length > 0) {
    parts.push(`Musical interests: ${state.objectives.musicalInterests.slice(-8).join(', ')}`);
  }

  if (state.decisions.lovedArtists.length > 0) {
    parts.push(`Loves: ${state.decisions.lovedArtists.slice(-6).join(', ')}`);
  }
  if (state.decisions.avoidedArtists.length > 0) {
    parts.push(`Skips often: ${state.decisions.avoidedArtists.slice(-4).join(', ')}`);
  }

  if (state.signals.favoriteTimeOfDay) {
    parts.push(`Listens most: ${state.signals.favoriteTimeOfDay}`);
  }
  if (state.signals.topGenres.length > 0) {
    const gens = state.signals.topGenres
      .slice(0, 3)
      .map((g) => `${g.genre}(${g.count})`)
      .join(', ');
    parts.push(`Top genres: ${gens}`);
  }

  if (state.actions.lastSessionSummary) {
    parts.push(`Last session: ${state.actions.lastSessionSummary}`);
  }

  return parts.join('\n');
}

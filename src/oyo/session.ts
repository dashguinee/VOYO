/**
 * OYO Session Memory — Per-conversation turn buffer.
 *
 * Holds the current conversation in memory only. Cleared on page reload.
 * Phase 2 may persist this to sessionStorage; Phase 1 keeps it simple.
 *
 * Exposes helpers to:
 *   - append user/oyo turns
 *   - format history for Gemini prompting
 *   - extract the last N messages for pattern scanning
 */

import type { ConversationTurn, SessionMemory, OyoToolCall } from './schema';

const SESSION_KEY = 'voyo-oyo-session';
const MAX_TURNS = 40; // rolling window

function newTurnId(): string {
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function newSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// In-memory singleton (Phase 1 — no persistence across reloads)
// ---------------------------------------------------------------------------

let current: SessionMemory = initialSession();

function initialSession(): SessionMemory {
  // Try sessionStorage (survives route changes, cleared on tab close)
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SessionMemory;
        if (parsed && Array.isArray(parsed.turns)) return parsed;
      }
    }
  } catch {
    /* ignore */
  }

  return {
    sessionId: newSessionId(),
    startedAt: Date.now(),
    turns: [],
  };
}

function persist(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(current));
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getSession(): SessionMemory {
  return current;
}

export function appendUserTurn(content: string): ConversationTurn {
  const turn: ConversationTurn = {
    id: newTurnId(),
    role: 'user',
    content,
    timestamp: Date.now(),
  };
  current.turns.push(turn);
  trim();
  persist();
  return turn;
}

export function appendOyoTurn(
  content: string,
  mood?: string,
  toolCalls?: OyoToolCall[],
): ConversationTurn {
  const turn: ConversationTurn = {
    id: newTurnId(),
    role: 'oyo',
    content,
    timestamp: Date.now(),
    mood,
    toolCalls: toolCalls?.map((t) => ({ name: t.name, args: t.args })),
  };
  current.turns.push(turn);
  if (mood) current.currentMood = mood;
  trim();
  persist();
  return turn;
}

function trim(): void {
  if (current.turns.length > MAX_TURNS) {
    current.turns = current.turns.slice(-MAX_TURNS);
  }
}

export function resetSession(): void {
  current = {
    sessionId: newSessionId(),
    startedAt: Date.now(),
    turns: [],
  };
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function getRecentTurns(n = 10): ConversationTurn[] {
  return current.turns.slice(-n);
}

/**
 * Format history for Gemini contents array.
 * Converts OYO session turns into the {role, parts} shape Gemini expects.
 */
export function formatHistoryForGemini(
  limit = 12,
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const recent = current.turns.slice(-limit);
  return recent.map((t) => ({
    role: t.role === 'user' ? 'user' : ('model' as const),
    parts: [{ text: t.content }],
  }));
}

export function getUserMessagesText(limit = 10): string[] {
  return current.turns
    .filter((t) => t.role === 'user')
    .slice(-limit)
    .map((t) => t.content);
}

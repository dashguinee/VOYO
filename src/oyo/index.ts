/**
 * OYO — The VOYO Music intelligence layer.
 *
 * Public API:
 *   - think(input)       → run a full conversation cycle (user message → OYO response)
 *   - remember(fact)     → save a long-term fact about the listener
 *   - recall(topic)      → search long-term memory
 *   - reset()            → wipe session + consciousness (keep essences unless fullReset)
 *   - getState()         → current OYO state snapshot (for UI)
 *   - isAvailable()      → whether Gemini is reachable right now
 *
 * Phase 1 of the OYO vision — the BRAIN only. The visual morph UI (Phase 2)
 * and Gemini Live voice streaming (Phase 3) plug into this same API later.
 *
 * Usage:
 *   import { oyo } from './oyo';
 *   const reply = await oyo.think({
 *     userMessage: "I'm in a chill mood, what should I play?",
 *     context: { timeOfDay: 'night' },
 *   });
 *   console.log(reply.response);
 *   console.log(reply.toolCalls);
 */

import type {
  OyoThinkInput,
  OyoThinkOutput,
  OyoState,
  EssenceMemory,
  MemoryCategory,
} from './schema';
import { runThoughtCycle, getCurrentConsciousness } from './thoughts';
import {
  saveEssence,
  searchEssences,
  listEssences,
  clearMemory,
  listSignals,
} from './memory';
import { getSession, resetSession } from './session';
import { resetConsciousness } from './consciousness';
import { consolidate } from './essence';
import { isGeminiAvailable } from './providers/gemini';
import { clearCache } from './cache';
import { computeReveal } from './gap';

// ---------------------------------------------------------------------------
// think()
// ---------------------------------------------------------------------------

async function think(input: OyoThinkInput): Promise<OyoThinkOutput> {
  if (!input || typeof input.userMessage !== 'string') {
    throw new Error('oyo.think() requires { userMessage: string }');
  }
  return runThoughtCycle(input);
}

// ---------------------------------------------------------------------------
// remember() / recall()
// ---------------------------------------------------------------------------

async function remember(
  fact: string,
  category: MemoryCategory = 'preference',
): Promise<EssenceMemory> {
  return saveEssence(fact, category, 'user-told');
}

async function recall(topic: string, limit = 10): Promise<string[]> {
  const found = await searchEssences(topic, limit);
  return found.map((m) => m.fact);
}

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

interface ResetOptions {
  /** Also wipe long-term essence memories (default false) */
  fullReset?: boolean;
}

async function reset(options: ResetOptions = {}): Promise<void> {
  // Before wiping, consolidate current session into essence so we don't lose it
  try {
    const session = getSession();
    if (session.turns.length > 0) {
      await consolidate(session.turns);
    }
  } catch {
    /* non-fatal */
  }

  resetSession();
  clearCache();

  if (options.fullReset) {
    resetConsciousness();
    await clearMemory();
  }
}

// ---------------------------------------------------------------------------
// getState()
// ---------------------------------------------------------------------------

async function getState(): Promise<OyoState> {
  const consciousness = getCurrentConsciousness();
  const session = getSession();
  const essences = await listEssences();

  // Compute the *current* gap snapshot — UI can use this for ambient
  // hint pulses ("OYO has something to say"), badge counts, etc., without
  // having to actually invoke think().
  let lastGap;
  try {
    const recentSignals = await listSignals(200);
    lastGap = computeReveal({
      signals: recentSignals,
      consciousness,
    });
  } catch {
    /* non-fatal */
  }

  return {
    consciousness,
    session,
    essenceCount: essences.length,
    signalCount: consciousness.signals.totalSignals,
    lastGap,
  };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

function isAvailable(): boolean {
  return isGeminiAvailable();
}

// ---------------------------------------------------------------------------
// Exported namespace
// ---------------------------------------------------------------------------

export const oyo = {
  think,
  remember,
  recall,
  reset,
  getState,
  isAvailable,
};

// Also export individual functions for tree-shaking
export { think, remember, recall, reset, getState, isAvailable };

// Re-export key types
export type {
  OyoThinkInput,
  OyoThinkOutput,
  OyoState,
  OyoContext,
  OyoToolCall,
  EssenceMemory,
  MemoryCategory,
} from './schema';

export default oyo;

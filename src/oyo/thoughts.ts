/**
 * OYO Thoughts — Multi-step reasoning orchestrator.
 *
 * One think() cycle:
 *   1. Build system prompt (character + consciousness + soussou + context)
 *   2. Append user message to session
 *   3. Call Gemini with system + history
 *   4. Parse response:
 *        - extract <tool_call> blocks
 *        - extract <!--MOOD:...--> marker
 *   5. Execute tool calls (sequential)
 *   6. Save OYO's reply to session
 *   7. Run inference-based essence digest (cheap, no API)
 *   8. Update consciousness (bump counts, mood, streak)
 *   9. Return OyoThinkOutput
 *
 * On Gemini failure: returns a graceful fallback response so the UI keeps
 * working during quota exhaustion or network hiccups.
 */

import type {
  OyoThinkInput,
  OyoThinkOutput,
  OyoToolCall,
  OyoConsciousness,
} from './schema';
import {
  loadConsciousness,
  saveConsciousness,
  touchStreak,
  bumpConversation,
  recordRecommendation,
  recordMood,
  updateSignals,
} from './consciousness';
import {
  appendUserTurn,
  appendOyoTurn,
} from './session';
import { buildCharacterPrompt, parseMoodMarker } from './data/character';
import { parseToolCalls, formatToolResults } from './tools/parser';
import { executeTools } from './tools/registry';
import { callGemini } from './providers/gemini';
import { digest } from './essence';
import { snapshot, currentTimeOfDay } from './pattern';
import { computeReveal, markInteraction } from './gap';
import { listSignals } from './memory';

// ---------------------------------------------------------------------------
// Main think cycle
// ---------------------------------------------------------------------------

export async function runThoughtCycle(input: OyoThinkInput): Promise<OyoThinkOutput> {
  // 1. Consciousness load + streak touch
  let consciousness = loadConsciousness();
  consciousness = touchStreak(consciousness);

  // 2. Refresh signal snapshot (cheap)
  try {
    const snap = await snapshot();
    consciousness = updateSignals(consciousness, snap);
  } catch {
    /* non-fatal */
  }

  // 2.5. GAP REASONING — compute reveal BEFORE we mark this turn as the
  //      "last interaction." This way the gap is between the previous turn
  //      and now, not zero. computeReveal returns mode + greeting + signals.
  let reveal: import('./schema').OyoReveal | undefined;
  try {
    const recentSignals = await listSignals(200);
    reveal = computeReveal({
      signals: recentSignals,
      consciousness,
      surface: input.surface,
      explicit: input.explicit,
      isPlaying: !!input.context?.currentTrack,
      currentTrack: input.context?.currentTrack
        ? { title: input.context.currentTrack.title, artist: input.context.currentTrack.artist }
        : undefined,
    });
  } catch {
    /* gap reasoning is non-fatal */
  }

  // 3. Append user turn to session
  const userTurn = appendUserTurn(input.userMessage);

  // 4. Build prompt
  const locale = input.context?.userLocale || consciousness.essence.locale;
  const enrichedContext = {
    ...input.context,
    timeOfDay: input.context?.timeOfDay || currentTimeOfDay(),
  };
  const systemPrompt = buildCharacterPrompt({
    consciousness,
    context: enrichedContext,
    locale,
    reveal,
  });

  // 5. Call Gemini
  const result = await callGemini({
    systemPrompt,
    userMessage: input.userMessage,
    context: enrichedContext,
  });

  let rawText = result.text;

  // Fallback if Gemini is unavailable
  if (!rawText) {
    rawText = buildFallbackResponse(input.userMessage);
  }

  // 6. Parse response — tool calls, mood, clean text
  const { cleanText: afterTools, toolCalls } = parseToolCalls(rawText);
  const { cleanText: finalText, mood } = parseMoodMarker(afterTools);

  // 7. Execute tool calls (sequential — they may depend on each other)
  const toolResults = toolCalls.length > 0 ? await executeTools(toolCalls) : [];
  const oyoToolCalls: OyoToolCall[] = toolCalls.map((c) => ({
    name: c.tool,
    args: c.params,
  }));

  // 8. Save OYO's reply to session
  appendOyoTurn(finalText, mood || undefined, oyoToolCalls);

  // 9. Digest user turn into essence memory (cheap, no API)
  let newMemories: string[] = [];
  try {
    newMemories = await digest(userTurn);
  } catch {
    /* non-fatal */
  }

  // 10. Update consciousness + persist
  consciousness = bumpConversation(consciousness);
  if (mood) consciousness = recordMood(consciousness, mood);
  if (toolCalls.length > 0) {
    consciousness = recordRecommendation(
      consciousness,
      `Moves made: ${toolCalls.map((t) => t.tool).join(', ')}`,
    );
  }
  saveConsciousness(consciousness);

  // 11. Attach tool result summaries to the response for debugging
  // (Tool results stay in the returned object as metadata the caller can log.)
  const _debugSummary = formatToolResults(toolResults);
  void _debugSummary;

  // 12. Mark this turn as the new "last interaction" — next gap reasoning
  //     will compute the delta from THIS moment. Done last so a crash
  //     mid-cycle doesn't poison the gap state.
  markInteraction();

  return {
    response: finalText,
    toolCalls: oyoToolCalls,
    mood: mood || undefined,
    newMemories,
    reveal,
  };
}

// ---------------------------------------------------------------------------
// Graceful fallback when Gemini is down
// ---------------------------------------------------------------------------

function buildFallbackResponse(userMessage: string): string {
  const lower = userMessage.toLowerCase();

  if (/chill|relax|mellow|wind down/i.test(lower)) {
    return "Chill mode. My brain's rebooting for a sec — but I know the vibe. Let the current queue run and I'll be sharper in a minute.\n<!--MOOD:chill-late-night-->";
  }
  if (/party|hype|turn up|banger/i.test(lower)) {
    return "Turn up mode incoming. I'm offline for a sec but the hype belt has you covered — hit shuffle and ride it.\n<!--MOOD:party-->";
  }
  if (/workout|gym|run/i.test(lower)) {
    return "Pump time. Brain's catching up but the workout pool is stocked — let it run.\n<!--MOOD:workout-->";
  }

  return "I hear you — my main brain's offline for a beat, but I'm still here. Let whatever's playing ride and hit me again in a minute.\n<!--MOOD:chill-->";
}

// ---------------------------------------------------------------------------
// State snapshot for getState()
// ---------------------------------------------------------------------------

export function getCurrentConsciousness(): OyoConsciousness {
  return loadConsciousness();
}

/**
 * OYO Gemini Provider — text reasoning client for OYO brain.
 *
 * Phase 1: text only (gemini-2.5-flash). Phase 3: swap to Gemini Live for
 * voice streaming — this interface stays the same so the brain doesn't
 * need to know which mode it's in.
 *
 * Features:
 *   - Circuit breaker: 3 consecutive fails → 10min cooldown (doubles on retry, cap 60min)
 *   - Response cache (5min TTL) via ../cache.ts
 *   - History formatting via ../session.ts
 *   - Short timeout (20s) — OYO turns should feel snappy
 */

import type { OyoContext } from '../schema';
import { formatHistoryForGemini } from '../session';
import { fingerprint, getCached, setCached } from '../cache';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) || '';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

let failureCount = 0;
let disabledUntil = 0;
let warnedForWindow = false;

function isDisabled(): boolean {
  return Date.now() < disabledUntil;
}

function recordFailure(): void {
  failureCount += 1;
  if (failureCount >= 3) {
    const steps = Math.floor(failureCount / 3) - 1;
    const cooldown = Math.min(10 * 60 * 1000 * Math.pow(2, steps), 60 * 60 * 1000);
    disabledUntil = Date.now() + cooldown;
    if (!warnedForWindow) {
      // eslint-disable-next-line no-console
      console.warn(
        `[OYO:Gemini] Circuit open — disabled for ${Math.round(cooldown / 60000)}min`,
      );
      warnedForWindow = true;
    }
  }
}

function recordSuccess(): void {
  failureCount = 0;
  disabledUntil = 0;
  warnedForWindow = false;
}

export function isGeminiAvailable(): boolean {
  return Boolean(GEMINI_API_KEY) && !isDisabled();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeminiCallInput {
  systemPrompt: string;
  userMessage: string;
  context?: OyoContext;
}

export interface GeminiCallResult {
  text: string | null;
  cached: boolean;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Main call
// ---------------------------------------------------------------------------

export async function callGemini(input: GeminiCallInput): Promise<GeminiCallResult> {
  const start = Date.now();

  if (!GEMINI_API_KEY) {
    return {
      text: null,
      cached: false,
      durationMs: 0,
      error: 'No VITE_GEMINI_API_KEY set',
    };
  }

  if (isDisabled()) {
    return {
      text: null,
      cached: false,
      durationMs: 0,
      error: 'Circuit breaker open',
    };
  }

  // Cache lookup
  const contextKey = JSON.stringify(input.context || {});
  const fp = fingerprint([input.systemPrompt, input.userMessage, contextKey]);
  const cached = getCached(fp);
  if (cached !== null) {
    return { text: cached, cached: true, durationMs: Date.now() - start };
  }

  // Build Gemini request body — include session history for conversational continuity
  const history = formatHistoryForGemini(10);
  const contents = [
    ...history,
    {
      role: 'user' as const,
      parts: [{ text: input.userMessage }],
    },
  ];

  const body = {
    contents,
    systemInstruction: {
      role: 'system' as const,
      parts: [{ text: input.systemPrompt }],
    },
    generationConfig: {
      temperature: 0.85,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 1200,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      recordFailure();
      return {
        text: null,
        cached: false,
        durationMs: Date.now() - start,
        error: `HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      recordFailure();
      return {
        text: null,
        cached: false,
        durationMs: Date.now() - start,
        error: 'Empty response',
      };
    }

    recordSuccess();
    setCached(fp, text);
    return { text, cached: false, durationMs: Date.now() - start };
  } catch (err) {
    recordFailure();
    return {
      text: null,
      cached: false,
      durationMs: Date.now() - start,
      error: String(err),
    };
  }
}

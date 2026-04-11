/**
 * OYO Gap Reasoning — the "what happened while I was away?" module.
 *
 * Every time the user invokes OYO, we reason about:
 *   1. The TIME gap since the last turn
 *   2. The SIGNALS accumulated during that gap (plays, skips, reactions)
 *   3. The CURRENT context (surface, current track, mood)
 *
 * Output: an `OyoReveal` object that tells the UI router which mode to use
 * AND hands the brain a contextual greeting that doesn't feel canned.
 *
 * This is what stops OYO from feeling like a static door. Every reveal is
 * computed fresh based on the actual state of the listener relationship.
 */

import type {
  BehaviorSignal,
  GapSignals,
  InteractionGap,
  OyoConsciousness,
  OyoReveal,
  OyoRevealMode,
} from './schema';

const GAP_TRACKING_KEY = 'voyo-oyo-last-interaction';

// ---------------------------------------------------------------------------
// Time bucketing
// ---------------------------------------------------------------------------

/**
 * Bucket a gap in milliseconds into one of the named buckets.
 * -1 minutes means firstmeet (never talked before).
 */
export function bucketGap(gapMs: number, hasPrior: boolean): InteractionGap {
  if (!hasPrior) return 'firstmeet';
  if (gapMs < 60_000) return 'instant';
  if (gapMs < 5 * 60_000) return 'quick';
  if (gapMs < 60 * 60_000) return 'short';
  if (gapMs < 6 * 60 * 60_000) return 'medium';
  if (gapMs < 24 * 60 * 60_000) return 'long';
  return 'cold';
}

// ---------------------------------------------------------------------------
// Last-interaction tracking (localStorage, survives page reloads)
// ---------------------------------------------------------------------------

export function getLastInteractionAt(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(GAP_TRACKING_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function markInteraction(at: number = Date.now()): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GAP_TRACKING_KEY, String(at));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Signal aggregation — "what happened while I was away?"
// ---------------------------------------------------------------------------

const EMPTY_SIGNALS: GapSignals = Object.freeze({
  played: 0,
  skipped: 0,
  reacted: 0,
  searched: 0,
  completed: 0,
  queueAdded: 0,
});

/**
 * Aggregate raw behavior signals into gap-scoped counters.
 * Only signals newer than `sinceMs` are counted.
 */
export function aggregateGapSignals(signals: BehaviorSignal[], sinceMs: number): GapSignals {
  const scoped = signals.filter((s) => s.timestamp >= sinceMs);
  if (scoped.length === 0) return { ...EMPTY_SIGNALS };

  const out: GapSignals = { ...EMPTY_SIGNALS };
  for (const s of scoped) {
    if (s.type === 'play') out.played++;
    else if (s.type === 'skip') out.skipped++;
    else if (s.type === 'complete') out.completed++;
    else if (s.type === 'reaction') out.reacted++;
    else if (s.type === 'search') out.searched++;
    else if (s.type === 'queue-add') out.queueAdded++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mode selection — which UI treatment fits this gap + context?
// ---------------------------------------------------------------------------

export interface ModeSelectionInput {
  gap: InteractionGap;
  signals: GapSignals;
  /** The surface where the invocation came from. */
  surface?: 'home' | 'player' | 'dahub';
  /** True if the user explicitly long-pressed — honor their intent with full-summon. */
  explicit?: boolean;
  /** True if a track is currently playing (influences side-companion vs full-summon). */
  isPlaying?: boolean;
}

/**
 * Pick the reveal mode based on gap + context + user intent.
 *
 * Rules (in priority order):
 * 1. Explicit long-press → always full-summon (user asked for the reveal)
 * 2. firstmeet / cold → full-summon (ceremony moment)
 * 3. instant (<60s) mid-playback → side-companion (continuing convo, music running)
 * 4. quick + player surface + isPlaying → side-companion (light check-in)
 * 5. short + high signal activity → full-summon (something changed, deserve the stage)
 * 6. medium/long → full-summon (welcoming back)
 * 7. default → side-companion
 *
 * Whisper and ambient-hint are reserved for OYO-initiated turns (Phase 2.6),
 * not user-initiated invocations.
 */
export function selectMode(input: ModeSelectionInput): OyoRevealMode {
  const { gap, signals, surface, explicit, isPlaying } = input;

  if (explicit) return 'full-summon';
  if (gap === 'firstmeet' || gap === 'cold' || gap === 'long') return 'full-summon';

  if (gap === 'instant' && isPlaying) return 'side-companion';
  if (gap === 'quick' && surface === 'player' && isPlaying) return 'side-companion';

  // High signal activity during a short gap = something happened, full stage
  const totalSignals = signals.played + signals.skipped + signals.reacted;
  if (gap === 'short' && totalSignals >= 10) return 'full-summon';

  if (gap === 'medium') return 'full-summon';

  return 'side-companion';
}

// ---------------------------------------------------------------------------
// Contextual greeting crafter
// ---------------------------------------------------------------------------

interface GreetingInput {
  gap: InteractionGap;
  signals: GapSignals;
  surface?: 'home' | 'player' | 'dahub';
  consciousness?: Pick<OyoConsciousness, 'essence' | 'objectives' | 'decisions'>;
  currentTrack?: { title: string; artist: string };
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Craft a greeting line that reasons about the gap + signals. This is the
 * line OYO actually says on the reveal. It should feel written, not picked.
 *
 * These are STARTERS — the brain will layer more context on top via the
 * system prompt. Think of these as opening phrases OYO can anchor on.
 */
export function craftGreeting(input: GreetingInput): string {
  const { gap, signals, surface, consciousness, currentTrack } = input;
  const name = consciousness?.essence.userName;
  const vibe = consciousness?.objectives.currentVibe;

  // ── FIRSTMEET — ceremony ─────────────────────────────────────────────
  if (gap === 'firstmeet') {
    return pick([
      "First time we meet. I'm OYO. Tell me what you're on.",
      "New face. I'm OYO — the one behind the curtain. What are we doing?",
      "Welcome. I'm OYO. Let me hear what you're into and I'll take it from there.",
    ]);
  }

  // ── SIGNAL-DRIVEN — "while I was gone, you..." ──────────────────────
  // These override the generic gap greetings when the activity tells a story.
  if (signals.skipped >= 4 && signals.played < 3) {
    return pick([
      `${signals.skipped} skips in a row. Tell me what you actually want.`,
      `You been skipping like that — want me to cook something fresh?`,
      `Rough run out there. Let me try a different angle.`,
    ]);
  }

  if (signals.reacted >= 3) {
    return pick([
      `You been feeling this run. Want me to extend the vibe?`,
      `${signals.reacted} OYÉs since we talked. I see you. More of that?`,
      `You locked in. Let me pour more into this.`,
    ]);
  }

  if (signals.completed >= 5 && signals.skipped === 0) {
    return pick([
      `Clean run — you played ${signals.completed} straight. That's trust. What now?`,
      `You been just letting it flow. Want me to keep the thread going?`,
    ]);
  }

  if (signals.searched >= 2 && signals.played === 0) {
    return pick([
      `You were searching but didn't commit to anything. Tell me what you're chasing.`,
      `I saw you looking. What weren't you finding?`,
    ]);
  }

  // ── SURFACE-AWARE greetings ────────────────────────────────────────
  if (surface === 'player' && currentTrack) {
    if (gap === 'instant' || gap === 'quick') {
      return pick([
        `This one still hitting?`,
        `Mid-song check — you good with this?`,
        `"${currentTrack.title}" — want me to take this deeper or switch?`,
      ]);
    }
    return pick([
      `You on "${currentTrack.title}" now. Want me to thread it?`,
      `Caught you mid-${currentTrack.artist}. Talk to me.`,
    ]);
  }

  if (surface === 'dahub') {
    return pick([
      `Why'd you pull me in here? Backstage — keep it real.`,
      `DaHub. Unusual spot to call me. What's up?`,
      `You came looking for me in the back. Spill.`,
    ]);
  }

  // ── TIME-GAP based ─────────────────────────────────────────────────
  switch (gap) {
    case 'instant':
      return pick([`Yeah?`, `Still here. What?`, `Go.`]);

    case 'quick':
      return pick([
        `Back already. What's up?`,
        `Quick one?`,
        `Yeah, tell me.`,
      ]);

    case 'short':
      if (vibe) return `Still ${vibe}, or you wanna switch?`;
      return pick([
        `You're back. What's the move?`,
        `Talk to me.`,
        `What you on now?`,
      ]);

    case 'medium':
      return pick([
        name ? `Welcome back${name ? `, ${name}` : ''}. What are we doing?` : `Welcome back. What are we doing?`,
        `Been a few hours. What's the vibe now?`,
        `You're here. Let me hear it.`,
      ]);

    case 'long':
      return pick([
        `You been good? What you on today?`,
        `It's been a minute. What's the vibe?`,
        `Back in the booth. Catch me up.`,
      ]);

    case 'cold':
      return pick([
        `It's been a minute. What you on?`,
        `Long time. Tell me what's been in rotation.`,
        `You're back. What changed?`,
      ]);

    default:
      return `What's the vibe?`;
  }
}

// ---------------------------------------------------------------------------
// Auto-dismiss duration for transient modes
// ---------------------------------------------------------------------------

export function autoDismissFor(mode: OyoRevealMode): number | undefined {
  if (mode === 'whisper') return 6000;
  if (mode === 'ambient-hint') return undefined; // ambient-hint stays until user engages
  return undefined;
}

// ---------------------------------------------------------------------------
// The one-call public API
// ---------------------------------------------------------------------------

export interface ComputeRevealInput {
  signals: BehaviorSignal[];
  consciousness: OyoConsciousness;
  surface?: 'home' | 'player' | 'dahub';
  explicit?: boolean;
  isPlaying?: boolean;
  currentTrack?: { title: string; artist: string };
}

/**
 * Compute the full reveal for an invocation. Brain calls this at the top
 * of `think()` so every response has reveal context attached.
 */
export function computeReveal(input: ComputeRevealInput): OyoReveal {
  const last = getLastInteractionAt();
  const now = Date.now();
  const hasPrior = last != null && last > 0;
  const gapMs = hasPrior ? now - (last as number) : -1;
  const gap = bucketGap(gapMs, hasPrior);

  // Aggregate signals that happened since last interaction (or last 2h if firstmeet)
  const sinceMs = hasPrior ? (last as number) : now - 2 * 60 * 60_000;
  const signals = aggregateGapSignals(input.signals, sinceMs);

  const mode = selectMode({
    gap,
    signals,
    surface: input.surface,
    explicit: input.explicit,
    isPlaying: input.isPlaying,
  });

  const greeting = craftGreeting({
    gap,
    signals,
    surface: input.surface,
    consciousness: input.consciousness,
    currentTrack: input.currentTrack,
  });

  const autoDismissMs = autoDismissFor(mode);

  const gapMinutes = hasPrior ? Math.round(gapMs / 60_000) : -1;

  return {
    mode,
    gap,
    gapMinutes,
    gapSignals: signals,
    greeting,
    autoDismissMs,
  };
}

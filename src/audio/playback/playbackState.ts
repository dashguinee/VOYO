/**
 * Playback State Machine — explicit, observable, guarded.
 *
 * The audio pipeline has always had implicit state scattered across refs
 * (isLoadingTrackRef, isPlaying, audio.paused, audio.ended, isEdgeStreamRef).
 * This module adds an EXPLICIT state layer on top:
 *
 *   idle       no track; starting state
 *   loading    sourceResolver running; silent WAV may be engaged
 *   bridge     silent WAV playing during src swap (transition window)
 *   playing    real track playing audibly
 *   paused     user-paused (NOT BG-paused — those stay 'playing')
 *   advancing  track ended; nextTrack being scheduled
 *   error      recovery in flight (handleAudioError ladder)
 *
 * THE POINT isn't to replace the existing refs. It's to make state
 * OBSERVABLE so every transition lands in telemetry (state_transition
 * events with {from, to, reason}), and to GUARD illegal moves that
 * would indicate a bug (e.g., advancing → advancing without going
 * through loading). The ALLOWED_TRANSITIONS table documents what's
 * intended.
 *
 * Usage:
 *   import { playbackState } from 'src/audio/playback/playbackState';
 *   playbackState.transition('loading', trackId, 'loadTrack_start');
 *   ...
 *   const snapshot = usePlaybackState(); // React subscribe
 *
 * Single tab per pipeline → module singleton is the right shape.
 */

import { useEffect, useState } from 'react';
import { trace } from '../../services/telemetry';

export type PlaybackState =
  | 'idle'
  | 'loading'
  | 'bridge'
  | 'playing'
  | 'paused'
  | 'advancing'
  | 'error';

export interface StateSnapshot {
  state: PlaybackState;
  trackId: string | null;
  reason: string | null;   // last transition's reason (debug)
  since: number;           // Date.now() when we entered this state
  prev: PlaybackState | null;
}

// What's allowed from each state. Self-transitions are always allowed
// (useful for re-arming loading on retry etc). Illegal transitions are
// logged as `state_illegal` and silently rejected — surface the bug
// without breaking playback.
// Pause is a user-intent terminal — reachable from any active state.
// Previously we excluded loading/bridge/advancing → paused, which silently
// dropped user pauses mid-load (observed in telemetry as state_illegal
// loading→paused: the audio element paused but the state machine stayed
// 'loading' and the next nt/load flow treated it as an in-flight load).
const ALLOWED: Record<PlaybackState, PlaybackState[]> = {
  idle:      ['loading', 'error', 'bridge'],
  loading:   ['bridge', 'playing', 'paused', 'error', 'idle', 'advancing'],
  bridge:    ['loading', 'playing', 'paused', 'error', 'advancing'],
  playing:   ['paused', 'advancing', 'loading', 'bridge', 'error'],
  paused:    ['playing', 'loading', 'idle', 'error'],
  advancing: ['loading', 'bridge', 'paused', 'idle', 'error'],
  error:     ['loading', 'playing', 'idle', 'paused'],
};

function createMachine() {
  let snapshot: StateSnapshot = {
    state: 'idle',
    trackId: null,
    reason: null,
    since: Date.now(),
    prev: null,
  };
  const listeners = new Set<(s: StateSnapshot) => void>();

  return {
    get: (): StateSnapshot => snapshot,

    transition(to: PlaybackState, trackId?: string | null, reason?: string): void {
      const from = snapshot.state;

      // Self-transition on same state is a no-op — trackId may update though.
      if (from === to) {
        if (trackId !== undefined && trackId !== snapshot.trackId) {
          snapshot = { ...snapshot, trackId: trackId, reason: reason || snapshot.reason };
          listeners.forEach(fn => fn(snapshot));
        }
        return;
      }

      const allowed = ALLOWED[from]?.includes(to) ?? false;
      if (!allowed) {
        trace('state_illegal', trackId ?? snapshot.trackId, { from, to, reason: reason || 'unspecified' });
        return; // Silently reject — don't break playback.
      }

      trace('state_transition', trackId ?? snapshot.trackId, {
        from,
        to,
        reason: reason || 'unspecified',
        dwellMs: Date.now() - snapshot.since,
      });

      snapshot = {
        state: to,
        trackId: trackId !== undefined ? trackId : snapshot.trackId,
        reason: reason || null,
        since: Date.now(),
        prev: from,
      };
      listeners.forEach(fn => fn(snapshot));
    },

    subscribe(cb: (s: StateSnapshot) => void): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },

    /** Test / debug helper — reset to idle without validation. */
    _reset(): void {
      snapshot = { state: 'idle', trackId: null, reason: null, since: Date.now(), prev: null };
      listeners.forEach(fn => fn(snapshot));
    },
  };
}

/**
 * Module-level singleton. One audio pipeline per tab; one state machine.
 */
export const playbackState = createMachine();

/**
 * React hook — subscribes to state transitions.
 */
export function usePlaybackState(): StateSnapshot {
  const [snapshot, setSnapshot] = useState(() => playbackState.get());
  useEffect(() => playbackState.subscribe(setSnapshot), []);
  return snapshot;
}

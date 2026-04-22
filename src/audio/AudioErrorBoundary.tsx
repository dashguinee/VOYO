/**
 * Audio Error Boundary — catches uncaught throws inside AudioPlayer and
 * prevents them from killing the whole app. The audio pipeline has 30+
 * refs, 15+ useEffects, and integrates with OS APIs (MediaSession,
 * WakeLock, getBattery, AudioContext). Any one of them can throw.
 *
 * On error: log to telemetry, render nothing (the audio element + chain
 * are gone this render but componentDidCatch will attempt one remount).
 * Music stops — but the rest of the app (library, search, UI) survives.
 *
 * Recovery contract (post-v{bumped}):
 *   A naive key-remount silently drops audio state. The AudioPlayer's
 *   main track-change useEffect is gated on `currentTrack?.trackId`. On
 *   a fresh mount with the SAME trackId (the common case — an intra-track
 *   throw), the effect does fire, but various downstream singletons
 *   (services/audioEngine.ts `_connectedElement`, the iframe bridge
 *   session, the stale closure inside `tryPlay`) can end up pointing at
 *   the torn-down <audio> element. Result: silent dead state until the
 *   user taps play or the track changes.
 *
 *   Fix: after remount, we null-cycle `currentTrack` through the store
 *   (null → same track) so the AudioPlayer useEffect unambiguously sees
 *   a diff on its `[currentTrack?.trackId]` dep, re-running the R2 probe
 *   + src assignment + play path against the NEW audio element. We reset
 *   currentTime/progress first so `setCurrentTrack`'s history-recording
 *   branch doesn't double-log the just-crashed track.
 *
 *   We also shortened the remount delay from 1000ms → 250ms (the 1s gap
 *   was long enough for OS media-session to feel dead), and added a tight
 *   crash-loop guard: 3 catches within 5s stops auto-remount so we don't
 *   thrash.
 */

import { Component, type ReactNode } from 'react';
import { trace } from '../services/telemetry';
import { devWarn } from '../utils/logger';
import { usePlayerStore } from '../store/playerStore';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorKey: number;
}

const REMOUNT_DELAY_MS = 250;
const CRASH_LOOP_WINDOW_MS = 5_000;
const CRASH_LOOP_THRESHOLD = 3;

export class AudioErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorKey: 0 };

  // Rolling timestamps of recent catches, for tight-loop detection. If
  // CRASH_LOOP_THRESHOLD entries fall within CRASH_LOOP_WINDOW_MS, we
  // stop the auto-remount cycle and stay in the error state so the user
  // (or a parent boundary / toast) can take over.
  private recentCatches: number[] = [];

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string }) {
    trace('audio_boundary_catch', null, {
      name: error.name,
      message: (error.message || '').slice(0, 120),
      componentStack: (errorInfo.componentStack || '').slice(0, 200),
    });
    devWarn('[AudioErrorBoundary] caught:', error);

    // Crash-loop guard — prune, append, check.
    const now = Date.now();
    this.recentCatches = this.recentCatches.filter(
      (t) => now - t < CRASH_LOOP_WINDOW_MS,
    );
    this.recentCatches.push(now);
    if (this.recentCatches.length >= CRASH_LOOP_THRESHOLD) {
      trace('audio_boundary_loop_halt', null, {
        catches: this.recentCatches.length,
        windowMs: CRASH_LOOP_WINDOW_MS,
      });
      return; // Stay in hasError; no auto-remount.
    }

    // Snapshot the track we were on at crash time. If the user navigates
    // to a different track during the remount window, the post-remount
    // effect will naturally fire on the new trackId anyway — we only
    // need to force-rerun when the track is unchanged.
    const savedTrackId =
      usePlayerStore.getState().currentTrack?.trackId ?? null;

    setTimeout(() => {
      this.setState(
        (prev) => ({ hasError: false, errorKey: prev.errorKey + 1 }),
        () => {
          // Post-remount kick. A fresh AudioPlayer is now mounted against
          // a new <audio> element, but its track-change useEffect is
          // gated on `currentTrack?.trackId` — unchanged since the crash,
          // so the downstream singletons and retry ladders can end up
          // closed over a dead ref. Null-cycle the store to force a real
          // trackId diff on the freshly-mounted effect.
          const store = usePlayerStore.getState();
          const track = store.currentTrack;
          if (!savedTrackId || !track || track.trackId !== savedTrackId) {
            // User moved on (or track cleared) — the live track-change
            // already did the work.
            return;
          }
          // Clear positional state so setCurrentTrack's history branch
          // (which records when currentTime > 0) skips this synthetic
          // re-assignment and doesn't double-log the crashed track.
          usePlayerStore.setState({
            currentTime: 0,
            progress: 0,
            currentTrack: null,
          });
          // Let React flush the `currentTrack: null` render (the effect's
          // `if (!currentTrack) return;` no-ops it) before we re-assign —
          // otherwise Zustand batches and the dep never diffs.
          queueMicrotask(() => {
            const latest = usePlayerStore.getState();
            if (latest.currentTrack === null) {
              usePlayerStore.setState({ currentTrack: track });
            }
          });
          trace('audio_boundary_reinit', null, {
            trackId: savedTrackId,
          });
        },
      );
    }, REMOUNT_DELAY_MS);
  }

  render() {
    if (this.state.hasError) return null;
    // Key remount forces React to tear down and rebuild child tree — gives
    // AudioPlayer a fresh mount after a caught throw.
    return <div key={this.state.errorKey}>{this.props.children}</div>;
  }
}

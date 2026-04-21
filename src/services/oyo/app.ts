/**
 * app — central orchestrator. Every user action in the UI lands here.
 *
 * Layers below (player, store, signals, prefetch, telemetry) are invisible
 * to UI components. When a button is tapped, a card is clicked, a gesture
 * resolves — the handler calls exactly one `app.*` method. This module is
 * the sole integrator that knows how to fan that action out.
 *
 * Contract:
 *   UI → app.playTrack / skip / addToQueue / oye / share / ...
 *
 *   Internally, each action touches as many subsystems as it needs to:
 *     • playerStore (what's playing, queue, isPlaying)
 *     • oyo signals (onPlay/onSkip/onComplete/onOye — taste graph)
 *     • oyo prefetch (queueForExtraction via r2Gate)
 *     • voyoStream shim (ensureTrackReady, skip bridge)
 *     • telemetry (logPlaybackEvent)
 *     • reactionStore (visual OYÉ bursts)
 *
 *   source param on play methods = where the click came from, fed to
 *   telemetry so we can see what surfaces convert.
 */

import type { Track, VoyoTab } from '../../types';
import { usePlayerStore } from '../../store/playerStore';
import { useReactionStore } from '../../store/reactionStore';
import { useTrackPoolStore } from '../../store/trackPoolStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { useDownloadStore } from '../../store/downloadStore';
import { voyoStream, ensureTrackReady } from '../voyoStream';
import { onPlay, onSkip, onOye, prefetch } from './index';
import { logPlaybackEvent } from '../telemetry';
import { getThumb } from '../../utils/thumbnail';

// ── Play / navigate ───────────────────────────────────────────────────────

export type PlaySource =
  | 'feed' | 'queue' | 'search' | 'artist' | 'vibe' | 'moment'
  | 'oyo-pick' | 'previous' | 'history' | 'library' | 'auto' | 'unknown';

/**
 * The canonical "play this track" action. Every click that results in
 * audio starting goes through here — feed cards, queue taps, search
 * results, artist page, moments, roulette, whatever.
 *
 * Side effects (in this order):
 *   1. playerStore.setCurrentTrack + setIsPlaying(true)   — UI flips to playing
 *   2. ensureTrackReady at priority=10                    — lanes jump on it
 *   3. oyo.onPlay(track) signal fanout                    — taste graph update
 *   4. telemetry play_start with source                   — conversion tracking
 *
 * AudioPlayer's track-change useEffect then runs the R2-first probe +
 * iframe fallback + hot-swap orchestration. No other code paths needed.
 */
export function playTrack(track: Track, source: PlaySource = 'unknown'): void {
  const store = usePlayerStore.getState();
  store.setCurrentTrack(track);
  store.setIsPlaying(true);
  void ensureTrackReady(track, null, { priority: 10 });
  // Signal fanout (oyo.onPlay) + play_start telemetry fire from
  // AudioPlayer's track-change effect — the canonical boundary that
  // knows the real source ('r2' vs 'iframe'). Previously we fired both
  // here AND in AudioPlayer → 2x fanout + 2x telemetry rows per click.
  // Only the ui_source hint is logged here so we can attribute the
  // click surface; the play_start proper fires once, from AudioPlayer.
  logPlaybackEvent({
    event_type: 'trace',
    track_id: track.trackId,
    meta: { subtype: 'play_intent', ui_source: source },
  });
}

export function addToQueue(track: Track, position?: number): void {
  const store = usePlayerStore.getState();
  if (typeof store.addToQueue === 'function') {
    if (position !== undefined) {
      // Some implementations accept a second arg; fall back if not.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (store.addToQueue as any)(track, position);
    } else {
      store.addToQueue(track);
    }
  }
  // Low-priority prefetch so when they pop it off the queue it's already warm.
  void prefetch([track], 7);
}

export function playFromVibe(vibeId: string): void {
  const pool = useTrackPoolStore.getState().hotPool;
  const matches = pool
    .filter(t => t.detectedMode === vibeId)
    .sort((a, b) => b.poolScore - a.poolScore)
    .slice(0, 10);
  if (matches.length === 0) return;
  playTrack(matches[0] as Track, 'vibe');
  matches.slice(1).forEach(t => addToQueue(t as Track));
}

// ── Player controls ───────────────────────────────────────────────────────

export function skip(): void {
  // voyoStream.skip delegates to playerStore.nextTrack, which fires the
  // full OYO signal fanout (position-aware skip / complete detection) then
  // advances. Same path every fade-skip and media-key next uses.
  voyoStream.skip();
}

export function prev(): void {
  usePlayerStore.getState().prevTrack();
}

export function togglePlay(): void {
  const s = usePlayerStore.getState();
  s.setIsPlaying(!s.isPlaying);
}

export function pause(): void {
  usePlayerStore.getState().setIsPlaying(false);
}

export function resume(): void {
  usePlayerStore.getState().setIsPlaying(true);
}

// ── Reactions / signals ───────────────────────────────────────────────────

/**
 * User OYÉ'd a track. Fires the full signal graph (djRecordPlay + oyoPlan
 * reaction + recordPoolEngagement + record_signal RPC) AND creates the
 * reaction row — which, crucially, carries the playback position so the
 * reactionStore computes a hotspot for this second of the track.
 *
 * Auto-fills position from playerStore.currentTime when the caller doesn't
 * pass one, so every OYÉ (no matter which UI surface fires it) contributes
 * to hotspots — not just the NowPlaying scrubber.
 */
export function oye(
  track: Track,
  opts: { position?: number; emoji?: string; username?: string } = {},
): void {
  onOye(track);
  // Auto-resolve position from player state when the caller didn't pass one.
  // Only attaches a position when it's non-zero — trackPosition on a
  // just-loaded track (currentTime=0) would compute a hotspot at the
  // intro every time, which isn't what we want.
  const storePos = usePlayerStore.getState().currentTime ?? 0;
  const isCurrent =
    usePlayerStore.getState().currentTrack?.trackId === track.trackId ||
    usePlayerStore.getState().currentTrack?.id === track.id;
  const position = opts.position ?? (isCurrent && storePos > 1 ? storePos : undefined);

  const reactionStore = useReactionStore.getState();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reactionStore as any).createReaction?.({
      username: opts.username ?? 'anonymous',
      trackId: track.id,
      trackTitle: track.title,
      trackArtist: track.artist,
      trackThumbnail: track.coverUrl,
      category: 'afro-heat',
      emoji: opts.emoji ?? '⚡',
      reactionType: 'oye',
      trackPosition: position,
    });
  } catch { /* non-fatal */ }
}

/**
 * OYÉ + boost + like — the "I love this track" combo gesture.
 *
 * Wired to the global double-tap behavior. One intent, three effects:
 *   1. app.oye — moment-reaction signal (hotspot + taste graph)
 *   2. explicitLike=true — persisted preference (shows in Liked filter,
 *      demotes this track's skip-weight in behavior rerank)
 *   3. boost download — cache for offline / lockscreen reliability,
 *      engage EQ profile if not already on
 *
 * Idempotent: tapping again just re-fires the signals (cheap) and the
 * boost download short-circuits if already cached.
 */
export function oyeAndBoost(track: Track): void {
  oye(track);
  try {
    usePreferenceStore.getState().setExplicitLike(track.id, true);
  } catch { /* non-fatal */ }
  try {
    const ds = useDownloadStore.getState();
    void ds.boostTrack(
      track.trackId,
      track.title,
      track.artist,
      track.duration || 0,
      getThumb(track.trackId, 'medium'),
    );
  } catch { /* non-fatal */ }
}

/**
 * User skipped via explicit gesture/button. Same as skip() — exposed as a
 * distinct name for telemetry + UI dispatch clarity.
 */
export function skipAndSignal(): void {
  const cur = usePlayerStore.getState().currentTrack;
  if (cur) {
    const positionSec = usePlayerStore.getState().currentTime ?? 0;
    onSkip(cur, positionSec);
  }
  skip();
}

// ── Navigation ────────────────────────────────────────────────────────────

export function switchTab(tab: VoyoTab): void {
  usePlayerStore.getState().setVoyoTab(tab);
}

export function setOyePrewarm(on: boolean): void {
  usePlayerStore.getState().setOyePrewarm(on);
}

// ── Namespaced export (import pattern: `import { app } from '@/services/oyo/app'`) ──

export const app = {
  // Play / queue
  playTrack,
  playFromVibe,
  addToQueue,
  // Controls
  skip,
  prev,
  togglePlay,
  pause,
  resume,
  // Signals
  oye,
  oyeAndBoost,
  skipAndSignal,
  // Navigation
  switchTab,
  setOyePrewarm,
};

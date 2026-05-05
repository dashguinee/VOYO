/**
 * OYO Intelligence — the smart layer.
 *
 * Public facade over the scattered curation services (oyoPlan, oyoDJ, oyoState,
 * intelligentDJ, poolCurator, databaseDiscovery). Player code talks ONLY to this
 * module; internal taste/curation implementation is free to evolve without
 * touching AudioPlayer/voyoStream.
 *
 * Contract:
 *   Signals in  →  oyo.onPlay/onSkip/onComplete
 *   Tracks out  →  oyo.getHot / getDiscovery / getNextTrack  (always R2-gated)
 *   Prefetch    →  oyo.prefetch(tracks[])  — writes to voyo_upload_queue
 *                  at priority=5 so lanes extract the predicted taste
 *
 * Everything that leaves this module is R2-cached, so the UI is guaranteed
 * instant-playable.
 */

import type { Track } from '../../types';
import { getHotTracks, getDiscoveryTracks } from '../databaseDiscovery';
import { onSignal as oyoPlanSignal } from '../oyoPlan';
import { onTrackPlay as oyoDJOnTrackPlay, onTrackSkip as oyoDJOnTrackSkip } from '../oyoDJ';
import { recordPlay as djRecordPlay } from '../intelligentDJ';
import {
  recordPlay as patternRecordPlay,
  recordSkip as patternRecordSkip,
  recordComplete as patternRecordComplete,
  recordReaction as patternRecordReaction,
} from '../../oyo/pattern';
import {
  loadConsciousness,
  saveConsciousness,
  recordSkippedArtist,
} from '../../oyo/consciousness';
import { recordTrackInSession } from '../poolCurator';
import { recordPoolEngagement } from '../personalization';
import { gateToR2 } from '../r2Gate';
import * as pools from './pools';
import { updateEngagement, getNextMove, conductorFetch, resetDJ, getSession } from './dj';
import type { UserState, DJMove } from './dj';
import { getVibeEssence, type VibeEssence } from '../essenceEngine';
import {
  generateAnnouncement, _emitAnnouncement, resetAnnounceRotation,
  type VibeIntent, type DJAnnouncement, type TrackContext,
} from './djAnnounce';
export { usePools } from './usePools';
export { app, type PlaySource } from './app';
export type { VibeIntent, DJAnnouncement } from './djAnnounce';
export { onAnnouncement } from './djAnnounce';
export {
  getNextMove, conductorFetch, initDJ, updateEngagement, getSession, resetDJ,
  maybeFetchTrends,
  type DJMove, type DJMoveType, type Engagement, type UserState, type DJSessionState,
} from './dj';

// Supabase record_signal RPC cooldown — if it returns 401 or 42501 (RLS
// denied), we stop retrying to avoid flooding console with errors.
let _rpcSignalBlocked = false;

// Pool-refresh throttle. refreshPools() drops the 60s hot/discovery cache
// → next shelf render re-ranks. Firing it on every play (user clicks 4
// tracks/min → cache rebuilds every 15s) defeats the TTL. Debounce to
// once per REFRESH_POOLS_COOLDOWN_MS so the session adapts meaningfully
// (3-5 engagements worth) without thrashing the pool compute.
const REFRESH_POOLS_COOLDOWN_MS = 30_000;
let _lastRefreshAt = 0;
function maybeRefreshPools(): void {
  const now = Date.now();
  if (now - _lastRefreshAt < REFRESH_POOLS_COOLDOWN_MS) return;
  _lastRefreshAt = now;
  pools.refreshPools();
}
// Batch record_signal RPCs. Previously 3 roundtrips per track lifecycle
// (play/skip/complete + optional oye). On a typical 3-track/min session
// that's 9+ RPCs/min = main-thread jitter + battery cost over time.
// Queue and flush once per SIGNAL_FLUSH_MS, or on page unload so nothing
// is lost. Keeps the taste-graph write cadence but kills the chatter.
const SIGNAL_FLUSH_MS = 10_000;
type SignalAction = 'play' | 'skip' | 'complete' | 'react';
interface QueuedSignal { track_id: string; action: SignalAction; at: number }
let _signalQueue: QueuedSignal[] = [];
let _signalFlushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushSignals(): Promise<void> {
  if (_rpcSignalBlocked || _signalQueue.length === 0) {
    _signalFlushTimer = null;
    return;
  }
  const batch = _signalQueue;
  _signalQueue = [];
  _signalFlushTimer = null;
  try {
    const { supabase } = await import('../../lib/supabase');
    // record_signal RPC accepts a single row. Fire them in parallel — one
    // RTT per row but they share the HTTP/2 connection, no new handshakes.
    // If the server adds a batched variant later, swap this to one call.
    const results = await Promise.all(
      batch.map(s =>
        supabase?.rpc('record_signal', { p_youtube_id: s.track_id, p_action: s.action })
      ),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of results) {
      const err = (r as any)?.error;
      if (err && (err.status === 401 || err.code === '42501')) {
        _rpcSignalBlocked = true;
        break;
      }
    }
  } catch { /* non-fatal; local learning keeps going */ }
}

function recordRemoteSignal(trackId: string, action: SignalAction): void {
  if (_rpcSignalBlocked) return;
  _signalQueue.push({ track_id: trackId, action, at: Date.now() });
  if (_signalFlushTimer == null) {
    _signalFlushTimer = setTimeout(() => { void flushSignals(); }, SIGNAL_FLUSH_MS);
  }
}

// ── Background / foreground lifecycle ────────────────────────────────────
//
// On hide  : flush pending signals so nothing is lost when the tab closes.
// On show  : if backgrounded > ARC_STALE_MS, the time-of-day arc has likely
//            changed (e.g. afternoon→evening). Reset the DJ session so the
//            next track uses the correct arc, and purge the stale conductor
//            queue (tracks were pre-selected for the OLD arc).
// Refill   : fires freely in FG. In BG, conductorFetch calls the full-DB
//            RPC (2min TTL cache) — one fetch warms the pool for many tracks.

const ARC_STALE_MS = 20 * 60 * 1000; // 20 min

type BgWindow = { __voyoSignalFlushBound?: boolean };
let _backgroundedAt: number | null = null;

if (typeof window !== 'undefined' && !(window as unknown as BgWindow).__voyoSignalFlushBound) {
  (window as unknown as BgWindow).__voyoSignalFlushBound = true;

  window.addEventListener('pagehide', () => { void flushSignals(); });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      _backgroundedAt = Date.now();
      void flushSignals();
    } else {
      // Foreground resume
      const bgDuration = _backgroundedAt ? Date.now() - _backgroundedAt : 0;
      _backgroundedAt = null;

      if (bgDuration > ARC_STALE_MS) {
        // Arc is stale — new time of day, reset conductor so the next track
        // picks up a fresh arc (getNextMove() calls initDJ on null session).
        resetDJ();
        resetAnnounceRotation();
        _conductorQueue = [];
        _vibeOverride = null;
        _recentActions.length = 0;
        // Eager refill — don't wait for the first drain call. Queue is ready
        // before the user's first skip after a long BG session.
        void _refillConductorQueue(new Set());
      }
    }
  });
}

// ── DJ UserState tracker (rolling window of last 5 interactions) ─────────

const WINDOW = 5; // last N interactions
const _recentActions: Array<'skip' | 'complete' | 'react'> = [];
const _favoriteArtists: Map<string, number> = new Map(); // artist → OYÉ count
const _recentGenres: string[] = [];
const _recentCulturalTags: string[] = [];

function _pushAction(action: 'skip' | 'complete' | 'react'): void {
  _recentActions.push(action);
  if (_recentActions.length > WINDOW) _recentActions.shift();
}

function _pushTrackContext(track: Track): void {
  if (track.tags?.length) {
    // tags[0] is primary_genre — push to genre window for bridge context
    const genre = track.tags[0];
    if (genre) {
      _recentGenres.push(genre);
      if (_recentGenres.length > 10) _recentGenres.splice(0, _recentGenres.length - 10);
    }
    // tags[1+] are cultural/geographic tags — push to cultural window for getCulturalIntro
    const culturalSlice = track.tags.slice(1, 3);
    if (culturalSlice.length) {
      _recentCulturalTags.push(...culturalSlice);
      if (_recentCulturalTags.length > 12) _recentCulturalTags.splice(0, _recentCulturalTags.length - 12);
    }
  }
}

function _buildUserState(): UserState {
  const recentSkips = _recentActions.filter(a => a === 'skip').length;
  const recentCompletes = _recentActions.filter(a => a === 'complete').length;
  const recentReactions = _recentActions.filter(a => a === 'react').length;
  return {
    recentSkips,
    recentCompletes,
    recentReactions,
    favoriteArtists: [..._favoriteArtists.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([a]) => a),
    recentGenres: [...new Set(_recentGenres)].slice(0, 5),
    recentCulturalTags: [...new Set(_recentCulturalTags)].slice(0, 6),
  };
}

/** Current DJ UserState — use to call getNextMove(). */
export function getDJUserState(): UserState {
  return _buildUserState();
}

// ── Signals in ────────────────────────────────────────────────────────────

/**
 * A track started playing (user click or auto-advance). Fans out to all
 * taste-tracking modules so OYO's future suggestions are informed.
 */
export function onPlay(track: Track): void {
  _pushTrackContext(track);
  oyoDJOnTrackPlay(track);
  djRecordPlay(track);
  recordTrackInSession(track);
  recordPoolEngagement(track.trackId, 'play');
  void patternRecordPlay({ trackId: track.trackId, artist: track.artist, genre: track.tags[0] });
  // Throttled pool re-rank. Session still adapts, but not 4x/minute.
  maybeRefreshPools();
}

/**
 * User (or the fade-skip safety net) skipped a track before it completed.
 *
 * Fans out to:
 *   • intelligentDJ — recordPlay(skipped=true) for learning
 *   • oyoPlan — the "skip" signal for OYO's pool reshuffling
 *   • oyoDJ — onTrackSkip builds dislikedArtists over time (uses position)
 *   • personalization — recordPoolEngagement for pool-score demotion
 *   • video_intelligence.record_signal RPC — global recommender learning
 */
export function onSkip(track: Track, positionSec: number = 0): void {
  _pushAction('skip');
  updateEngagement(_buildUserState());
  djRecordPlay(track, false, true);
  oyoPlanSignal('skip', track.trackId);
  oyoDJOnTrackSkip(track, positionSec);
  recordPoolEngagement(track.trackId, 'skip');
  void patternRecordSkip({ trackId: track.trackId, artist: track.artist, genre: track.tags[0] });
  void recordRemoteSignal(track.trackId, 'skip');
  if (track.artist) {
    const c = loadConsciousness();
    saveConsciousness(recordSkippedArtist(c, track.artist));
  }
}

/**
 * Track played to natural completion. Strongest positive signal.
 *
 * Fans out to:
 *   • intelligentDJ — recordPlay(skipped=false)
 *   • oyoPlan — the "completion" signal
 *   • personalization — recordPoolEngagement with completionRate meta
 *   • video_intelligence.record_signal RPC
 */
export function onComplete(track: Track, completionRate: number = 100): void {
  _pushAction('complete');
  updateEngagement(_buildUserState());
  djRecordPlay(track, false, false);
  oyoPlanSignal('completion', track.trackId);
  recordPoolEngagement(track.trackId, 'complete', { completionRate });
  void patternRecordComplete({ trackId: track.trackId, artist: track.artist, genre: track.tags[0] });
  void recordRemoteSignal(track.trackId, 'complete');
}

/**
 * User explicitly OYÉ'd (hearted). Strongest possible positive.
 */
export function onOye(track: Track): void {
  _pushAction('react');
  _favoriteArtists.set(track.artist, (_favoriteArtists.get(track.artist) || 0) + 1);
  updateEngagement(_buildUserState());
  djRecordPlay(track, true, false);
  oyoPlanSignal('reaction', track.trackId);
  recordPoolEngagement(track.trackId, 'react');
  void recordRemoteSignal(track.trackId, 'react');
  void patternRecordReaction({ trackId: track.trackId, artist: track.artist, genre: track.tags[0] });
}

// ── Tracks out (always R2-gated) ──────────────────────────────────────────

/**
 * Hot tracks the user is likely to enjoy right now, R2-cached only.
 * Uncached candidates get pushed to the queue so they're ready next refresh.
 */
export async function getHot(limit: number = 30): Promise<Track[]> {
  const raw = await getHotTracks(limit * 2);     // over-fetch to survive gate
  const gated = await gateToR2(raw, { prefetchPriority: 5, sessionTag: 'oyo-hot' });
  return gated.slice(0, limit);
}

/**
 * Discovery tracks (expand horizons), R2-cached only.
 */
export async function getDiscovery(limit: number = 30): Promise<Track[]> {
  const raw = await getDiscoveryTracks(limit * 2);
  const gated = await gateToR2(raw, { prefetchPriority: 5, sessionTag: 'oyo-discovery' });
  return gated.slice(0, limit);
}

// ── Prefetch ───────────────────────────────────────────────────────────────
// Disabled: uncontrolled prefetch burns YT signals. Workers only fire on user
// clicks (p=10 via ensureTrackReady). Mass-populating R2 is a separate flow.
// Keep stub for source-compat with existing callers.

export async function prefetch(_tracks: Track[], _priority: number = 5): Promise<void> {
  return;
}

// ── Conductor pre-queue ───────────────────────────────────────────────────
//
// nextTrack() in playerStore is synchronous. conductorFetch() is async.
// Bridge: maintain a small pre-fetched queue of conductor-selected tracks.
// nextTrack drains it synchronously; when it runs low we refill in the bg.
// drainConductorQueue() and peekConductorQueue() filter stale entries live.
//
// MixBoard bias: on every refill we read getVibeEssence() and nudge the
// move's energyTarget toward the user's explicit MixBoard intent. The arc
// provides cultural intelligence; MixBoard provides explicit mood intent.
// 50/50 blend keeps both respected.
//
// Refill is not gated on visibility — conductorFetch reads in-memory pool.

// Parallel announcement queue — each slot matches the _conductorQueue slot.
// Only the first track of each refill batch carries the announcement.
interface ConductorEntry { track: Track; announcement: DJAnnouncement | null }
let _conductorQueue: ConductorEntry[] = [];
let _conductorRefilling = false;

// Vibe steering — user taps a choice → override applied to the next refill
let _vibeOverride: VibeIntent | null = null;

function _applyVibeOverride(move: DJMove, intent: VibeIntent): void {
  if (intent === 'boost_energy')   move.energyTarget = Math.min(move.energyRange[1], move.energyTarget + 1);
  if (intent === 'drop_energy')    move.energyTarget = Math.max(move.energyRange[0], move.energyTarget - 1);
  if (intent === 'pivot_culture')  move.type = 'bridge';
  if (intent === 'surface_hits') { move.hotRatio = 1.0; move.canonDepth = 'surface'; }
  if (intent === 'go_deep')      { move.hotRatio = 0.0; move.canonDepth = 'deep'; }
  // keep_energy + stay_culture → no structural change, just consume the override
}

/**
 * User tapped a vibe choice. Applies to the NEXT conductor refill.
 * Purges the current queue so the override takes effect immediately.
 */
export function steerVibe(intent: VibeIntent): void {
  _vibeOverride = intent;
  _conductorQueue = []; // stale queue was built for the old direction
  void _refillConductorQueue(new Set());
}

function _blendMixBoardEnergy(move: ReturnType<typeof getNextMove>, essence: VibeEssence): void {
  // Compute a weighted "intent energy" (1–5) from MixBoard vibe weights.
  // Weights are 0–1 proportions; normalize before weighting.
  const total = essence.afro_heat + essence.chill + essence.party + essence.workout + essence.late_night;
  if (total <= 0) return;
  const n = 1 / total;
  const intentEnergy = Math.round(
    (essence.afro_heat * 5 + essence.chill * 1.5 + essence.party * 5 + essence.workout * 4 + essence.late_night * 2.5) * n,
  );
  // 50/50 blend: arc phase sets the cultural narrative, MixBoard steers energy.
  const blended = Math.round((move.energyTarget + intentEnergy) / 2);
  move.energyTarget = Math.min(move.energyRange[1], Math.max(move.energyRange[0], blended));
}

async function _refillConductorQueue(excludeIds: Set<string>): Promise<void> {
  if (_conductorRefilling) return;
  _conductorRefilling = true;
  try {
    const userState = _buildUserState();
    const move = getNextMove(userState);

    // Apply user's vibe steering if present — consume after one refill
    if (_vibeOverride) {
      _applyVibeOverride(move, _vibeOverride);
      _vibeOverride = null;
    }

    // Blend MixBoard intent into the energy axis (Gap 2 fix)
    try {
      const essence = getVibeEssence();
      _blendMixBoardEnergy(move, essence);
    } catch { /* non-fatal — arc defaults hold */ }

    // Capture raw metadata from the first candidate for context-aware announcements.
    // Called synchronously inside conductorFetch before rawEntryToTrack conversion.
    let firstRawCtx: TrackContext | undefined;
    const candidates = await conductorFetch(move, excludeIds, 8, (raw) => {
      firstRawCtx = {
        artist:       raw.artist,
        genre:        raw.primary_genre,
        culturalTags: raw.cultural_tags,
        artistTier:   raw.artist_tier,
        heatScore:    raw.heat_score,
        vibeAfroHeat: raw.vibe_afro_heat,
        vibeParty:    raw.vibe_party_mode,
        vibeLatenight:raw.vibe_late_night,
        vibeChill:    raw.vibe_chill_vibes,
      };
    });
    const existing = new Set(_conductorQueue.map(e => e.track.trackId || e.track.id));

    // Previous dominant genre (most frequent in recent 10-track window)
    const prevGenre = _recentGenres.length > 0
      ? [..._recentGenres].reverse().find(g => g !== firstRawCtx?.genre) ?? null
      : null;

    // Generate one announcement for the first new track in this batch.
    // Only bridge/echo/phase-advance always get one; flow tracks use probability.
    const ann = generateAnnouncement(move, userState.recentCulturalTags, firstRawCtx, prevGenre);
    let firstSlot = true;

    for (const t of candidates) {
      if (!existing.has(t.trackId || t.id)) {
        _conductorQueue.push({ track: t, announcement: firstSlot ? ann : null });
        firstSlot = false;
      }
    }
  } finally {
    _conductorRefilling = false;
  }
}

function _filterQueue(excludeIds: Set<string>): void {
  _conductorQueue = _conductorQueue.filter(
    e => !excludeIds.has(e.track.trackId) && !excludeIds.has(e.track.id),
  );
}

/**
 * Pull the next conductor-selected track. Returns null if empty.
 * Emits the DJ announcement for this slot if one was generated.
 * Triggers a background refill when the queue drops below 3.
 */
export function drainConductorQueue(excludeIds: Set<string>): Track | null {
  _filterQueue(excludeIds);
  const entry = _conductorQueue.shift() ?? null;
  if (!entry) {
    if (_conductorQueue.length < 3) void _refillConductorQueue(excludeIds);
    return null;
  }
  // Emit the announcement so the OYO DJ bar can pick it up
  if (entry.announcement) _emitAnnouncement(entry.announcement);
  if (_conductorQueue.length < 3) void _refillConductorQueue(excludeIds);
  return entry.track;
}

/**
 * Peek at the next conductor track WITHOUT removing it from the queue.
 * Used by predictNextTrack() so preloading matches what nextTrack() will pick.
 */
export function peekConductorQueue(excludeIds: Set<string>): Track | null {
  _filterQueue(excludeIds);
  return _conductorQueue[0]?.track ?? null;
}

/**
 * Called when a track is set directly (rapid-skip pivot, roulette, etc.)
 * bypassing nextTrack(). Purges the stale conductor queue — those picks
 * were built for the old direction — and triggers a fresh refill aligned
 * to the new context. Also records the track's tags so the DJ knows
 * what's playing even through a manual override.
 */
export function notifyManualPick(track: Track): void {
  _conductorQueue = [];
  _pushTrackContext(track);
  void _refillConductorQueue(new Set<string>());
}

// ── Namespaced default export ─────────────────────────────────────────────

export const oyo = {
  // Signals in
  onPlay, onSkip, onComplete, onOye,
  // Tracks out — legacy single-row getters (still used by some surfaces)
  getHot, getDiscovery,
  // Two-stream model (new, preferred): HomeFeed rows are filter chains on these
  pools: {
    hot:         pools.hot,
    discovery:   pools.discovery,
    refresh:     pools.refreshPools,
    byTag:             pools.byTag,
    byArtist:          pools.byArtist,
    byFavoriteArtists: pools.byFavoriteArtists,
    recentlyPlayed:    pools.recentlyPlayed,
    excludeIds:        pools.excludeIds,
    newest:            pools.newest,
    topN:              pools.topN,
  },
  // DJ conductor
  dj: {
    getUserState:    getDJUserState,
    getNextMove,
    conductorFetch,
    drainConductorQueue,
    peekConductorQueue,
    notifyManualPick,
    getSession,
    resetDJ,
    steerVibe,
  },
  prefetch,
};

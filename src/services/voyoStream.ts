/**
 * voyoStream — singleton service that owns the VPS streaming session.
 *
 * ONE session, ONE stream. The browser plays what the VPS says.
 *
 * API surface:
 *   voyoStream.bindAudio(el)              — call once on mount
 *   voyoStream.startSession(track, queue) — user-initiated play
 *   voyoStream.skip()                     — skip current track (POST)
 *   voyoStream.addToQueue(tracks)         — feed more tracks (POST)
 *   voyoStream.pause() / resume()         — pause/resume audio element
 *   voyoStream.getPosition()              — elapsed seconds in current track
 *   voyoStream.sessionId                  — current session ID (null if none)
 *   voyoStream.currentTrackId             — what VPS says is playing
 *   voyoStream.currentDuration            — current track duration (s)
 *   voyoStream.trackStartAudioTime        — audio.currentTime at track start
 */

import type { Track } from '../types';
import { usePlayerStore } from '../store/playerStore';
import { devLog, devWarn } from '../utils/logger';
import { getPoolAwareHotTracks } from './personalization';
import { logPlaybackEvent } from './telemetry';
import { getThumb } from '../utils/thumbnail';
import {
  recordTrackPlayed,
  loadOyoState,
  saveDeck,
  evolveDeck,
  handleRapidSkip,
} from './oyoState';
import { onSignal as oyoPlanSignal } from './oyoPlan';

const VPS = 'https://stream.zionsynapse.online:8444';

/**
 * Upsert a search-miss trackId into voyo_upload_queue — this is the PRIMARY
 * path now that deno + yt-dlp-ejs are wired into the GH Actions workflow.
 * Workers drain the queue and upload to R2 within ~10-60s (100% success on
 * live videos at time of verification 2026-04-19).
 *
 * Webshare stays as the fallback: searchInject waits up to SEARCH_WAIT_MS
 * for R2 to populate; if it doesn't, the VPS priorityInject path kicks in
 * and Webshare extracts like before. Worst case = today's behaviour. Best
 * case = zero Webshare usage for search cold misses.
 */
/**
 * Upsert a row for this track into voyo_upload_queue so workers extract it to R2.
 *
 * `priority` bumps the row to the front of the claim queue. Use 10+ for user
 * clicks (explicit intent — they're waiting). 0 = background/predictive warm.
 */
async function queueUpsertForPreWarm(
  track: Track,
  sessionId: string | null,
  priority: number = 0,
): Promise<void> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/voyo_upload_queue`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      youtube_id:           track.trackId,
      title:                track.title ?? null,
      artist:               track.artist ?? null,
      requested_by_session: sessionId,
      priority,
    }),
  }).catch(() => {});
}

const R2_POLL_INTERVAL_MS = 2000;
const SEARCH_WAIT_MS      = 30_000;  // 30s ceiling — most tracks land in ≤15s
const R2_EDGE             = 'https://voyo-edge.dash-webtv.workers.dev/audio';

/**
 * "No music deserves to be aborted brutally" — the unified handoff pattern.
 *
 * Before any track plays through the VPS session, make sure R2 has it (or
 * accept the fallback after a bounded wait). Upserts to voyo_upload_queue
 * (GH Actions primary path) and polls R2 via HEAD. Callers can then invoke
 * the normal VPS priorityInject/startSession with confidence that either:
 *   - R2 hit → VPS serves from cache instantly, zero Webshare
 *   - Queue row went 'failed' → abort wait early, VPS fallback (Webshare)
 *   - Wait ran its course → VPS priorityInject extracts via Webshare
 *
 * Applied globally (priorityInject + startSession's first track) so every
 * track entry respects flow over interruption.
 */
async function ensureTrackReady(
  track: Track,
  sessionId: string | null,
  opts: { priority?: number } = {},
): Promise<void> {
  // Fire queue upsert (primary free path) — non-blocking, fire-and-forget.
  // Priority 10 = user click (they're waiting). Default 0 = background warm.
  queueUpsertForPreWarm(track, sessionId, opts.priority ?? 0).catch(() => {});

  // Probe R2 — if already cached, skip the wait entirely.
  try {
    const res = await fetch(`${R2_EDGE}/${track.trackId}?q=high`, { method: 'HEAD' });
    if (res.ok) return;
  } catch { /* offline probe, fall through to wait */ }

  // Wait up to SEARCH_WAIT_MS, polling BOTH R2 (success) AND the queue row
  // (early abort on failed). Current audio keeps playing during this time.
  const supaUrl  = import.meta.env.VITE_SUPABASE_URL;
  const supaKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const start = Date.now();
  while (Date.now() - start < SEARCH_WAIT_MS) {
    // 1. R2 HEAD — the win condition
    try {
      const res = await fetch(`${R2_EDGE}/${track.trackId}?q=high`, { method: 'HEAD' });
      if (res.ok) return;
    } catch { /* transient, continue */ }

    // 2. Queue row status — if GH Actions gave up, abort immediately so VPS
    //    fallback kicks in without wasting the rest of the budget.
    if (supaUrl && supaKey) {
      try {
        const r = await fetch(
          `${supaUrl}/rest/v1/voyo_upload_queue?select=status,failure_count&youtube_id=eq.${track.trackId}&limit=1`,
          { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } }
        );
        if (r.ok) {
          const rows = await r.json() as Array<{ status: string; failure_count: number }>;
          if (rows[0]?.status === 'failed' || (rows[0]?.failure_count ?? 0) >= 3) return;
        }
      } catch { /* transient, continue */ }
    }

    await new Promise(res => setTimeout(res, R2_POLL_INTERVAL_MS));
  }
}

function toQueueItem(t: Track) {
  return {
    trackId:  t.trackId,
    title:    t.title   ?? '',
    artist:   t.artist  ?? '',
    duration: t.duration ?? undefined,
  };
}

class VoyoStreamService {
  sessionId:           string | null = null;
  currentTrackId:      string | null = null;
  currentDuration:     number = 0;
  trackStartAudioTime: number = 0;
  /** True while a skip POST is in flight — prevents AudioPlayer from starting a new session */
  isSkipping:          boolean = false;
  streamUrl:           string | null = null;
  /** AudioPlayer registers this to set up WebAudio chain before VPS stream starts */
  onBeforeStreamStart: (() => void) | null = null;
  /** AudioPlayer registers this to do a gain fade when search injects mid-session */
  onSoftFade:          ((durationMs: number) => void) | null = null;
  /** Set true just before an intentional pause — lets handlePause skip stall-recovery */
  intentionalPause:    boolean = false;
  /** AudioPlayer registers this to trigger mood-shift UI on rapid skip bursts */
  onRapidSkip:         (() => void) | null = null;

  private isCreatingSession:    boolean = false;
  private lastSessionCreatedAt: number = 0;

  private recentSkipTimes:   number[] = [];
  private sessionSkippedIds: string[] = [];
  private audioEl:         HTMLAudioElement | null = null;
  private eventSource:     EventSource | null = null;
  private trackMap:        Map<string, Track> = new Map();
  private skipStuckTimer:  ReturnType<typeof setTimeout> | null = null;
  private _audioRestarted: boolean = false;
  /** Track IDs we've already fired ensureTrackReady for — avoid re-warming */
  private prewarmedIds:    Set<string> = new Set();

  // ── Bind audio element ──────────────────────────────────────────────────

  bindAudio(el: HTMLAudioElement) {
    this.audioEl = el;
  }

  // Call before reconnecting the audio element (stream ended, error, BG recovery).
  // audioEl.currentTime resets to ~0 on reconnect, so the trackStartAudioTime
  // baseline must be recaptured on the next now_playing SSE — even if same track.
  markAudioRestarted(): void {
    this._audioRestarted = true;
    this.trackStartAudioTime = 0;
  }

  // ── Start / end session ─────────────────────────────────────────────────

  /**
   * Start a fresh VPS session.
   *
   * opts.force          — bypass the 3s cooldown / in-flight guard. Used by
   *                       AudioPlayer's circuit breaker when rebuilding.
   * opts.skipReadyWait  — don't wait for R2 on the first track. Used by
   *                       paths where the user needs instant response and
   *                       a bounded-Webshare fallback is acceptable:
   *                         - circuit breaker rebuild (force=true)
   *                         - onRapidSkip pivot (user is frustrated)
   *                       Default: wait for R2 like everywhere else, flowing
   *                       the current audio into the new one instead of
   *                       cutting off.
   */
  async startSession(
    firstTrack: Track,
    queue: Track[],
    quality = 'high',
    opts: { force?: boolean; skipReadyWait?: boolean } = {}
  ): Promise<void> {
    if (this.isCreatingSession && !opts.force) {
      devWarn('[VoyoStream] startSession already in progress — ignoring');
      return;
    }
    if (!opts.force && this.lastSessionCreatedAt > 0 && Date.now() - this.lastSessionCreatedAt < 3000) {
      devWarn('[VoyoStream] startSession called too soon after last create — ignoring');
      return;
    }
    this.isCreatingSession = true;
    // keepSrc:true — avoid the Empty-src error window during the fetch POST;
    // audioEl.src gets overwritten with the new streamUrl at line 153.
    this.endSession({ keepSrc: true });
    // Pre-set the expected track so the AudioPlayer guard works during the
    // fetch + SSE-connect window (endSession nulled currentTrackId; without
    // this a re-render arriving before now_playing would pass the guard and
    // spawn a duplicate session).
    this.currentTrackId = firstTrack.trackId;

    const tracks = [firstTrack, ...queue].slice(0, 20);
    this.trackMap = new Map(tracks.map(t => [t.trackId, t]));

    // Globally-applied "flow over interruption" pattern: unless the caller
    // explicitly opted out (circuit breaker rebuild, rapid-skip pivot), wait
    // for R2 on the first track. GH Actions is primary, Webshare fallback.
    if (!opts.skipReadyWait && !opts.force) {
      await ensureTrackReady(firstTrack, null, { priority: 10 });
    }

    // Fire BEFORE the first await — if called from a user gesture this keeps us
    // inside the gesture's synchronous stack, so AudioContext.resume() is allowed.
    // After the await, the gesture activation is gone and resume() gets blocked.
    this.onBeforeStreamStart?.();

    // Pre-warm tracks on VPS before creating the session.
    // VPS isCached() short-circuits for continue-listening tracks (already on disk)
    // so this only triggers R2 downloads for fresh tracks. Fire-and-forget — we
    // don't wait for it; it runs concurrently while session/create is in flight.
    fetch(`${VPS}/voyo/warm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackIds: tracks.map(t => t.trackId), quality }),
    }).catch(() => {});

    let sessionId: string, streamUrl: string, eventsUrl: string;
    try {
      const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData?.platform ?? navigator.platform ?? 'unknown';

      const res = await fetch(`${VPS}/voyo/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue: tracks.map(toQueueItem), quality, platform }),
      });
      if (!res.ok) throw new Error(`VPS ${res.status}`);
      ({ sessionId, streamUrl, eventsUrl } = await res.json());
    } catch (e) {
      this.isCreatingSession = false;
      devWarn('[VoyoStream] session create failed:', e);
      throw e;
    }

    this.sessionId = sessionId;
    this.streamUrl = streamUrl;
    this.lastSessionCreatedAt = Date.now();

    devLog(`[VoyoStream] session ${sessionId.slice(0, 8)} | ${tracks.length} tracks`);

    // Connect SSE first so we don't miss now_playing for the first track
    this.connectEvents(eventsUrl);
    this.isCreatingSession = false;

    if (this.audioEl) {
      this.audioEl.src = streamUrl;
      this.audioEl.load();
      this.audioEl.play().catch(() => {});
    }
  }

  /**
   * Tear down the current session.
   *
   * keepSrc=true — used by startSession() during a session rebuild. The new
   * streamUrl is about to overwrite audioEl.src, so clearing it to '' here
   * only opens a fetch-POST-duration window where the browser fires
   * MEDIA_ELEMENT_ERROR: Empty src attribute (~147 events/day before fix).
   * Default (keepSrc=false) still runs for app unmount / full teardown so
   * the browser releases the stream fetch.
   */
  endSession(opts: { keepSrc?: boolean } = {}) {
    this.isCreatingSession = false;
    this.eventSource?.close();
    this.eventSource = null;
    this.sessionId = null;
    this.currentTrackId = null;
    this.streamUrl = null;
    this.trackMap.clear();
    this.recentSkipTimes = [];
    if (this.skipStuckTimer) { clearTimeout(this.skipStuckTimer); this.skipStuckTimer = null; }
    if (this.audioEl && !opts.keepSrc) {
      this.audioEl.pause();
      this.audioEl.src = '';
    }
    // Keep iframe muted during transitions — prevents double audio on new session start
    usePlayerStore.getState().setPlaybackSource('cached');
  }

  // ── SSE connection ──────────────────────────────────────────────────────

  private connectEvents(eventsUrl: string) {
    this.eventSource?.close();
    this.eventSource = new EventSource(eventsUrl);
    this.eventSource.onmessage = (e) => {
      try { this.handleEvent(JSON.parse(e.data)); } catch {}
    };
    this.eventSource.onerror = () => {
      // Browser retries automatically — no action needed
    };
  }

  private handleEvent(msg: Record<string, unknown>) {
    switch (msg.type) {
      case 'now_playing': {
        const trackId = msg.trackId as string;
        const isTrackChange = trackId !== this.currentTrackId;
        this.currentTrackId = trackId;
        this.currentDuration = (msg.duration as number) ?? 0;
        const wasSkipping = this.isSkipping;
        this.isSkipping = false;
        if (this.skipStuckTimer) { clearTimeout(this.skipStuckTimer); this.skipStuckTimer = null; }

        // Flush browser audio buffer on skip.
        // The VPS has already switched to the next track, but the audio element
        // has several seconds of the old track buffered. Reloading the src flushes
        // the buffer and reconnects to the stream mid-next-track instead of playing
        // through all that stale data. On normal track advance (no skip), leave the
        // element alone — the VPS stream is continuous, no flush needed.
        if (wasSkipping && this.audioEl && this.streamUrl) {
          const src = this.streamUrl;
          this.audioEl.src = src;
          this.audioEl.load();
          this.audioEl.play().catch(() => {});
        }

        // Reset progress baseline on track change, audio restart, or skip flush.
        if (isTrackChange || this._audioRestarted || wasSkipping) {
          this.trackStartAudioTime = this.audioEl?.currentTime ?? 0;
          this._audioRestarted = false;
        }

        devLog(`[VoyoStream] now_playing: ${trackId}`);

        let track = this.trackMap.get(trackId);
        if (!track) {
          track = {
            id: trackId,
            trackId,
            title: 'Now Playing',
            artist: '',
            coverUrl: getThumb(trackId),
            duration: this.currentDuration,
            tags: [],
            oyeScore: 0,
            createdAt: new Date().toISOString(),
          } satisfies Track;
          this.trackMap.set(trackId, track);
        }
        {
          const store = usePlayerStore.getState();
          store.setCurrentTrack(track);
          if (!store.isPlaying) store.setIsPlaying(true);
        }

        // Flip playbackSource AFTER setCurrentTrack so YouTubeIframe stays muted
        // and VOYEX chain activates (was waiting for non-iframe source).
        usePlayerStore.getState().setPlaybackSource('cached');

        // OYO deck management — runs async in background, never blocks playback
        this._oyoTrackPlayed(track);

        // Predictive pre-warm — fire ensureTrackReady for N+1 and N+2 so R2 is
        // hot by the time they're needed. Non-blocking; failures are silent.
        // Cap the warm-ahead depth to avoid flooding the queue if the user is
        // scrolling through long playlists.
        this.prewarmUpcoming(2);
        break;
      }

      case 'queue_needed': {
        const storeQueue = usePlayerStore.getState().queue;
        let nextTracks = storeQueue.slice(0, 8).map(qi => qi.track);

        if (nextTracks.length === 0) {
          const excludeIds = [...this.trackMap.keys()];
          // Read from playerStore.hotTracks — where oyoPlan writes its curated pool.
          // getPoolAwareHotTracks reads useTrackPoolStore (different store), bypassing OYO.
          const { hotTracks, discoverTracks } = usePlayerStore.getState();
          const oyoPool = hotTracks.length > 0 ? hotTracks : discoverTracks;
          const poolTracks = oyoPool.length > 0
            ? oyoPool.filter(t => !excludeIds.includes(t.trackId))
            : getPoolAwareHotTracks(10).filter(t => !excludeIds.includes(t.trackId));
          nextTracks = poolTracks.slice(0, 8);
          devLog(`[VoyoStream] queue empty — auto-filled ${nextTracks.length} tracks from pool`);
          if (nextTracks.length > 0) {
            // Single set() call — forEach addToQueue caused 8 separate re-renders
            usePlayerStore.getState().addTracksToQueue(nextTracks);
          }
        }

        if (nextTracks.length > 0) {
          nextTracks.forEach(t => this.trackMap.set(t.trackId, t));
          this.addToQueue(nextTracks).catch(() => {});
        }
        break;
      }

      case 'track_warming':
        // VPS is waiting for R2 download — track will play shortly, no action needed
        devLog(`[VoyoStream] warming: ${msg.trackId}`);
        break;

      case 'track_failed':
        devWarn('[VoyoStream] track failed:', msg.trackId, msg.error);
        break;

      case 'queue_updated':
        devLog(`[VoyoStream] queue updated: ${msg.queueLength} tracks`);
        break;
    }
  }

  // ── Controls ────────────────────────────────────────────────────────────

  skip(): void {
    if (!this.sessionId) return;
    this.isSkipping = true;

    const now = Date.now();
    this.recentSkipTimes = this.recentSkipTimes.filter(t => now - t < 10_000);
    this.recentSkipTimes.push(now);

    // Track skipped ID for deck evolution signals
    if (this.currentTrackId) this.sessionSkippedIds.push(this.currentTrackId);

    if (this.recentSkipTimes.length >= 3) {
      this.recentSkipTimes = [];
      this.onRapidSkip?.();
    }

    // Safety net: if now_playing SSE doesn't arrive within 12s, clear isSkipping
    if (this.skipStuckTimer) clearTimeout(this.skipStuckTimer);
    this.skipStuckTimer = setTimeout(() => {
      this.skipStuckTimer = null;
      if (this.isSkipping) {
        devWarn('[VoyoStream] isSkipping stuck >12s — clearing');
        this.isSkipping = false;
        logPlaybackEvent({
          event_type: 'skip_stuck',
          track_id: this.currentTrackId ?? 'unknown',
          meta: { session_id: this.sessionId },
        });
      }
    }, 12_000);

    fetch(`${VPS}/voyo/session/${this.sessionId}/skip`, { method: 'POST' }).catch(() => {});
    oyoPlanSignal('skip');
  }

  async addToQueue(tracks: Track[]): Promise<void> {
    if (!this.sessionId) return;
    try {
      await fetch(`${VPS}/voyo/session/${this.sessionId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: tracks.map(toQueueItem) }),
      });
    } catch {}
  }

  /**
   * Jump a track to the front of the session queue. This is the "user
   * requested this specific track now" path — searchInject + rapid-skip
   * pivot both land here.
   *
   * ensureTrackReady runs first to let current audio flow to completion
   * while GH Actions lands the track in R2. The VPS then serves from
   * cache (free) or extracts via Webshare (fallback). Either way the
   * handoff is a gentle cross-fade, never an abrupt cut.
   */
  async priorityInject(track: Track): Promise<void> {
    if (!this.sessionId) {
      return this.startSession(track, []);
    }
    this.trackMap.set(track.trackId, track);

    // "No music deserves to be aborted brutally" — let current track breathe
    // while the next one gets ready. Bounded by SEARCH_WAIT_MS (60s).
    // priority=10 — user just clicked, push this row to the front of the queue.
    await ensureTrackReady(track, this.sessionId, { priority: 10 });

    try {
      await fetch(`${VPS}/voyo/session/${this.sessionId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: [toQueueItem(track)], priority: true }),
      });
    } catch {}
  }

  async searchInject(track: Track): Promise<void> {
    // priorityInject now handles queue upsert + R2 wait internally.
    if (!this.sessionId) {
      return this.startSession(track, []);
    }
    await this.priorityInject(track);
    this.onSoftFade?.(2000);
    setTimeout(() => this.skip(), 2000);
  }

  /**
   * Predictive pre-warm — fire ensureTrackReady on the next N upcoming tracks so
   * R2 has them by the time the current track ends. Non-blocking, silent failures.
   * Skips tracks already pre-warmed this session (prewarmedIds set) to avoid
   * flooding the queue table with duplicate upserts.
   */
  private prewarmUpcoming(depth: number): void {
    const store = usePlayerStore.getState();
    if (!store.oyePrewarm) return;  // bulb off — stay reactive
    const upcoming = store.queue.slice(0, depth).map(qi => qi.track);
    for (const t of upcoming) {
      if (!t?.trackId) continue;
      if (this.prewarmedIds.has(t.trackId)) continue;
      this.prewarmedIds.add(t.trackId);
      // Fire and forget — we don't care when it finishes, we just want R2 warm.
      ensureTrackReady(t, this.sessionId).catch(() => {});
    }
    // Trim set if it grows unbounded (long-running sessions)
    if (this.prewarmedIds.size > 200) {
      this.prewarmedIds = new Set(Array.from(this.prewarmedIds).slice(-100));
    }
  }

  private async _oyoTrackPlayed(track: Track): Promise<void> {
    try {
      // 1. Add this track to the deck (builds the relationship over time)
      const { deck } = await loadOyoState();
      if (!deck.trackIds.includes(track.trackId)) {
        const newDeck = {
          ...deck,
          trackIds: [...deck.trackIds, track.trackId].slice(0, 50),
          metadata: {
            ...deck.metadata,
            [track.trackId]: {
              title: track.title ?? '',
              artist: track.artist ?? '',
              addedAt: Date.now(),
              source: 'oye' as const,
            },
          },
        };
        await saveDeck(newDeck);
      }

      // 2. Vibe check — every 5 songs or 15min, evolve the deck
      if (recordTrackPlayed()) {
        const freshState = await loadOyoState();
        const evolved = await evolveDeck(freshState.deck, {
          oyes: [],
          searches: [],
          skippedIds: this.sessionSkippedIds,
          addedToPlaylist: [],
        });
        await saveDeck(evolved);
        this.sessionSkippedIds = []; // signals consumed
        devLog(`[OYO] Deck evolved → OG${evolved.generation} (${evolved.trackIds.length} tracks)`);
      }
    } catch {
      // Never break playback for OYO state management
    }
  }

  pause(): void {
    this.intentionalPause = true;
    this.audioEl?.pause();
    usePlayerStore.getState().setIsPlaying(false);
  }

  resume(): void {
    this.audioEl?.play().catch(() => {});
    usePlayerStore.getState().setIsPlaying(true);
  }

  // ── Progress ─────────────────────────────────────────────────────────────

  getPosition(): number {
    if (!this.audioEl) return 0;
    return Math.max(0, this.audioEl.currentTime - this.trackStartAudioTime);
  }

  getProgress(): number {
    if (!this.currentDuration) return 0;
    return Math.min(this.getPosition() / this.currentDuration, 1);
  }
}

export const voyoStream = new VoyoStreamService();

/**
 * VOYO Music - Dynamic Track Pool Store
 *
 * INTELLIGENT TRACK MANAGEMENT
 * Instead of static tracks, maintain a living pool that:
 * - Grows from user searches, related tracks, trending
 * - Scores tracks based on intent + behavior
 * - Promotes/demotes based on current vibe (never deletes)
 * - Ages tracks over time (cold storage for stale vibes)
 *
 * POOL STRUCTURE:
 * ┌─────────────────────────────────────────────────────┐
 * │  HOT POOL (active)     │  COLD POOL (aged out)     │
 * │  - High intent match   │  - Low recent activity    │
 * │  - Recently played     │  - Mismatched intent      │
 * │  - User reactions      │  - Recoverable on shift   │
 * └─────────────────────────────────────────────────────┘
 *
 * SCORING FORMULA:
 * trackScore = intentMatch * 0.4 + recency * 0.3 + engagement * 0.3
 *
 * SOURCES:
 * 1. Seed tracks (initial 11)
 * 2. User searches (grows pool)
 * 3. Related tracks (Piped API)
 * 4. Trending (YouTube/backend)
 * 5. LLM suggestions (future: DJ mode)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Track } from '../types';
import { TRACKS } from '../data/tracks';
import { matchTrackToMode, VibeMode } from './intentStore';

// FLYWHEEL: Import Central DJ for cloud signals
import { signals as centralSignals } from '../services/centralDJ';

// DATABASE SYNC: Everything that enters the pool goes to collective brain
import { syncToDatabase } from '../services/databaseSync';

// ============================================
// TYPES
// ============================================

export interface PooledTrack extends Track {
  // Pool metadata
  pooledAt: string;           // When added to pool
  lastPlayedAt?: string;      // Last time played
  lastScoredAt?: string;      // Last time scored

  // Engagement signals
  playCount: number;          // Times played
  completionRate: number;     // Average % listened (0-100)
  reactionCount: number;      // OYÉ reactions received
  queuedCount: number;        // Times added to queue
  skippedCount: number;       // Times skipped

  // Classification
  detectedMode: VibeMode;     // Auto-detected vibe mode
  confidence: number;         // How confident in mode detection (0-1)

  // Pool status
  poolScore: number;          // Current relevance score (0-100)
  isHot: boolean;             // In hot pool (active rotation)
  isCold: boolean;            // In cold pool (aged out)

  // Source tracking
  source: 'seed' | 'search' | 'related' | 'trending' | 'llm' | 'album';
}

interface TrackPoolStore {
  // The pools
  hotPool: PooledTrack[];     // Active rotation (HOT/DISCOVERY pull from here)
  coldPool: PooledTrack[];    // Aged out (recoverable)

  // Pool settings
  maxHotPoolSize: number;     // Max tracks in hot pool
  maxColdPoolSize: number;    // Max tracks in cold pool
  ageOutThreshold: number;    // Days without play before aging out

  // Actions - Adding tracks
  addToPool: (track: Track, source: PooledTrack['source']) => void;
  addManyToPool: (tracks: Track[], source: PooledTrack['source']) => void;

  // Actions - Engagement tracking
  recordPlay: (trackId: string) => void;
  recordCompletion: (trackId: string, completionRate: number) => void;
  recordReaction: (trackId: string) => void;
  recordQueue: (trackId: string) => void;
  recordSkip: (trackId: string) => void;

  // Actions - Pool management
  rescoreAllTracks: () => void;     // Rescore based on current intent
  ageOutStale: () => void;          // Move stale tracks to cold pool
  recoverFromCold: (modeId: VibeMode, count: number) => void; // Bring back matching tracks

  // Getters - For HOT/DISCOVERY engines
  getHotTracks: (limit: number) => PooledTrack[];
  getTracksForMode: (modeId: VibeMode, limit: number) => PooledTrack[];
  getDiscoveryTracks: (currentTrack: Track, limit: number) => PooledTrack[];

  // Stats
  getPoolStats: () => { hot: number; cold: number; total: number };
}

// ============================================
// SCORING HELPERS
// ============================================

function calculatePoolScore(track: PooledTrack, intentWeights: Record<VibeMode, number>): number {
  let score = 0;

  // 1. INTENT MATCH (40%)
  const modeWeight = intentWeights[track.detectedMode] || 0.1;
  score += modeWeight * 40;

  // 2. RECENCY (30%)
  if (track.lastPlayedAt) {
    const daysSincePlay = (Date.now() - new Date(track.lastPlayedAt).getTime()) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 30 - daysSincePlay * 2); // Decays over 15 days
    score += recencyScore;
  } else {
    // Never played - give some score for being new
    const daysSincePooled = (Date.now() - new Date(track.pooledAt).getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 20 - daysSincePooled * 4); // New tracks get boost that decays
  }

  // 3. ENGAGEMENT (30%)
  const engagementScore =
    (track.playCount * 2) +
    (track.completionRate * 0.2) +
    (track.reactionCount * 5) +
    (track.queuedCount * 3) -
    (track.skippedCount * 2);
  score += Math.min(30, Math.max(0, engagementScore));

  return Math.min(100, Math.max(0, score));
}

function detectTrackMode(track: Track): { mode: VibeMode; confidence: number } {
  const result = matchTrackToMode({
    title: track.title,
    artist: track.artist,
    tags: track.tags,
    mood: track.mood,
  });

  // Calculate confidence based on how many keywords matched
  // (simplified - could be more sophisticated)
  const confidence = result === 'random-mixer' ? 0.3 : 0.7;

  return { mode: result, confidence };
}

function createPooledTrack(track: Track, source: PooledTrack['source']): PooledTrack {
  const { mode, confidence } = detectTrackMode(track);

  return {
    ...track,
    pooledAt: new Date().toISOString(),
    playCount: 0,
    completionRate: 0,
    reactionCount: 0,
    queuedCount: 0,
    skippedCount: 0,
    detectedMode: mode,
    confidence,
    poolScore: 50, // Start in middle
    isHot: true,   // New tracks start hot
    isCold: false,
    source,
  };
}

// ============================================
// STORE
// ============================================

export const useTrackPoolStore = create<TrackPoolStore>()(
  persist(
    (set, get) => ({
      // VIBES FIRST: Start empty, populate from 324K database
      // Pool grows organically from user activity and database discovery
      hotPool: [],
      coldPool: [],

      // Settings
      maxHotPoolSize: 100,
      maxColdPoolSize: 200,
      ageOutThreshold: 7, // Days

      // =====================================
      // ADDING TRACKS
      // =====================================

      addToPool: (track, source) => {
        // CONTENT FILTER: Block non-music content (news, podcasts, politics, etc.)
        const NON_MUSIC_KEYWORDS = [
          // News & Politics
          'news', 'live:', 'breaking', 'trump', 'biden', 'president', 'election',
          'politics', 'political', 'congress', 'senate', 'white house', 'capitol',
          'maga', 'democrat', 'republican', 'cnn', 'fox news', 'msnbc',
          // Non-music content
          'warning', 'alert', 'podcast', 'interview', 'speech', 'conference',
          'urgent', 'update:', 'reaction', 'drama', 'beef', 'diss',
          'full movie', 'documentary', 'lecture', 'sermon', 'preaching',
          'asmr', 'meditation guide', 'sleep sounds', 'white noise',
          // Clickbait
          'you wont believe', 'shocking', 'exposed', 'leaked', 'scandal',
        ];
        const combined = `${track.title} ${track.artist || ''}`.toLowerCase();
        if (NON_MUSIC_KEYWORDS.some(kw => combined.includes(kw))) {
          console.log(`[Pool] Blocked non-music: ${track.title}`);
          return; // Don't add non-music to pool
        }

        // DATABASE SYNC: Track entered the pool - sync to collective brain
        syncToDatabase(track).catch(() => {});

        set((state) => {
          // Check if already in pool
          const existsInHot = state.hotPool.some((t) => t.id === track.id || t.trackId === track.trackId);
          const existsInCold = state.coldPool.some((t) => t.id === track.id || t.trackId === track.trackId);

          if (existsInHot || existsInCold) {
            // Already exists - just update last seen
            return state;
          }

          const pooledTrack = createPooledTrack(track, source);

          // Add to hot pool
          let newHotPool = [...state.hotPool, pooledTrack];

          // If hot pool is too big, move lowest scored to cold
          if (newHotPool.length > state.maxHotPoolSize) {
            newHotPool.sort((a, b) => b.poolScore - a.poolScore);
            const overflow = newHotPool.splice(state.maxHotPoolSize);

            const newColdPool = [
              ...state.coldPool,
              ...overflow.map((t) => ({ ...t, isHot: false, isCold: true })),
            ].slice(-state.maxColdPoolSize); // Keep only last N

            return { hotPool: newHotPool, coldPool: newColdPool };
          }

          return { hotPool: newHotPool };
        });
      },

      addManyToPool: (tracks, source) => {
        tracks.forEach((track) => get().addToPool(track, source));
      },

      // =====================================
      // ENGAGEMENT TRACKING
      // =====================================

      recordPlay: (trackId) => {
        set((state) => ({
          hotPool: state.hotPool.map((t) =>
            (t.id === trackId || t.trackId === trackId)
              ? { ...t, playCount: t.playCount + 1, lastPlayedAt: new Date().toISOString() }
              : t
          ),
        }));

        // FLYWHEEL: Send to Central DJ (async, fire-and-forget)
        centralSignals.play(trackId).catch(() => {});
      },

      recordCompletion: (trackId, completionRate) => {
        set((state) => ({
          hotPool: state.hotPool.map((t) =>
            (t.id === trackId || t.trackId === trackId)
              ? {
                  ...t,
                  completionRate: t.playCount > 0
                    ? (t.completionRate * (t.playCount - 1) + completionRate) / t.playCount
                    : completionRate,
                }
              : t
          ),
        }));

        // FLYWHEEL: Record completion to Central DJ (>80% = complete signal)
        if (completionRate >= 80) {
          centralSignals.complete(trackId).catch(() => {});
        }
      },

      recordReaction: (trackId) => {
        set((state) => ({
          hotPool: state.hotPool.map((t) =>
            (t.id === trackId || t.trackId === trackId)
              ? { ...t, reactionCount: t.reactionCount + 1 }
              : t
          ),
        }));

        // FLYWHEEL: Love signal to Central DJ
        centralSignals.love(trackId).catch(() => {});
      },

      recordQueue: (trackId) => {
        set((state) => ({
          hotPool: state.hotPool.map((t) =>
            (t.id === trackId || t.trackId === trackId)
              ? { ...t, queuedCount: t.queuedCount + 1 }
              : t
          ),
        }));

        // FLYWHEEL: Queue signal to Central DJ
        centralSignals.queue(trackId).catch(() => {});
      },

      recordSkip: (trackId) => {
        set((state) => ({
          hotPool: state.hotPool.map((t) =>
            (t.id === trackId || t.trackId === trackId)
              ? { ...t, skippedCount: t.skippedCount + 1 }
              : t
          ),
        }));

        // FLYWHEEL: Skip signal to Central DJ
        centralSignals.skip(trackId).catch(() => {});
      },

      // =====================================
      // POOL MANAGEMENT
      // =====================================

      rescoreAllTracks: () => {
        // Import intent weights dynamically to avoid circular deps
        import('./intentStore').then(({ useIntentStore }) => {
          const intentWeights = useIntentStore.getState().getIntentWeights();

          set((state) => ({
            hotPool: state.hotPool.map((t) => ({
              ...t,
              poolScore: calculatePoolScore(t, intentWeights),
              lastScoredAt: new Date().toISOString(),
            })),
          }));

          // TRIGGER PLAYER REFRESH: After rescoring, update player recommendations
          import('./playerStore').then(({ usePlayerStore }) => {
            usePlayerStore.getState().refreshRecommendations();
            console.log('[VOYO Pool] Rescored all tracks, refreshed recommendations');
          }).catch(() => {});
        });
      },

      ageOutStale: () => {
        set((state) => {
          const threshold = Date.now() - state.ageOutThreshold * 24 * 60 * 60 * 1000;

          const stillHot: PooledTrack[] = [];
          const toAge: PooledTrack[] = [];

          state.hotPool.forEach((t) => {
            const lastActive = t.lastPlayedAt ? new Date(t.lastPlayedAt).getTime() : new Date(t.pooledAt).getTime();

            if (lastActive < threshold && t.poolScore < 30) {
              toAge.push({ ...t, isHot: false, isCold: true });
            } else {
              stillHot.push(t);
            }
          });

          const newColdPool = [...state.coldPool, ...toAge].slice(-state.maxColdPoolSize);

          return { hotPool: stillHot, coldPool: newColdPool };
        });
      },

      recoverFromCold: (modeId, count) => {
        set((state) => {
          // Find matching tracks in cold pool
          const matching = state.coldPool
            .filter((t) => t.detectedMode === modeId)
            .slice(0, count);

          if (matching.length === 0) return state;

          // Move to hot pool
          const matchingIds = new Set(matching.map((t) => t.id));
          const newColdPool = state.coldPool.filter((t) => !matchingIds.has(t.id));
          const recovered = matching.map((t) => ({ ...t, isHot: true, isCold: false, poolScore: 50 }));

          console.log(`[VOYO Pool] Recovered ${recovered.length} tracks from cold pool`);

          return {
            hotPool: [...state.hotPool, ...recovered],
            coldPool: newColdPool,
          };
        });

        // ASYNC: Filter out disliked tracks after recovery (preference-aware refinement)
        import('../store/preferenceStore').then(({ usePreferenceStore }) => {
          const state = get();
          const preferences = usePreferenceStore.getState().trackPreferences;

          // Remove any explicitly disliked tracks from the hot pool
          const filtered = state.hotPool.filter(
            (t) => preferences[t.id]?.explicitLike !== false
          );

          if (filtered.length < state.hotPool.length) {
            const removed = state.hotPool.length - filtered.length;
            console.log(`[VOYO Pool] Removed ${removed} disliked tracks from recovered batch`);

            set({
              hotPool: filtered,
              // Move removed tracks back to cold pool
              coldPool: [
                ...state.coldPool,
                ...state.hotPool.filter((t) => !filtered.includes(t))
              ],
            });
          }
        }).catch(() => {});
      },

      // =====================================
      // GETTERS FOR HOT/DISCOVERY
      // =====================================

      getHotTracks: (limit) => {
        const state = get();
        // Add randomization to prevent same order every time
        return [...state.hotPool]
          .map(t => ({ track: t, score: t.poolScore + Math.random() * 5 }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map(s => s.track);
      },

      getTracksForMode: (modeId, limit) => {
        const state = get();
        return state.hotPool
          .filter((t) => t.detectedMode === modeId)
          .sort((a, b) => b.poolScore - a.poolScore)
          .slice(0, limit);
      },

      getDiscoveryTracks: (currentTrack, limit) => {
        const state = get();
        const currentMode = matchTrackToMode({
          title: currentTrack.title,
          artist: currentTrack.artist,
          tags: currentTrack.tags,
          mood: currentTrack.mood,
        });

        // BUILD EXCLUSION SET: Exclude current track by both id and trackId
        const excludeSet = new Set<string>();
        excludeSet.add(currentTrack.id);
        if (currentTrack.trackId) excludeSet.add(currentTrack.trackId);

        // Prioritize same mode, then similar, then high score
        const scored = state.hotPool
          .filter((t) => {
            // Check both id and trackId for thorough deduplication
            if (excludeSet.has(t.id)) return false;
            if (t.trackId && excludeSet.has(t.trackId)) return false;
            return true;
          })
          .map((t) => {
            let score = t.poolScore;

            // Boost same mode
            if (t.detectedMode === currentMode) score += 20;

            // Boost same artist
            if (t.artist.toLowerCase() === currentTrack.artist.toLowerCase()) score += 30;

            // RANDOMIZATION: Add small jitter to prevent same order every time
            score += Math.random() * 8; // Up to 8 points of randomness for variety

            return { track: t, score };
          })
          .sort((a, b) => b.score - a.score);

        // Apply diversity: Don't return all from same artist
        const result: PooledTrack[] = [];
        const artistCount: Record<string, number> = {};

        for (const { track } of scored) {
          if (result.length >= limit) break;

          const artistLower = track.artist.toLowerCase();
          const count = artistCount[artistLower] || 0;

          // Limit max 2 tracks per artist for variety
          if (count >= 2) continue;

          result.push(track);
          artistCount[artistLower] = count + 1;
        }

        // Fill remaining if needed
        for (const { track } of scored) {
          if (result.length >= limit) break;
          if (!result.some(r => r.id === track.id)) {
            result.push(track);
          }
        }

        return result;
      },

      // =====================================
      // STATS
      // =====================================

      getPoolStats: () => {
        const state = get();
        return {
          hot: state.hotPool.length,
          cold: state.coldPool.length,
          total: state.hotPool.length + state.coldPool.length,
        };
      },
    }),
    {
      name: 'voyo-track-pool',
      version: 1,
    }
  )
);

// ============================================
// AUTO-MAINTENANCE
// ============================================

// Run pool maintenance every 5 minutes when app is active
let maintenanceInterval: ReturnType<typeof setInterval> | null = null;

export function startPoolMaintenance(): void {
  if (maintenanceInterval) return;

  maintenanceInterval = setInterval(() => {
    const store = useTrackPoolStore.getState();
    store.rescoreAllTracks();
    store.ageOutStale();
  }, 5 * 60 * 1000); // 5 minutes

  console.log('[VOYO Track Pool] Maintenance started');
}

export function stopPoolMaintenance(): void {
  if (maintenanceInterval) {
    clearInterval(maintenanceInterval);
    maintenanceInterval = null;
    console.log('[VOYO Track Pool] Maintenance stopped');
  }
}

/**
 * VOYO Central DJ - Collective Intelligence System
 *
 * THE FLYWHEEL:
 * 1. User A vibes → DJ discovers via Gemini → Supabase stores
 * 2. User B (similar vibe) → Gets tracks INSTANTLY from Supabase (no Gemini call!)
 * 3. User B reactions → Update collective scores → System gets smarter
 *
 * After ~100 users, Gemini calls drop 80%+
 * The system learns what WORKS (high completion, low skips)
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Track } from '../types';
import { getThumb } from '../utils/thumbnail';

// ============================================
// TYPES
// ============================================

export interface CentralTrack {
  voyo_id: string;
  youtube_id: string;
  title: string;
  artist: string;
  thumbnail: string | null;
  heat_score: number;
  play_count: number;
  love_count: number;
  skip_rate: number;
  completion_rate: number;
  vibe_afro: number;
  vibe_chill: number;
  vibe_hype: number;
  discovered_by: string;
}

// MixBoard mode types (matches VoyoPortraitPlayer.tsx)
export type MixBoardMode = 'afro-heat' | 'chill-vibes' | 'party-mode' | 'late-night' | 'workout' | 'random-mixer';

export interface VibeProfile {
  'afro-heat': number;    // 0-100
  'chill-vibes': number;  // 0-100
  'party-mode': number;   // 0-100
  'late-night': number;   // 0-100
  'workout': number;      // 0-100
}

// Keywords for auto-detecting vibe from track metadata
const MODE_KEYWORDS: Record<MixBoardMode, string[]> = {
  'afro-heat': ['afrobeat', 'afro', 'lagos', 'naija', 'amapiano', 'burna', 'davido', 'wizkid', 'afrobeats'],
  'chill-vibes': ['chill', 'slow', 'r&b', 'soul', 'acoustic', 'mellow', 'relax', 'smooth', 'rnb'],
  'party-mode': ['party', 'dance', 'club', 'banger', 'hype', 'turn up', 'edm', 'remix'],
  'late-night': ['late', 'night', 'moody', 'dark', 'atmospheric', 'vibe', 'midnight'],
  'workout': ['workout', 'gym', 'run', 'energy', 'pump', 'fitness', 'high tempo', 'intense'],
  'random-mixer': [],
};

export interface SignalData {
  trackId: string;
  action: 'play' | 'love' | 'skip' | 'complete' | 'queue' | 'unlove';
  sessionVibe?: string;
  listenDuration?: number;
  modeId?: MixBoardMode;  // Which MixBoard mode was active/used
}

/**
 * Vibe training signal - when user adds track to a mode
 */
export interface VibeTrainSignal {
  trackId: string;
  modeId: MixBoardMode;
  action: 'boost' | 'queue' | 'reaction';  // How they interacted
  intensity: number;  // 1-3 based on action strength
}

// Anonymous user hash (consistent per device)
let userHash: string | null = null;

/**
 * Get user identifier for signals
 * - If logged in: returns account ID (e.g., "dash-001")
 * - If anonymous: returns device-consistent hash (e.g., "u_abc123...")
 *
 * This allows:
 * - Anonymous usage (no login required)
 * - Account-linked data when logged in (syncs across devices)
 */
function getUserHash(): string {
  // Try to get logged-in account ID first
  try {
    const accountData = localStorage.getItem('voyo-account');
    if (accountData) {
      const parsed = JSON.parse(accountData);
      if (parsed?.account?.id) {
        return parsed.account.id; // Use account ID (e.g., "dash-001")
      }
    }
  } catch {
    // Ignore parse errors
  }

  // Fall back to anonymous device hash
  if (userHash) return userHash;

  // Try to get from localStorage
  const stored = localStorage.getItem('voyo_user_hash');
  if (stored) {
    userHash = stored;
    return stored;
  }

  // Generate new anonymous hash
  const newHash = 'u_' + Math.random().toString(36).substring(2, 15) +
                  Math.random().toString(36).substring(2, 15);
  localStorage.setItem('voyo_user_hash', newHash);
  userHash = newHash;
  return newHash;
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'late_night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/**
 * Auto-detect MixBoard modes from track metadata
 * Returns array of matching mode IDs
 */
export function detectModes(title: string, artist: string): MixBoardMode[] {
  const searchText = `${title} ${artist}`.toLowerCase();
  const matches: MixBoardMode[] = [];

  for (const [mode, keywords] of Object.entries(MODE_KEYWORDS)) {
    if (mode === 'random-mixer') continue;
    for (const keyword of keywords) {
      if (searchText.includes(keyword)) {
        matches.push(mode as MixBoardMode);
        break;
      }
    }
  }

  // Default to afro-heat if no matches (African music focus)
  return matches.length > 0 ? matches : ['afro-heat'];
}

/**
 * Calculate vibe scores from detected modes
 */
export function modesToVibeProfile(modes: MixBoardMode[]): VibeProfile {
  const profile: VibeProfile = {
    'afro-heat': 0,
    'chill-vibes': 0,
    'party-mode': 0,
    'late-night': 0,
    'workout': 0,
  };

  // Each detected mode gets 80 points
  for (const mode of modes) {
    if (mode in profile) {
      profile[mode as keyof VibeProfile] = 80;
    }
  }

  return profile;
}

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get tracks by specific MixBoard mode
 * This is the FAST PATH - no Gemini call needed!
 */
export async function getTracksByMode(
  mode: MixBoardMode,
  limit: number = 20
): Promise<CentralTrack[]> {
  if (!supabase || !isSupabaseConfigured) {
    console.log('[Central DJ] Supabase not configured, skipping');
    return [];
  }

  try {
    const { data, error } = await supabase.rpc('get_tracks_by_mode', {
      p_mode: mode,
      p_limit: limit,
    });

    if (error) {
      console.error('[Central DJ] Query error:', error);
      return [];
    }

    console.log(`[Central DJ] Found ${data?.length || 0} tracks for ${mode}`);
    return data || [];
  } catch (err) {
    console.error('[Central DJ] Error:', err);
    return [];
  }
}

/**
 * Get tracks matching a weighted vibe profile (multiple modes)
 */
export async function getTracksByVibe(
  vibe: VibeProfile,
  limit: number = 20
): Promise<CentralTrack[]> {
  if (!supabase || !isSupabaseConfigured) {
    console.log('[Central DJ] Supabase not configured, skipping');
    return [];
  }

  try {
    const { data, error } = await supabase.rpc('get_tracks_by_vibe', {
      p_afro_heat: vibe['afro-heat'],
      p_chill_vibes: vibe['chill-vibes'],
      p_party_mode: vibe['party-mode'],
      p_late_night: vibe['late-night'],
      p_workout: vibe['workout'],
      p_limit: limit,
    });

    if (error) {
      console.error('[Central DJ] Query error:', error);
      return [];
    }

    console.log(`[Central DJ] Found ${data?.length || 0} tracks matching vibe profile`);
    return data || [];
  } catch (err) {
    console.error('[Central DJ] Error:', err);
    return [];
  }
}

/**
 * Get hot/trending tracks from the collective
 */
export async function getHotTracks(limit: number = 20): Promise<CentralTrack[]> {
  if (!supabase || !isSupabaseConfigured) return [];

  try {
    const { data, error } = await supabase.rpc('get_hot_tracks', {
      p_limit: limit,
    });

    if (error) {
      console.error('[Central DJ] Hot tracks error:', error);
      return [];
    }

    console.log(`[Central DJ] 🔥 Found ${data?.length || 0} hot tracks`);
    return data || [];
  } catch (err) {
    console.error('[Central DJ] Error:', err);
    return [];
  }
}

/**
 * Check if we have enough tracks for a vibe (to decide if we need Gemini)
 */
export async function hasEnoughTracks(
  vibe: VibeProfile,
  minRequired: number = 10
): Promise<boolean> {
  const tracks = await getTracksByVibe(vibe, minRequired);
  return tracks.length >= minRequired;
}

// ============================================
// SAVE FUNCTIONS
// ============================================

/**
 * Save a verified track to the central database
 * Called after Gemini suggests + backend verifies
 * Auto-detects vibes from track metadata if not provided
 */
export async function saveVerifiedTrack(
  track: Track,
  vibe?: VibeProfile,
  discoveredBy: 'gemini' | 'user_search' | 'related' | 'seed' = 'gemini'
): Promise<boolean> {
  if (!supabase || !isSupabaseConfigured) {
    console.log('[Central DJ] Cannot save - Supabase not configured');
    return false;
  }

  try {
    // Extract YouTube ID from trackId if it's a VOYO ID
    let youtubeId = track.trackId;
    if (youtubeId.startsWith('vyo_')) {
      // Decode VOYO ID
      const encoded = youtubeId.substring(4);
      let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4 !== 0) base64 += '=';
      try {
        youtubeId = atob(base64);
      } catch {
        // Keep as is
      }
    }

    // Auto-detect vibes from track metadata if not provided
    const detectedModes = detectModes(track.title, track.artist);
    const vibeProfile = vibe || modesToVibeProfile(detectedModes);

    const { error } = await supabase.from('voyo_tracks').upsert({
      voyo_id: track.trackId,
      youtube_id: youtubeId,
      title: track.title,
      artist: track.artist,
      thumbnail: track.coverUrl || getThumb(youtubeId),
      duration: track.duration || 0,
      tags: track.tags || [],
      language: 'en', // TODO: detect
      region: track.region || 'NG',
      discovered_by: discoveredBy,
      verified: true,
      // MixBoard vibe scores
      vibe_afro_heat: vibeProfile['afro-heat'],
      vibe_chill_vibes: vibeProfile['chill-vibes'],
      vibe_party_mode: vibeProfile['party-mode'],
      vibe_late_night: vibeProfile['late-night'],
      vibe_workout: vibeProfile['workout'],
      // Vibe tags (detected modes)
      vibe_tags: detectedModes,
    }, {
      onConflict: 'voyo_id',
      ignoreDuplicates: false,
    });

    if (error) {
      console.error('[Central DJ] Save error:', error);
      return false;
    }

    console.log(`[Central DJ] ✅ Saved: ${track.artist} - ${track.title} [${detectedModes.join(', ')}]`);
    return true;
  } catch (err) {
    console.error('[Central DJ] Save error:', err);
    return false;
  }
}

/**
 * Batch save multiple tracks
 */
export async function saveVerifiedTracks(
  tracks: Track[],
  vibe: VibeProfile,
  discoveredBy: 'gemini' | 'user_search' | 'related' | 'seed' = 'gemini'
): Promise<number> {
  let saved = 0;
  for (const track of tracks) {
    const success = await saveVerifiedTrack(track, vibe, discoveredBy);
    if (success) saved++;
  }
  return saved;
}

// ============================================
// SIGNAL RECORDING
// ============================================

/**
 * Record a user signal (play, love, skip, complete, queue)
 * This is how the collective learns!
 */
export async function recordSignal(signal: SignalData): Promise<boolean> {
  if (!supabase || !isSupabaseConfigured) {
    console.log('[Central DJ] Cannot record signal - Supabase not configured');
    return false;
  }

  try {
    const { error } = await supabase.from('voyo_signals').insert({
      track_id: signal.trackId,
      user_hash: getUserHash(),
      action: signal.action,
      session_vibe: signal.sessionVibe || null,
      time_of_day: getTimeOfDay(),
      listen_duration: signal.listenDuration || 0,
    });

    if (error) {
      // Might fail if track doesn't exist in central DB yet - that's OK
      if (!error.message.includes('foreign key')) {
        console.error('[Central DJ] Signal error:', error);
      }
      return false;
    }

    console.log(`[Central DJ] 📊 Signal: ${signal.action} on ${signal.trackId.substring(0, 10)}...`);
    return true;
  } catch (err) {
    console.error('[Central DJ] Signal error:', err);
    return false;
  }
}

/**
 * Convenience functions for common signals
 */
export const signals = {
  play: (trackId: string, sessionVibe?: string) =>
    recordSignal({ trackId, action: 'play', sessionVibe }),

  love: (trackId: string) =>
    recordSignal({ trackId, action: 'love' }),

  unlove: (trackId: string) =>
    recordSignal({ trackId, action: 'unlove' }),

  skip: (trackId: string, listenDuration?: number) =>
    recordSignal({ trackId, action: 'skip', listenDuration }),

  complete: (trackId: string) =>
    recordSignal({ trackId, action: 'complete' }),

  queue: (trackId: string, modeId?: MixBoardMode) =>
    recordSignal({ trackId, action: 'queue', modeId }),
};

// ============================================
// VIBE TRAINING (The Flywheel Core!)
// ============================================

/**
 * Train a track's vibe based on user interaction
 *
 * THE FLYWHEEL:
 * - User drags track to "afro-heat" → vibe_afro_heat += 5
 * - User boosts "chill-vibes" while track plays → vibe_chill_vibes += 3
 * - User reacts with OYE on "party-mode" → vibe_party_mode += 2
 *
 * Over time, collective behavior reveals each track's TRUE vibe
 */
export async function trainVibe(signal: VibeTrainSignal): Promise<boolean> {
  if (!supabase || !isSupabaseConfigured) {
    console.log('[Central DJ] Cannot train vibe - Supabase not configured');
    return false;
  }

  // Calculate increment based on action intensity
  // queue = strongest signal (5), boost = medium (3), reaction = light (2)
  const increment = signal.action === 'queue' ? 5 :
                    signal.action === 'boost' ? 3 : 2;

  // Map mode to column name
  const columnMap: Record<MixBoardMode, string> = {
    'afro-heat': 'vibe_afro_heat',
    'chill-vibes': 'vibe_chill_vibes',
    'party-mode': 'vibe_party_mode',
    'late-night': 'vibe_late_night',
    'workout': 'vibe_workout',
    'random-mixer': 'vibe_afro_heat', // Random goes to afro-heat
  };

  const column = columnMap[signal.modeId];

  try {
    // First check if track exists
    const { data: existing } = await supabase
      .from('voyo_tracks')
      .select('voyo_id, vibe_tags')
      .eq('voyo_id', signal.trackId)
      .single();

    if (!existing) {
      // Track doesn't exist in central DB yet - that's OK, will be added later
      console.log(`[Central DJ] Track ${signal.trackId.substring(0, 10)}... not in central DB yet`);
      return false;
    }

    // Update the vibe score (cap at 100)
    const { error } = await supabase.rpc('train_track_vibe', {
      p_track_id: signal.trackId,
      p_mode: signal.modeId,
      p_increment: increment,
    });

    if (error) {
      // RPC doesn't exist yet - log and continue
      // The RPC will be available after running the migration
      console.log('[Central DJ] Vibe training RPC not available yet - run the migration');
      return false;
    }

    console.log(`[Central DJ] 🎯 Trained: ${signal.trackId.substring(0, 10)}... → ${signal.modeId} +${increment}`);
    return true;
  } catch (err) {
    console.error('[Central DJ] Vibe train error:', err);
    return false;
  }
}

/**
 * Convenience: Train vibe when user queues to a mode
 */
export function trainVibeOnQueue(trackId: string, modeId: MixBoardMode): Promise<boolean> {
  return trainVibe({ trackId, modeId, action: 'queue', intensity: 3 });
}

/**
 * Convenience: Train vibe when user boosts a mode
 */
export function trainVibeOnBoost(trackId: string, modeId: MixBoardMode): Promise<boolean> {
  return trainVibe({ trackId, modeId, action: 'boost', intensity: 2 });
}

/**
 * Convenience: Train vibe when user reacts on a mode
 */
export function trainVibeOnReaction(trackId: string, modeId: MixBoardMode): Promise<boolean> {
  return trainVibe({ trackId, modeId, action: 'reaction', intensity: 1 });
}

// ============================================
// CONVERSION HELPERS
// ============================================

/**
 * Convert CentralTrack to VOYO Track format
 */
export function centralToTrack(central: CentralTrack): Track {
  return {
    id: `central_${central.voyo_id}`,
    title: central.title,
    artist: central.artist,
    album: 'VOYO Central',
    trackId: central.voyo_id,
    coverUrl: central.thumbnail || getThumb(central.youtube_id),
    duration: 0,
    tags: ['central', 'verified'],
    mood: central.vibe_chill > 60 ? 'chill' : central.vibe_hype > 60 ? 'hype' : 'afro',
    region: 'NG',
    oyeScore: central.heat_score,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Convert array of CentralTracks to VOYO Tracks
 */
export function centralToTracks(centrals: CentralTrack[]): Track[] {
  return centrals.map(centralToTrack);
}

// ============================================
// STATS & DEBUG
// ============================================

/**
 * Get Central DJ stats
 */
export async function getStats(): Promise<{
  totalTracks: number;
  totalSignals: number;
  hotTracks: number;
} | null> {
  if (!supabase || !isSupabaseConfigured) return null;

  try {
    const [tracksRes, signalsRes, hotRes] = await Promise.all([
      supabase.from('voyo_tracks').select('*', { count: 'exact', head: true }),
      supabase.from('voyo_signals').select('*', { count: 'exact', head: true }),
      supabase.from('voyo_tracks')
        .select('*', { count: 'exact', head: true })
        .gt('heat_score', 10),
    ]);

    return {
      totalTracks: tracksRes.count || 0,
      totalSignals: signalsRes.count || 0,
      hotTracks: hotRes.count || 0,
    };
  } catch {
    return null;
  }
}

// ============================================
// SEED SYNC - Upload local tracks to Supabase (one-time)
// ============================================

const SEED_SYNC_KEY = 'voyo_seed_synced_v1';

/**
 * Sync seed tracks from local TRACKS to Supabase
 * Only runs once per device (stores flag in localStorage)
 */
export async function syncSeedTracks(tracks: Track[]): Promise<number> {
  if (!supabase || !isSupabaseConfigured) {
    console.log('[Central DJ] Supabase not configured, skipping seed sync');
    return 0;
  }

  // Check if already synced
  if (localStorage.getItem(SEED_SYNC_KEY)) {
    console.log('[Central DJ] Seed tracks already synced');
    return 0;
  }

  console.log(`[Central DJ] 🌱 Syncing ${tracks.length} seed tracks to Supabase...`);

  let synced = 0;
  for (const track of tracks) {
    const success = await saveVerifiedTrack(track, undefined, 'seed');
    if (success) synced++;
  }

  // Mark as synced
  localStorage.setItem(SEED_SYNC_KEY, new Date().toISOString());
  console.log(`[Central DJ] ✅ Synced ${synced}/${tracks.length} seed tracks`);

  return synced;
}

// ============================================
// DEBUG HELPERS
// ============================================

if (typeof window !== 'undefined') {
  (window as any).voyoCentral = {
    // Query
    getByMode: getTracksByMode,
    getByVibe: getTracksByVibe,
    getHot: getHotTracks,
    hasEnough: hasEnoughTracks,
    // Save
    save: saveVerifiedTrack,
    // Signals
    signal: signals,
    // Vibe Training (The Flywheel!)
    train: trainVibe,
    trainQueue: trainVibeOnQueue,
    trainBoost: trainVibeOnBoost,
    trainReaction: trainVibeOnReaction,
    // Utils
    detectModes,
    stats: getStats,
    userHash: getUserHash,
  };
  console.log('🎯 [Central DJ] Debug: window.voyoCentral.getByMode("afro-heat") / .train({trackId, modeId, action}) / .stats()');
}

export default {
  // Query
  getTracksByMode,
  getTracksByVibe,
  getHotTracks,
  hasEnoughTracks,
  // Save
  saveVerifiedTrack,
  saveVerifiedTracks,
  syncSeedTracks,
  // Signals
  recordSignal,
  signals,
  // Vibe Training
  trainVibe,
  trainVibeOnQueue,
  trainVibeOnBoost,
  trainVibeOnReaction,
  // Utils
  detectModes,
  modesToVibeProfile,
  centralToTrack,
  centralToTracks,
  getStats,
};

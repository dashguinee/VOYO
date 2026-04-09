/**
 * VOYO Music - Intelligent DJ Service
 *
 * THE KILLER ARCHITECTURE:
 * AI understands your vibe → Finds actual YouTube videos → Verified playable content
 *
 * Flow:
 * 1. Collect listening context (mood, patterns, favorites)
 * 2. Ask Gemini to find ACTUAL YouTube video URLs that match
 * 3. Extract video IDs from URLs
 * 4. Verify with our backend → Add to pool
 *
 * The app doesn't need a static database - it discovers content in real-time!
 */

import { Track } from '../types';
import { searchMusic } from './api';
import { useTrackPoolStore } from '../store/trackPoolStore';
import { getThumb } from '../utils/thumbnail';
import { encodeVoyoId } from '../utils/voyoId';
import { safeAddToPool } from './trackVerifier';
import centralDJ, {
  getTracksByMode,
  getTracksByVibe,
  saveVerifiedTrack,
  centralToTracks,
  MixBoardMode,
  VibeProfile,
} from './centralDJ';
import { useReactionStore } from '../store/reactionStore';

// Gemini Configuration
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// DJ Configuration
const DJ_TRIGGER_TRACKS = 4;       // DJ kicks in after 4 tracks
const DJ_MIN_INTERVAL = 90000;    // Minimum 1.5 minutes between DJ runs
const MAX_VIDEOS_PER_RUN = 8;     // Find up to 8 videos per run

// ============================================
// TYPES
// ============================================

interface ListeningContext {
  recentTracks: TrackSnapshot[];
  favoriteArtists: string[];
  currentMood: string;
  timeOfDay: string;
  skipRate: number;
  lovedTracks: string[];
  // Rich engagement data
  categoryPreferences: CategoryPreference[];
  queuedTracks: string[];
  replayedTracks: string[];
  tasteShift: string; // What direction is their taste moving?
}

interface CategoryPreference {
  category: string;
  score: number;
  reactionCount: number;
  isHot: boolean;
}

interface TrackSnapshot {
  title: string;
  artist: string;
  wasLoved: boolean;
  wasSkipped: boolean;
}

interface DJSuggestion {
  youtubeUrl: string;
  title: string;
  artist: string;
  reason: string;
}

interface DJResponse {
  vibe: string;
  suggestions: DJSuggestion[];
}

// ============================================
// STATE
// ============================================

let listeningHistory: TrackSnapshot[] = [];
let lastDJRun = 0;
let djEnabled = true;

// ============================================
// YOUTUBE URL PARSING
// ============================================

/**
 * Extract YouTube video ID from various URL formats
 */
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/, // Just the ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Validate YouTube ID format
 */
function isValidYouTubeId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

// ============================================
// CONTEXT BUILDING
// ============================================

/**
 * Build listening context for the AI
 * Gathers rich data from all our engines!
 */
function buildContext(): ListeningContext {
  const recent = listeningHistory.slice(-10);

  // Find favorite artists (appeared 2+ times or were loved)
  const artistCounts: Record<string, number> = {};
  const lovedTracks: string[] = [];

  recent.forEach(t => {
    artistCounts[t.artist] = (artistCounts[t.artist] || 0) + 1;
    if (t.wasLoved) lovedTracks.push(`${t.artist} - ${t.title}`);
  });

  const favoriteArtists = Object.entries(artistCounts)
    .filter(([_, count]) => count >= 2)
    .map(([artist]) => artist);

  // Calculate skip rate
  const skipRate = recent.length > 0
    ? recent.filter(t => t.wasSkipped).length / recent.length
    : 0;

  // Determine time of day
  const hour = new Date().getHours();
  const timeOfDay = hour < 6 ? 'late night'
    : hour < 12 ? 'morning'
    : hour < 18 ? 'afternoon'
    : 'evening';

  // Infer mood from recent tracks
  const currentMood = inferMood(recent);

  // === RICH DATA FROM OUR ENGINES ===

  // Get category preferences from reaction store
  let categoryPreferences: CategoryPreference[] = [];
  try {
    const reactionState = useReactionStore.getState();
    const prefs = reactionState.userCategoryPreferences;
    const pulse = reactionState.categoryPulse as Record<string, { isHot?: boolean }>;
    categoryPreferences = Object.values(prefs).map((p: any) => ({
      category: p.category,
      score: p.score,
      reactionCount: p.reactionCount,
      isHot: pulse[p.category]?.isHot || false,
    }));
  } catch (e) {
    console.warn('[DJ] Could not load category preferences');
  }

  // Get queued and replayed tracks from pool
  let queuedTracks: string[] = [];
  let replayedTracks: string[] = [];
  try {
    const poolStore = useTrackPoolStore.getState();
    const hotPool = poolStore.hotPool;

    // Tracks that were queued multiple times = user really wants them
    queuedTracks = hotPool
      .filter(t => t.queuedCount >= 2)
      .map(t => `${t.artist} - ${t.title}`);

    // Tracks with high completion + multiple plays = replayed favorites
    replayedTracks = hotPool
      .filter(t => t.playCount >= 2 && t.completionRate > 80)
      .map(t => `${t.artist} - ${t.title}`);
  } catch (e) {
    console.warn('[DJ] Could not load pool data');
  }

  // Detect taste shift - compare early vs recent reactions
  let tasteShift = 'stable';
  if (categoryPreferences.length > 0) {
    const sorted = [...categoryPreferences].sort((a, b) => b.score - a.score);
    if (sorted[0].score > 70) {
      tasteShift = `leaning towards ${sorted[0].category}`;
    }
  }

  return {
    recentTracks: recent,
    favoriteArtists,
    currentMood,
    timeOfDay,
    skipRate,
    lovedTracks,
    categoryPreferences,
    queuedTracks,
    replayedTracks,
    tasteShift,
  };
}

function inferMood(tracks: TrackSnapshot[]): string {
  if (tracks.length === 0) return 'exploring';

  const loved = tracks.filter(t => t.wasLoved);
  if (loved.length > 2) return 'vibing';

  const skipped = tracks.filter(t => t.wasSkipped);
  if (skipped.length > tracks.length / 2) return 'searching';

  return 'flowing';
}

// ============================================
// GEMINI INTEGRATION
// ============================================

/**
 * Build the DJ prompt for Gemini
 */
function buildDJPrompt(context: ListeningContext): string {
  const trackList = context.recentTracks
    .map((t, i) => {
      const status = t.wasSkipped ? '⏭️ skipped' : t.wasLoved ? '❤️ loved' : '✓ played';
      return `${i + 1}. ${t.artist} - ${t.title} [${status}]`;
    })
    .join('\n');

  // Build category preferences string
  const categoryInfo = context.categoryPreferences
    .sort((a, b) => b.score - a.score)
    .map(c => `${c.category}: ${c.score}/100 (${c.reactionCount} reactions${c.isHot ? ', HOT NOW' : ''})`)
    .join('\n  ');

  // Build queued/replayed info
  const queuedInfo = context.queuedTracks.length > 0
    ? `Frequently queued: ${context.queuedTracks.slice(0, 5).join(', ')}`
    : 'No queue favorites yet';

  const replayedInfo = context.replayedTracks.length > 0
    ? `Replayed favorites: ${context.replayedTracks.slice(0, 5).join(', ')}`
    : 'No replay data yet';

  return `You are VOYO's intelligent DJ. Your job is to find REAL YouTube music videos that match the listener's vibe.

CURRENT LISTENING SESSION:
${trackList || '(Just started)'}

LISTENER PROFILE:
- Time: ${context.timeOfDay}
- Mood: ${context.currentMood}
- Skip rate: ${(context.skipRate * 100).toFixed(0)}%
- Taste shift: ${context.tasteShift}
- Favorite artists: ${context.favoriteArtists.join(', ') || 'Still learning...'}
- Loved tracks: ${context.lovedTracks.join(', ') || 'None yet'}

CATEGORY PREFERENCES (from their reactions):
  ${categoryInfo || 'No category data yet'}

ENGAGEMENT SIGNALS:
- ${queuedInfo}
- ${replayedInfo}

YOUR MISSION:
Find ${MAX_VIDEOS_PER_RUN} YouTube music videos that would PERFECTLY fit what this person wants to hear next.

HOW TO FIND REAL YOUTUBE URLS:
1. Think of the song: "Artist Name - Song Title"
2. You have Google Search - USE IT to find: "Artist Name Song Title official video youtube"
3. The official video URL is usually the FIRST result
4. Extract the real youtube.com/watch?v=XXXX URL from search results
5. If you can't search, use your training data knowledge

MUSIC FOCUS:
- African music: Afrobeats, Amapiano, Afro-soul, Afro-pop, Highlife, Dancehall
- If they loved certain artists, find more from those artists OR similar vibes
- If they're skipping a lot, try something different but still African
- Match the time of day energy (late night = chill, morning = uplifting)

RESPOND WITH VALID JSON ONLY:
{
  "vibe": "One sentence describing the vibe you're curating for",
  "suggestions": [
    {
      "youtubeUrl": "https://www.youtube.com/watch?v=REAL_VIDEO_ID",
      "title": "Exact Song Title as on YouTube",
      "artist": "Exact Artist Name",
      "reason": "Why this fits (one sentence)"
    }
  ]
}

CRITICAL - FINDING REAL URLS:
- Search your training data for "Song Title Artist youtube" to find real URLs
- The 11-character video ID at the end of youtube.com/watch?v= is what matters
- Example: Burna Boy "Last Last" → search "Burna Boy Last Last youtube" → https://www.youtube.com/watch?v=VLR3yaus0Cg
- DO NOT guess or fabricate video IDs - only use URLs you've actually seen
- If you can't find the real URL, still include the song with your best guess - we verify it`;
}

/**
 * Call Gemini API to get DJ suggestions
 */
async function callGeminiDJ(prompt: string): Promise<DJResponse | null> {
  if (!GEMINI_API_KEY) {
    console.warn('[Intelligent DJ] No API key configured');
    return null;
  }

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
        // Enable Google Search grounding - Gemini can SEARCH for real YouTube URLs!
        tools: [{
          googleSearch: {}
        }],
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Intelligent DJ] API error:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      console.error('[Intelligent DJ] No text in response');
      return null;
    }

    // Parse JSON from response
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    const result: DJResponse = JSON.parse(jsonStr);
    console.log(`[Intelligent DJ] 🎧 Vibe: "${result.vibe}"`);

    return result;

  } catch (error) {
    console.error('[Intelligent DJ] Error:', error);
    return null;
  }
}

// ============================================
// TRACK PROCESSING
// ============================================

/**
 * Convert DJ suggestion to VOYO Track
 */
function suggestionToTrack(suggestion: DJSuggestion, youtubeId: string): Track {
  const voyoId = encodeVoyoId(youtubeId);

  return {
    id: `dj_${youtubeId}`,
    title: suggestion.title,
    artist: suggestion.artist,
    album: 'DJ Discovery',
    trackId: voyoId,
    coverUrl: getThumb(youtubeId),
    duration: 0, // Will be determined on play
    tags: ['dj-pick', 'discovery'],
    mood: 'afro',
    region: 'NG',
    oyeScore: 0,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Process DJ suggestions and add valid ones to pool
 *
 * SMART VERIFICATION:
 * Gemini suggests artist + title → We search our backend → Use VERIFIED IDs
 * This prevents hallucinated URLs from breaking the app
 *
 * THE FLYWHEEL:
 * Every verified track gets saved to Central DB → Next user gets it FREE
 */
async function processSuggestions(suggestions: DJSuggestion[], dominantMode?: MixBoardMode): Promise<number> {
  let added = 0;

  for (const suggestion of suggestions) {
    // STEP 1: ALWAYS verify via backend search (Gemini might hallucinate URLs)
    // Search for "artist - title" to find the REAL YouTube ID
    const searchQuery = `${suggestion.artist} ${suggestion.title}`;

    try {
      const searchResults = await searchMusic(searchQuery, 3);

      if (searchResults.length > 0) {
        // Use the VERIFIED result from our backend
        const verified = searchResults[0];

        const track: Track = {
          id: `dj_${verified.voyoId}`,
          title: verified.title || suggestion.title,
          artist: verified.artist || suggestion.artist,
          album: 'DJ Discovery',
          trackId: verified.voyoId,
          coverUrl: verified.thumbnail || getThumb(verified.voyoId),
          duration: verified.duration || 0,
          tags: ['dj-pick', 'discovery', 'verified'],
          mood: 'afro',
          region: 'NG',
          oyeScore: verified.views || 0,
          createdAt: new Date().toISOString(),
        };

        // GATE: Validate thumbnail BEFORE adding to pool
        const wasAdded = await safeAddToPool(track, 'llm');
        if (wasAdded) {
          added++;

          // THE FLYWHEEL: Save to Central DB!
          saveVerifiedTrack(track, undefined, 'gemini').then(saved => {
            if (saved) {
              console.log(`[Intelligent DJ] 💾 Saved to Central DB for future users!`);
            }
          }).catch(() => {});

          console.log(`[Intelligent DJ] ✅ VERIFIED: ${suggestion.artist} - ${suggestion.title}`);
        } else {
          console.warn(`[Intelligent DJ] ❌ Thumbnail validation failed: ${suggestion.artist} - ${suggestion.title}`);
        }
      } else {
        // NO fallback to unverified Gemini IDs - we only accept verified tracks
        console.warn(`[Intelligent DJ] ❌ Could not verify: ${suggestion.artist} - ${suggestion.title}`);
      }
    } catch (error) {
      // Search failed - DO NOT use unverified Gemini IDs
      console.warn(`[Intelligent DJ] ❌ Search failed for: ${suggestion.artist} - ${suggestion.title}`);
    }

    // Small delay between searches to avoid hammering the API
    await new Promise(r => setTimeout(r, 150));
  }

  return added;
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Record a track play for DJ context
 */
export function recordPlay(track: Track, wasLoved: boolean = false, wasSkipped: boolean = false): void {
  listeningHistory.push({
    title: track.title,
    artist: track.artist,
    wasLoved,
    wasSkipped,
  });

  // Keep only last 20
  if (listeningHistory.length > 20) {
    listeningHistory = listeningHistory.slice(-20);
  }

  // Check if DJ should run
  checkDJTrigger();
}

/**
 * Check if we should trigger the DJ
 */
async function checkDJTrigger(): Promise<void> {
  if (!djEnabled) return;

  const now = Date.now();
  const timeSinceLastRun = now - lastDJRun;

  if (listeningHistory.length >= DJ_TRIGGER_TRACKS && timeSinceLastRun >= DJ_MIN_INTERVAL) {
    await runDJ();
  }
}

/**
 * Run the intelligent DJ
 *
 * THE FLYWHEEL FLOW:
 * 1. Check Central DB first (FREE, instant)
 * 2. If enough tracks → Use them (no Gemini call!)
 * 3. If not enough → Gemini discovers → Save to Central DB
 * 4. Next user benefits from the discovery
 */
export async function runDJ(): Promise<number> {
  lastDJRun = Date.now();

  console.log('[Intelligent DJ] 🎧 DJ is finding tracks for you...');

  // Build context
  const context = buildContext();

  // ============================================
  // STEP 1: Check Central DB first (THE FLYWHEEL!)
  // ============================================
  const dominantMode = getDominantMode(context);
  console.log(`[Intelligent DJ] 🎯 Dominant vibe: ${dominantMode}`);

  const centralTracks = await getTracksByMode(dominantMode, MAX_VIDEOS_PER_RUN);

  if (centralTracks.length >= MAX_VIDEOS_PER_RUN / 2) {
    // We have enough tracks in Central DB - use them!
    console.log(`[Intelligent DJ] ✨ Using ${centralTracks.length} tracks from Central DB (no Gemini call!)`);

    const tracks = centralToTracks(centralTracks);
    let addedCount = 0;

    // GATE: Still validate each track from Central DB before adding
    for (const track of tracks) {
      const wasAdded = await safeAddToPool(track, 'related');
      if (wasAdded) addedCount++;
    }

    console.log(`[Intelligent DJ] ✨ Added ${addedCount}/${tracks.length} validated tracks from Central DB`);

    // Trigger recommendation refresh
    import('../store/playerStore').then(({ usePlayerStore }) => {
      usePlayerStore.getState().refreshRecommendations?.();
    }).catch(() => {});

    return addedCount;
  }

  // ============================================
  // STEP 2: Not enough in Central DB - ask Gemini
  // ============================================
  console.log(`[Intelligent DJ] 🔍 Central DB has ${centralTracks.length} tracks, need more - calling Gemini...`);

  const prompt = buildDJPrompt(context);
  const response = await callGeminiDJ(prompt);

  if (!response || !response.suggestions || response.suggestions.length === 0) {
    console.log('[Intelligent DJ] No suggestions, falling back to search');
    return await fallbackToSearch(context);
  }

  // Process suggestions and save to Central DB
  const added = await processSuggestions(response.suggestions, dominantMode);

  console.log(`[Intelligent DJ] 🎉 Added ${added} tracks to your queue (and Central DB!)`);

  // Trigger recommendation refresh
  import('../store/playerStore').then(({ usePlayerStore }) => {
    usePlayerStore.getState().refreshRecommendations?.();
  }).catch(() => {});

  return added;
}

/**
 * Determine the dominant MixBoard mode from listening context
 */
function getDominantMode(context: ListeningContext): MixBoardMode {
  // Check category preferences
  if (context.categoryPreferences.length > 0) {
    const sorted = [...context.categoryPreferences].sort((a, b) => b.score - a.score);
    const topCategory = sorted[0].category as MixBoardMode;
    if (topCategory && ['afro-heat', 'chill-vibes', 'party-mode', 'late-night', 'workout'].includes(topCategory)) {
      return topCategory;
    }
  }

  // Infer from mood
  if (context.currentMood === 'vibing') return 'afro-heat';
  if (context.currentMood === 'searching') return 'random-mixer';

  // Infer from time of day
  if (context.timeOfDay === 'late night') return 'late-night';
  if (context.timeOfDay === 'morning') return 'chill-vibes';

  // Default
  return 'afro-heat';
}

/**
 * Fallback to search-based discovery if Gemini fails
 */
async function fallbackToSearch(context: ListeningContext): Promise<number> {
  const query = context.favoriteArtists.length > 0
    ? `${context.favoriteArtists[0]} ${context.currentMood === 'vibing' ? 'hits' : 'songs'}`
    : 'afrobeats trending 2024';

  console.log(`[Intelligent DJ] Fallback search: "${query}"`);

  try {
    const results = await searchMusic(query, 10);

    let added = 0;
    for (const result of results) {
      const track: Track = {
        id: result.voyoId,
        title: result.title,
        artist: result.artist,
        album: 'VOYO',
        trackId: result.voyoId,
        coverUrl: result.thumbnail,
        duration: result.duration,
        tags: ['fallback'],
        mood: 'afro',
        region: 'NG',
        oyeScore: result.views || 0,
        createdAt: new Date().toISOString(),
      };

      // GATE: Validate before adding
      const wasAdded = await safeAddToPool(track, 'related');
      if (wasAdded) added++;
    }

    return added;
  } catch (error) {
    console.error('[Intelligent DJ] Fallback also failed:', error);
    return 0;
  }
}

/**
 * Force DJ to run now (for testing)
 */
export async function forceDJ(): Promise<number> {
  console.log('[Intelligent DJ] 🎧 Force running DJ...');
  return await runDJ();
}

/**
 * Enable/disable DJ
 */
export function setDJEnabled(enabled: boolean): void {
  djEnabled = enabled;
  console.log(`[Intelligent DJ] DJ ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Get DJ status
 */
export function getDJStatus() {
  return {
    enabled: djEnabled,
    historyLength: listeningHistory.length,
    lastRun: lastDJRun,
    timeSinceLastRun: Date.now() - lastDJRun,
  };
}

/**
 * Reset DJ state
 */
export function resetDJ(): void {
  listeningHistory = [];
  lastDJRun = 0;
  console.log('[Intelligent DJ] DJ reset');
}

/**
 * Test Gemini connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say "VOYO DJ ready" and nothing else.' }] }],
        generationConfig: { maxOutputTokens: 20 },
      }),
    });

    if (!response.ok) {
      console.error('[Intelligent DJ] Connection test failed:', response.status);
      return false;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('[Intelligent DJ] Connection test:', text);
    return text?.toLowerCase().includes('voyo') || text?.toLowerCase().includes('ready');
  } catch (error) {
    console.error('[Intelligent DJ] Connection test error:', error);
    return false;
  }
}

// ============================================
// DEBUG HELPERS
// ============================================

if (typeof window !== 'undefined') {
  (window as any).voyoDJ = {
    run: forceDJ,
    test: testConnection,
    status: getDJStatus,
    reset: resetDJ,
    enable: () => setDJEnabled(true),
    disable: () => setDJEnabled(false),
  };
  console.log('🎧 [Intelligent DJ] Debug: window.voyoDJ.run() / .test() / .status()');
}

export default {
  recordPlay,
  runDJ,
  forceDJ,
  testConnection,
  getDJStatus,
  resetDJ,
  setDJEnabled,
};

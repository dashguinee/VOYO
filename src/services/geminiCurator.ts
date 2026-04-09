/**
 * VOYO Music - Gemini Curator Service
 *
 * REVOLUTIONARY APPROACH:
 * Instead of cold pattern matching, we use Gemini to UNDERSTAND
 * the user's listening journey and curate with emotional intelligence.
 *
 * Flow:
 * 1. Collect recent listening history (last 5-10 tracks)
 * 2. Send to Gemini with context (time, mood trajectory, skip patterns)
 * 3. Gemini returns smart search queries that match the NARRATIVE
 * 4. We search Piped with those queries
 * 5. Pool expands with emotionally-aligned tracks
 *
 * Cost: ~$0.0001 per call, called every 5 tracks = basically free
 */

import { Track } from '../types';
import { searchAlbums, getAlbumTracks } from './piped';
import { pipedTrackToVoyoTrack } from '../data/tracks';
import { useTrackPoolStore } from '../store/trackPoolStore';
import { safeAddManyToPool } from './trackVerifier';

// Gemini API Configuration
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Curator Configuration
const CURATOR_TRIGGER_TRACKS = 5;  // Curate after every 5 tracks
const CURATOR_MIN_INTERVAL = 120000; // Minimum 2 minutes between curations
const MAX_SEARCH_QUERIES = 5;  // Gemini suggests up to 5 queries
const TRACKS_PER_QUERY = 10;  // Fetch up to 10 tracks per query

// ============================================
// TYPES
// ============================================

export interface ListeningSession {
  tracks: TrackHistory[];
  startTime: number;
  totalListenTime: number;
  skipCount: number;
  reactionCount: number;
}

export interface TrackHistory {
  track: Track;
  playedAt: number;
  completionRate: number;
  wasSkipped: boolean;
  hadReaction: boolean;
}

export interface CurationResult {
  queries: string[];
  reasoning: string;
  suggestedMood: string;
  narrativeArc: string;
}

export interface CuratorStats {
  totalCurations: number;
  tracksDiscovered: number;
  lastCurationTime: number;
  averageResponseTime: number;
}

// ============================================
// SESSION TRACKING
// ============================================

let currentSession: ListeningSession = {
  tracks: [],
  startTime: Date.now(),
  totalListenTime: 0,
  skipCount: 0,
  reactionCount: 0,
};

let lastCurationTime = 0;
let curatorStats: CuratorStats = {
  totalCurations: 0,
  tracksDiscovered: 0,
  lastCurationTime: 0,
  averageResponseTime: 0,
};

/**
 * Record a track play in the current session
 */
export function recordTrackInSession(
  track: Track,
  completionRate: number = 100,
  wasSkipped: boolean = false,
  hadReaction: boolean = false
): void {
  const historyItem: TrackHistory = {
    track,
    playedAt: Date.now(),
    completionRate,
    wasSkipped,
    hadReaction,
  };

  currentSession.tracks.push(historyItem);

  if (wasSkipped) currentSession.skipCount++;
  if (hadReaction) currentSession.reactionCount++;

  // Keep only last 10 tracks in session
  if (currentSession.tracks.length > 10) {
    currentSession.tracks = currentSession.tracks.slice(-10);
  }

  console.log(`[Gemini Curator] Session: ${currentSession.tracks.length} tracks, ${currentSession.skipCount} skips, ${currentSession.reactionCount} reactions`);

  // Check if we should trigger curation
  checkCurationTrigger();
}

/**
 * Check if we should trigger a curation
 */
async function checkCurationTrigger(): Promise<void> {
  const now = Date.now();
  const timeSinceLastCuration = now - lastCurationTime;
  const tracksSinceLastCuration = currentSession.tracks.length;

  // Trigger conditions:
  // 1. At least 5 tracks played
  // 2. At least 2 minutes since last curation
  if (tracksSinceLastCuration >= CURATOR_TRIGGER_TRACKS && timeSinceLastCuration >= CURATOR_MIN_INTERVAL) {
    console.log('[Gemini Curator] Triggering curation...');
    await curateAndExpand();
  }
}

// ============================================
// GEMINI INTEGRATION
// ============================================

/**
 * Build the prompt for Gemini based on listening session
 */
function buildCurationPrompt(session: ListeningSession): string {
  const trackList = session.tracks
    .map((h, i) => {
      const status = h.wasSkipped ? '⏭️ SKIPPED' : h.hadReaction ? '❤️ LOVED' : '✓';
      const completion = h.wasSkipped ? `${h.completionRate.toFixed(0)}%` : '100%';
      return `${i + 1}. ${h.track.artist} - ${h.track.title} [${status}] (${completion})`;
    })
    .join('\n');

  const hour = new Date().getHours();
  const timeOfDay = hour < 6 ? 'late night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

  const skipRate = session.tracks.length > 0
    ? ((session.skipCount / session.tracks.length) * 100).toFixed(0)
    : '0';

  const prompt = `You are VOYO's music curator AI. Your job is to understand the user's listening JOURNEY and suggest what they might want to hear next.

CURRENT LISTENING SESSION:
${trackList}

CONTEXT:
- Time: ${timeOfDay} (${new Date().toLocaleTimeString()})
- Skip rate: ${skipRate}% (${session.skipCount}/${session.tracks.length} tracks)
- Reactions given: ${session.reactionCount}
- Session duration: ${Math.round((Date.now() - session.startTime) / 60000)} minutes

ANALYSIS TASK:
1. Identify the EMOTIONAL NARRATIVE - what journey is this person on?
2. Notice patterns - are they exploring or settling into a mood?
3. Consider the time of day - late night vs morning energy
4. If high skip rate, they might be searching for something specific

RESPOND WITH VALID JSON ONLY (no markdown, no explanation outside JSON):
{
  "reasoning": "Brief explanation of what you observe about their listening journey",
  "narrativeArc": "One phrase describing their emotional trajectory (e.g., 'healing from heartbreak', 'building energy', 'winding down')",
  "suggestedMood": "The mood/energy level for next tracks (e.g., 'introspective', 'uplifting', 'chill')",
  "queries": [
    "search query 1 for YouTube/music platforms",
    "search query 2",
    "search query 3",
    "search query 4",
    "search query 5"
  ]
}

QUERY GUIDELINES:
- Be specific: "Burna Boy love songs acoustic" not just "Burna Boy"
- Mix: 2 artist-specific + 2 mood/genre + 1 discovery (new artist they might like)
- Consider African music primarily (Afrobeats, Amapiano, Afro-soul, etc.)
- Time-appropriate: late night = chill, morning = energetic
- If they loved tracks with reactions, find MORE like those specifically`;

  return prompt;
}

/**
 * Call Gemini API to get curation suggestions
 */
async function callGemini(prompt: string): Promise<CurationResult | null> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
    });

    if (!response.ok) {
      console.error('[Gemini Curator] API error:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      console.error('[Gemini Curator] No text in response');
      return null;
    }

    // Parse JSON from response (handle potential markdown code blocks)
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    const result: CurationResult = JSON.parse(jsonStr);

    const responseTime = Date.now() - startTime;
    console.log(`[Gemini Curator] Response in ${responseTime}ms:`, result.narrativeArc);

    // Update stats
    curatorStats.totalCurations++;
    curatorStats.lastCurationTime = Date.now();
    curatorStats.averageResponseTime =
      (curatorStats.averageResponseTime * (curatorStats.totalCurations - 1) + responseTime) / curatorStats.totalCurations;

    return result;

  } catch (error) {
    console.error('[Gemini Curator] Error:', error);
    return null;
  }
}

// ============================================
// POOL EXPANSION
// ============================================

/**
 * Main curation function - gets Gemini suggestions and expands pool
 */
export async function curateAndExpand(): Promise<number> {
  if (currentSession.tracks.length < 3) {
    console.log('[Gemini Curator] Not enough tracks for curation');
    return 0;
  }

  lastCurationTime = Date.now();

  // Build prompt and call Gemini
  const prompt = buildCurationPrompt(currentSession);
  const curation = await callGemini(prompt);

  if (!curation || !curation.queries || curation.queries.length === 0) {
    console.log('[Gemini Curator] No curation results, using fallback');
    return await fallbackCuration();
  }

  console.log(`[Gemini Curator] 🎯 Narrative: "${curation.narrativeArc}"`);
  console.log(`[Gemini Curator] 🎨 Mood: "${curation.suggestedMood}"`);
  console.log(`[Gemini Curator] 🔍 Queries:`, curation.queries);

  // Search Piped with each query and add to pool
  let totalTracksAdded = 0;
  const poolStore = useTrackPoolStore.getState();

  for (const query of curation.queries.slice(0, MAX_SEARCH_QUERIES)) {
    try {
      const albums = await searchAlbums(query, 3);

      for (const album of albums) {
        const pipedTracks = await getAlbumTracks(album.id);
        const voyoTracks = pipedTracks
          .slice(0, TRACKS_PER_QUERY)
          .map(pt => pipedTrackToVoyoTrack(pt, album.name));

        // GATE: Validate each track before adding to pool
        const added = await safeAddManyToPool(voyoTracks, 'llm');
        totalTracksAdded += added;

        console.log(`[Gemini Curator] Added ${added}/${voyoTracks.length} validated tracks from "${album.name}"`);
      }
    } catch (error) {
      console.warn(`[Gemini Curator] Query failed: "${query}"`, error);
    }
  }

  curatorStats.tracksDiscovered += totalTracksAdded;
  console.log(`[Gemini Curator] ✅ Session complete: ${totalTracksAdded} new tracks added to pool`);

  // Trigger recommendation refresh
  import('../store/playerStore').then(({ usePlayerStore }) => {
    usePlayerStore.getState().refreshRecommendations?.();
  }).catch(() => {});

  return totalTracksAdded;
}

/**
 * Fallback curation when Gemini fails - use last played artist
 */
async function fallbackCuration(): Promise<number> {
  const lastTrack = currentSession.tracks[currentSession.tracks.length - 1]?.track;
  if (!lastTrack) return 0;

  console.log(`[Gemini Curator] Fallback: searching for more ${lastTrack.artist}`);

  try {
    const albums = await searchAlbums(`${lastTrack.artist} official`, 3);
    const poolStore = useTrackPoolStore.getState();
    let totalAdded = 0;

    for (const album of albums) {
      const pipedTracks = await getAlbumTracks(album.id);
      const voyoTracks = pipedTracks.slice(0, 10).map(pt => pipedTrackToVoyoTrack(pt, album.name));
      // GATE: Validate before adding
      const added = await safeAddManyToPool(voyoTracks, 'related');
      totalAdded += added;
    }

    return totalAdded;
  } catch (error) {
    console.error('[Gemini Curator] Fallback also failed:', error);
    return 0;
  }
}

// ============================================
// MANUAL TRIGGERS
// ============================================

/**
 * Force a curation now (for testing or user request)
 */
export async function forceCuration(): Promise<CurationResult | null> {
  console.log('[Gemini Curator] Force curation requested');

  if (currentSession.tracks.length < 1) {
    console.log('[Gemini Curator] No tracks in session');
    return null;
  }

  const prompt = buildCurationPrompt(currentSession);
  const result = await callGemini(prompt);

  if (result) {
    await curateAndExpand();
  }

  return result;
}

/**
 * Curate based on a specific mood/request
 */
export async function curateByRequest(request: string): Promise<number> {
  console.log(`[Gemini Curator] Custom request: "${request}"`);

  const prompt = `You are VOYO's music curator AI. The user wants: "${request}"

Generate 5 specific search queries for YouTube/music platforms to find this music.
Focus on African music (Afrobeats, Amapiano, Afro-soul, Highlife, etc.) unless otherwise specified.

RESPOND WITH VALID JSON ONLY:
{
  "reasoning": "Why these queries match the request",
  "narrativeArc": "${request}",
  "suggestedMood": "The mood these tracks should have",
  "queries": [
    "search query 1",
    "search query 2",
    "search query 3",
    "search query 4",
    "search query 5"
  ]
}`;

  const result = await callGemini(prompt);

  if (!result) {
    // Fallback: just search the request directly
    const albums = await searchAlbums(request, 5);
    const poolStore = useTrackPoolStore.getState();
    let total = 0;

    for (const album of albums) {
      const tracks = await getAlbumTracks(album.id);
      const voyoTracks = tracks.slice(0, 10).map(pt => pipedTrackToVoyoTrack(pt, album.name));
      // GATE: Validate before adding
      const added = await safeAddManyToPool(voyoTracks, 'llm');
      total += added;
    }

    return total;
  }

  // Use Gemini's queries
  const poolStore = useTrackPoolStore.getState();
  let totalAdded = 0;

  for (const query of result.queries) {
    try {
      const albums = await searchAlbums(query, 2);
      for (const album of albums) {
        const tracks = await getAlbumTracks(album.id);
        const voyoTracks = tracks.slice(0, 8).map(pt => pipedTrackToVoyoTrack(pt, album.name));
        // GATE: Validate before adding
        const added = await safeAddManyToPool(voyoTracks, 'llm');
        totalAdded += added;
      }
    } catch (e) {
      console.warn(`[Gemini Curator] Query failed: ${query}`);
    }
  }

  console.log(`[Gemini Curator] Custom request added ${totalAdded} tracks`);
  return totalAdded;
}

// ============================================
// STATS & DEBUG
// ============================================

/**
 * Get curator statistics
 */
export function getCuratorStats(): CuratorStats & { sessionTracks: number } {
  return {
    ...curatorStats,
    sessionTracks: currentSession.tracks.length,
  };
}

/**
 * Get current session for debugging
 */
export function getCurrentSession(): ListeningSession {
  return { ...currentSession };
}

/**
 * Reset session (for new listening session)
 */
export function resetSession(): void {
  currentSession = {
    tracks: [],
    startTime: Date.now(),
    totalListenTime: 0,
    skipCount: 0,
    reactionCount: 0,
  };
  console.log('[Gemini Curator] Session reset');
}

/**
 * Test Gemini connection
 */
export async function testGeminiConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say "VOYO connected" and nothing else.' }] }],
        generationConfig: { maxOutputTokens: 20 },
      }),
    });

    if (!response.ok) return false;

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('[Gemini Curator] Connection test:', text);
    return text?.toLowerCase().includes('voyo');
  } catch (error) {
    console.error('[Gemini Curator] Connection test failed:', error);
    return false;
  }
}

export default {
  recordTrackInSession,
  curateAndExpand,
  forceCuration,
  curateByRequest,
  getCuratorStats,
  getCurrentSession,
  resetSession,
  testGeminiConnection,
};

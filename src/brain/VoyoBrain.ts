/**
 * VOYO Brain - Central Intelligence
 *
 * ONE Brain call creates:
 * - Main Queue (20 tracks) - Primary playback session
 * - 5 Shadow Sessions (75 tracks) - Ready to blend on vibe shift
 * - HOT Belt (5 tracks) - Personalized trending
 * - DISCOVERY Belt (5 tracks) - New finds
 * - Transition Rules - How to blend between sessions
 * - DJ Moments - When to insert mixes
 * - Learning Updates - Pattern confirmations
 *
 * Total: ~105 curated items per Brain call
 * Cost: ~$0.002-0.006 per session (1-3 calls)
 *
 * Philosophy: Brain sets DIRECTION, Math handles SPEED
 */

import { signalBuffer, SignalSummary } from './SignalBuffer';
import { getTracksByMode, MixBoardMode, CentralTrack } from '../services/centralDJ';
import { useIntentStore, VibeMode } from '../store/intentStore';
import { searchMusic } from '../services/api';
import { getThumb } from '../utils/thumbnail';
import { encodeVoyoId } from '../utils/voyoId';
import { Track } from '../types';
// Knowledge integration - Brain reads, Scouts write
import {
  useKnowledgeStore,
  getKnowledgeStats,
  findTracksByVibeProfile
} from '../knowledge/KnowledgeStore';
import {
  PrimaryMood,
  VIBE_PROFILES,
  getCompatibleMoods
} from '../knowledge/MoodTags';

// ============================================
// CONFIGURATION
// ============================================

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Session sizes
const MAIN_QUEUE_SIZE = 20;
const SHADOW_SESSION_SIZE = 15;
const HOT_BELT_SIZE = 5;
const DISCOVERY_BELT_SIZE = 5;

// ============================================
// TYPES
// ============================================

export interface ShadowSession {
  id: string;
  name: string;
  vibe: VibeMode | string;
  tracks: string[]; // YouTube video IDs
  trigger: string; // When to activate
  blendSpeed: 'instant' | 'smooth' | 'gradual'; // 1, 3, or 5 track transition
}

export interface Belt {
  type: 'hot' | 'discovery';
  title: string;
  tracks: string[]; // YouTube video IDs
  refreshRule: string; // When to refresh
}

export interface TransitionRule {
  from: string; // Session ID or 'main'
  to: string; // Session ID
  condition: string; // Signal pattern that triggers
  blendTracks: number; // How many tracks to blend over
}

export interface DJMoment {
  condition: string; // When to insert mix
  mixQuery: string; // What to search for
  djIntro?: string; // What DJ says before
  djOutro?: string; // What DJ says after
}

export interface LearningUpdate {
  patternsConfirmed: string[];
  tasteShift?: {
    from: string;
    to: string;
    confidence: number;
  };
  artistsRising: string[];
  artistsFalling: string[];
}

export interface BrainOutput {
  sessionName: string;
  mainQueue: {
    tracks: Array<{
      type: 'track' | 'mix';
      youtubeId: string;
      title: string;
      artist: string;
      reason?: string;
      duration?: number;
      djIntro?: string;
      djOutro?: string;
    }>;
    strategy: string;
  };
  shadows: ShadowSession[];
  belts: {
    hot: Belt;
    discovery: Belt;
  };
  transitionRules: TransitionRule[];
  djMoments: DJMoment[];
  learning: LearningUpdate;
  discoveryQueries: string[]; // Searches to run for expanding taste
}

// ============================================
// VOYOBRAIN CLASS
// ============================================

class VoyoBrain {
  private lastOutput: BrainOutput | null = null;
  private isProcessing: boolean = false;

  constructor() {
    console.log('[Brain] VoyoBrain initialized');
    this.registerWithBuffer();
  }

  private registerWithBuffer(): void {
    signalBuffer.onBrainTrigger((summary) => this.curate(summary));
  }

  // ============================================
  // MAIN CURATION
  // ============================================

  async curate(summary: SignalSummary): Promise<BrainOutput | null> {
    if (this.isProcessing) {
      console.log('[Brain] Already processing, skipping');
      return this.lastOutput;
    }

    if (!GEMINI_API_KEY) {
      console.warn('[Brain] No Gemini API key, using fallback');
      return this.fallbackCuration(summary);
    }

    this.isProcessing = true;
    console.log('[Brain] Starting curation with', summary.signalCount, 'signals');

    try {
      // Build context from signals and stores
      const context = await this.buildContext(summary);

      // Call Gemini for curation
      const output = await this.callGemini(context);

      // Validate and enhance output
      const validated = await this.validateOutput(output);

      this.lastOutput = validated;
      console.log('[Brain] Curation complete:', validated.sessionName);

      return validated;
    } catch (err) {
      console.error('[Brain] Curation error:', err);
      return this.fallbackCuration(summary);
    } finally {
      this.isProcessing = false;
    }
  }

  // ============================================
  // CONTEXT BUILDING
  // ============================================

  private async buildContext(summary: SignalSummary): Promise<string> {
    // Get intent weights from store
    let intentWeights: Record<VibeMode, number> = {} as Record<VibeMode, number>;
    try {
      intentWeights = useIntentStore.getState().getIntentWeights();
    } catch {
      // Fallback equal weights
      const modes: VibeMode[] = ['afro-heat', 'chill-vibes', 'party-mode', 'late-night', 'workout', 'random-mixer'];
      modes.forEach(m => intentWeights[m] = 1/6);
    }

    // Get collective data from Central DJ
    let collectiveHits: Array<{ title: string; artist: string; playCount: number }> = [];
    try {
      const centralTracks = await getTracksByMode('afro-heat' as MixBoardMode, 10);
      collectiveHits = centralTracks.map(t => ({
        title: t.title,
        artist: t.artist,
        playCount: t.play_count || 0
      }));
    } catch {
      // Ignore
    }

    // Format recent tracks
    const recentFormatted = summary.recentTracks
      .map(t => `${t.artist} - ${t.title} [${t.action}]`)
      .join('\n');

    // Format YouTube recommendations
    const ytRecs = summary.youtubeRecommendations
      .slice(0, 5)
      .map(r => `${r.title} (seen ${r.count}x, vibe: ${r.detectedVibe || 'unknown'})`)
      .join('\n');

    return `
USER LISTENING SESSION CONTEXT:
================================

TIME: ${summary.timeOfDay}, ${summary.dayOfWeek}
SESSION LENGTH: ${summary.sessionLength} minutes

ENGAGEMENT METRICS:
- Tracks Played: ${summary.tracksPlayed}
- Completion Rate: ${summary.avgCompletionRate}%
- Skip Streaks: ${summary.skipStreaks}
- OYE Reactions: ${summary.oyeCount}
- Love Actions: ${summary.loveCount}
- Dislikes: ${summary.dislikeCount}

MIXBOARD INTENT (what they WANT):
${Object.entries(intentWeights)
  .sort(([,a], [,b]) => b - a)
  .map(([mode, weight]) => `- ${mode}: ${Math.round(weight * 100)}%`)
  .join('\n')}

DOMINANT MODES THIS SESSION:
${summary.dominantModes.join(', ') || 'None yet'}

RECENT TRACK HISTORY (last 20):
${recentFormatted || 'No tracks yet'}

YOUTUBE ALGORITHM SUGGESTIONS (free intelligence):
${ytRecs || 'None captured yet'}

COLLECTIVE HITS (what others love):
${collectiveHits.map(h => `${h.artist} - ${h.title} (${h.playCount} plays)`).join('\n') || 'Loading...'}

BEHAVIOR PATTERNS:
- Bar Changes: ${summary.barChanges}
- Drag-to-Queue: ${summary.dragToQueueCount}
- Queue Adds: ${summary.queueAdds}
- Searches: ${summary.searches}
- Mode Hopping: ${summary.modeHoppingCount}

MIX ENGAGEMENT:
- Mixes Started: ${summary.mixesStarted}
- Mixes Completed: ${summary.mixesCompleted}
- Avg Watch Time: ${summary.avgMixWatchTime}s

${this.getKnowledgeContext(summary.dominantModes)}
`;
  }

  // ============================================
  // KNOWLEDGE CONTEXT (from Hungry Scouts)
  // ============================================

  private getKnowledgeContext(dominantModes: string[]): string {
    try {
      const knowledgeStore = useKnowledgeStore.getState();
      const stats = getKnowledgeStats();

      // If no knowledge yet, skip
      if (stats.totalTracks === 0) {
        return 'KNOWLEDGE BASE: Still learning (scouts are gathering data)';
      }

      // Map dominant modes to moods
      const moodMap: Record<string, PrimaryMood> = {
        'afro-heat': 'energetic',
        'chill-vibes': 'chill',
        'party-mode': 'party',
        'late-night': 'sensual',
        'workout': 'aggressive',
        'random-mixer': 'playful'
      };

      const relevantMoods = dominantModes
        .map(m => moodMap[m])
        .filter(Boolean) as PrimaryMood[];

      // Get suggestions from knowledge
      let suggestions: string[] = [];

      for (const mood of relevantMoods.slice(0, 2)) {
        const tracks = knowledgeStore.findTracksByMood(mood, 10);
        tracks.forEach(t => {
          suggestions.push(`${t.artistName} - ${t.title} [${t.primaryMood}, energy:${t.energy}]`);
        });
      }

      // Get genre distribution
      const genreStats = Object.entries(stats.tracksByGenre)
        .map(([genre, count]) => `${genre}: ${count}`)
        .slice(0, 5)
        .join(', ');

      return `
KNOWLEDGE BASE (from Hungry Scouts):
- Total Artists Known: ${stats.totalArtists}
- Total Tracks Classified: ${stats.totalTracks}
- Genres Available: ${genreStats}

PRE-CLASSIFIED SUGGESTIONS (match user's vibe):
${suggestions.slice(0, 15).join('\n') || 'No direct matches yet'}

USE THESE TRACK IDs WHEN AVAILABLE - they are verified and classified!
`;
    } catch {
      return '';
    }
  }

  // ============================================
  // GEMINI CALL
  // ============================================

  private async callGemini(context: string): Promise<BrainOutput> {
    const prompt = `You are VOYO DJ, an expert African music curator with deep knowledge of Afrobeats, Amapiano, and global music trends.

${context}

Based on this user's listening session, create a personalized DJ session.

RESPOND WITH VALID JSON ONLY:

{
  "sessionName": "Creative name for this vibe session (e.g., 'Tuesday Night Afro Heat')",
  "mainQueue": {
    "tracks": [
      {
        "type": "track",
        "youtubeId": "ACTUAL_11_CHAR_YOUTUBE_ID",
        "title": "Track Title",
        "artist": "Artist Name",
        "reason": "Why this track fits"
      }
    ],
    "strategy": "Description of the queue flow/progression"
  },
  "shadows": [
    {
      "id": "chill_shift",
      "name": "Chill Transition",
      "vibe": "chill-vibes",
      "tracks": ["youtubeId1", "youtubeId2", ...],
      "trigger": "2+ hype skips in a row",
      "blendSpeed": "smooth"
    },
    {
      "id": "energy_boost",
      "name": "Energy Surge",
      "vibe": "party-mode",
      "tracks": ["...", "..."],
      "trigger": "OYE on fast track",
      "blendSpeed": "instant"
    },
    {
      "id": "deep_afro",
      "name": "Deep Afro Roots",
      "vibe": "afro-heat",
      "tracks": ["...", "..."],
      "trigger": "3+ afro completes",
      "blendSpeed": "gradual"
    },
    {
      "id": "late_night",
      "name": "Late Night Feels",
      "vibe": "late-night",
      "tracks": ["...", "..."],
      "trigger": "Past 11pm + slowing pace",
      "blendSpeed": "gradual"
    },
    {
      "id": "discovery",
      "name": "Fresh Finds",
      "vibe": "random-mixer",
      "tracks": ["...", "..."],
      "trigger": "Search action or mode hop",
      "blendSpeed": "smooth"
    }
  ],
  "belts": {
    "hot": {
      "type": "hot",
      "title": "Hot For You Tonight",
      "tracks": ["id1", "id2", "id3", "id4", "id5"],
      "refreshRule": "Every 30 minutes or after 3+ loves"
    },
    "discovery": {
      "type": "discovery",
      "title": "You Might Love",
      "tracks": ["id1", "id2", "id3", "id4", "id5"],
      "refreshRule": "After discovery click or search"
    }
  },
  "transitionRules": [
    {
      "from": "main",
      "to": "chill_shift",
      "condition": "2 consecutive high-energy skips",
      "blendTracks": 3
    }
  ],
  "djMoments": [
    {
      "condition": "After 15 minutes of steady engagement",
      "mixQuery": "afrobeats chill mix 2024",
      "djIntro": "You're locked in... let this mix carry you",
      "djOutro": "Welcome back to your vibe"
    }
  ],
  "learning": {
    "patternsConfirmed": ["Loves high-energy afternoon sessions", "Skips slow intros"],
    "tasteShift": {
      "from": "pure afrobeats",
      "to": "afro-fusion",
      "confidence": 0.7
    },
    "artistsRising": ["Ayra Starr", "Rema"],
    "artistsFalling": []
  },
  "discoveryQueries": ["new afrobeats 2024", "amapiano hits", "tyla music"]
}

CRITICAL RULES:
1. Use REAL YouTube video IDs (11 characters) - search your knowledge for actual popular tracks
2. Main queue: 20 tracks with progression (opening -> peak -> cooldown -> peak -> outro)
3. Each shadow: 15 tracks matching that vibe
4. Include actual artists like: Burna Boy, Wizkid, Davido, Rema, Ayra Starr, Tyla, CKay, Tems, Asake, Omah Lay
5. If user skips a lot, suggest more variety
6. If user loves consistently, double down on that style
7. For mixes, suggest real DJ mix searches that exist on YouTube
8. Be creative with session names based on time and mood`;

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8000,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
        tools: [{
          googleSearch: {}
        }]
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('No content in Gemini response');
    }

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    return JSON.parse(jsonMatch[0]) as BrainOutput;
  }

  // ============================================
  // VALIDATION
  // ============================================

  private async validateOutput(output: BrainOutput): Promise<BrainOutput> {
    // Ensure all required fields exist
    if (!output.mainQueue?.tracks || output.mainQueue.tracks.length === 0) {
      console.warn('[Brain] Empty main queue, adding fallback');
      output.mainQueue = {
        tracks: await this.getFallbackTracks(MAIN_QUEUE_SIZE),
        strategy: 'Fallback curation'
      };
    }

    // Ensure shadows exist
    if (!output.shadows || output.shadows.length < 5) {
      console.warn('[Brain] Missing shadows, filling with fallbacks');
      output.shadows = await this.getFallbackShadows();
    }

    // Ensure belts exist
    if (!output.belts?.hot?.tracks) {
      output.belts = output.belts || {} as any;
      output.belts.hot = {
        type: 'hot',
        title: 'Hot For You',
        tracks: (await this.getFallbackTracks(5)).map(t => t.youtubeId),
        refreshRule: 'Every 30 minutes'
      };
    }

    if (!output.belts?.discovery?.tracks) {
      output.belts.discovery = {
        type: 'discovery',
        title: 'Discover',
        tracks: (await this.getFallbackTracks(5)).map(t => t.youtubeId),
        refreshRule: 'After search'
      };
    }

    // Ensure learning exists
    if (!output.learning) {
      output.learning = {
        patternsConfirmed: [],
        artistsRising: [],
        artistsFalling: []
      };
    }

    // Ensure discovery queries exist
    if (!output.discoveryQueries || output.discoveryQueries.length === 0) {
      output.discoveryQueries = ['afrobeats 2024', 'amapiano hits', 'new music africa'];
    }

    return output;
  }

  // ============================================
  // FALLBACK
  // ============================================

  private async fallbackCuration(summary: SignalSummary): Promise<BrainOutput> {
    console.log('[Brain] Using fallback curation');

    const mainTracks = await this.getFallbackTracks(MAIN_QUEUE_SIZE);
    const shadows = await this.getFallbackShadows();

    return {
      sessionName: `${summary.timeOfDay.charAt(0).toUpperCase() + summary.timeOfDay.slice(1)} Vibes`,
      mainQueue: {
        tracks: mainTracks,
        strategy: 'Fallback balanced mix'
      },
      shadows,
      belts: {
        hot: {
          type: 'hot',
          title: 'Hot For You',
          tracks: mainTracks.slice(0, 5).map(t => t.youtubeId),
          refreshRule: 'Every 30 minutes'
        },
        discovery: {
          type: 'discovery',
          title: 'Discover',
          tracks: mainTracks.slice(5, 10).map(t => t.youtubeId),
          refreshRule: 'After search'
        }
      },
      transitionRules: [
        { from: 'main', to: 'chill_shift', condition: '2+ skips', blendTracks: 3 }
      ],
      djMoments: [],
      learning: {
        patternsConfirmed: [],
        artistsRising: [],
        artistsFalling: []
      },
      discoveryQueries: ['afrobeats 2024', 'amapiano', 'african music']
    };
  }

  private async getFallbackTracks(count: number): Promise<BrainOutput['mainQueue']['tracks']> {
    const tracks: BrainOutput['mainQueue']['tracks'] = [];

    // FIRST: Try to get tracks from Knowledge Store (fast, no API calls)
    try {
      const knowledgeStore = useKnowledgeStore.getState();
      const energeticTracks = knowledgeStore.findTracksByMood('energetic', Math.ceil(count / 2));
      const chillTracks = knowledgeStore.findTracksByMood('chill', Math.ceil(count / 2));

      [...energeticTracks, ...chillTracks].slice(0, count).forEach(kt => {
        tracks.push({
          type: 'track',
          youtubeId: kt.id,
          title: kt.title,
          artist: kt.artistName,
          reason: `From Knowledge (${kt.primaryMood}, energy:${kt.energy})`
        });
      });

      if (tracks.length >= count) {
        console.log('[Brain] Fallback using Knowledge Store:', tracks.length, 'tracks');
        return tracks;
      }
    } catch {
      // Knowledge store not available, continue to fallback
    }

    // SECOND: Try popular artists via search
    const artists = ['Burna Boy', 'Wizkid', 'Davido', 'Rema', 'Ayra Starr', 'Tyla', 'CKay', 'Tems'];

    for (let i = 0; i < Math.min(count - tracks.length, artists.length); i++) {
      try {
        const results = await searchMusic(`${artists[i]} official music video`, 1);
        if (results.length > 0) {
          const result = results[0];
          tracks.push({
            type: 'track',
            youtubeId: result.voyoId,
            title: result.title,
            artist: result.artist || artists[i],
            reason: 'Fallback popular track'
          });
        }
      } catch {
        // Skip this artist
      }
    }

    // THIRD: Fill remaining with central DJ tracks
    if (tracks.length < count) {
      try {
        const centralTracks = await getTracksByMode('afro-heat' as MixBoardMode, count - tracks.length);
        centralTracks.forEach(ct => {
          tracks.push({
            type: 'track',
            youtubeId: ct.youtube_id,
            title: ct.title,
            artist: ct.artist,
            reason: 'From collective database'
          });
        });
      } catch {
        // Ignore
      }
    }

    return tracks;
  }

  private async getFallbackShadows(): Promise<ShadowSession[]> {
    const vibes: Array<{ id: string; name: string; vibe: VibeMode; trigger: string; blendSpeed: ShadowSession['blendSpeed'] }> = [
      { id: 'chill_shift', name: 'Chill Transition', vibe: 'chill-vibes', trigger: '2+ skips', blendSpeed: 'smooth' },
      { id: 'energy_boost', name: 'Energy Surge', vibe: 'party-mode', trigger: 'OYE reaction', blendSpeed: 'instant' },
      { id: 'deep_afro', name: 'Deep Afro', vibe: 'afro-heat', trigger: '3+ completes', blendSpeed: 'gradual' },
      { id: 'late_night', name: 'Late Night', vibe: 'late-night', trigger: 'Past 11pm', blendSpeed: 'gradual' },
      { id: 'discovery', name: 'Fresh Finds', vibe: 'random-mixer', trigger: 'Search', blendSpeed: 'smooth' }
    ];

    const shadows: ShadowSession[] = [];

    for (const v of vibes) {
      try {
        const centralTracks = await getTracksByMode(v.vibe as MixBoardMode, SHADOW_SESSION_SIZE);
        shadows.push({
          id: v.id,
          name: v.name,
          vibe: v.vibe,
          tracks: centralTracks.map(t => t.youtube_id),
          trigger: v.trigger,
          blendSpeed: v.blendSpeed
        });
      } catch {
        shadows.push({
          id: v.id,
          name: v.name,
          vibe: v.vibe,
          tracks: [],
          trigger: v.trigger,
          blendSpeed: v.blendSpeed
        });
      }
    }

    return shadows;
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Get the last Brain output
   */
  getLastOutput(): BrainOutput | null {
    return this.lastOutput;
  }

  /**
   * Force a new curation
   */
  async forceCurate(): Promise<BrainOutput | null> {
    const summary = signalBuffer.getSummary();
    return this.curate(summary);
  }

  /**
   * Check if currently processing
   */
  isWorking(): boolean {
    return this.isProcessing;
  }

  /**
   * Get next track from main queue
   */
  getNextTrack(currentIndex: number): BrainOutput['mainQueue']['tracks'][0] | null {
    if (!this.lastOutput?.mainQueue?.tracks) return null;
    const next = this.lastOutput.mainQueue.tracks[currentIndex + 1];
    return next || null;
  }

  /**
   * Get shadow session by trigger condition
   */
  getShadowForCondition(condition: 'skip_streak' | 'oye' | 'complete_streak' | 'late' | 'search'): ShadowSession | null {
    if (!this.lastOutput?.shadows) return null;

    const map: Record<string, string> = {
      'skip_streak': 'chill_shift',
      'oye': 'energy_boost',
      'complete_streak': 'deep_afro',
      'late': 'late_night',
      'search': 'discovery'
    };

    const shadowId = map[condition];
    return this.lastOutput.shadows.find(s => s.id === shadowId) || null;
  }

  /**
   * Get belt tracks
   */
  getHotBelt(): string[] {
    return this.lastOutput?.belts?.hot?.tracks || [];
  }

  getDiscoveryBelt(): string[] {
    return this.lastOutput?.belts?.discovery?.tracks || [];
  }

  /**
   * Get discovery queries for background fetching
   */
  getDiscoveryQueries(): string[] {
    return this.lastOutput?.discoveryQueries || [];
  }

  /**
   * Get learning insights
   */
  getLearning(): LearningUpdate | null {
    return this.lastOutput?.learning || null;
  }
}

// Singleton
export const voyoBrain = new VoyoBrain();

export default voyoBrain;

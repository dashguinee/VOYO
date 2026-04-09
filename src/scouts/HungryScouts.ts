/**
 * VOYO HUNGRY SCOUTS
 *
 * Parallel agents that aggressively discover African music on YouTube.
 * Each scout specializes in a genre/region and feeds knowledge to the Brain.
 *
 * Scout Philosophy:
 * - HUNGRY: Never stop looking
 * - PARALLEL: Many scouts, many searches
 * - SMART: Classify everything with moods/feelings
 * - FEEDING: Push to knowledge store, Brain reads from there
 */

import {
  PrimaryMood,
  FeelingTag,
  EnergyLevel,
  AfricanRegion,
  AfricanGenre,
  detectMoodFromText,
  estimateEnergy,
  MOOD_KEYWORDS
} from '../knowledge/MoodTags';
import {
  useKnowledgeStore,
  TrackKnowledge,
  ArtistKnowledge
} from '../knowledge/KnowledgeStore';

// ============================================
// SCOUT CONFIGURATION
// ============================================

interface ScoutConfig {
  id: string;
  name: string;
  region?: AfricanRegion;
  genre?: AfricanGenre;
  searchQueries: string[];
  artistKeywords: string[];
  moodBias?: PrimaryMood; // What mood this genre leans towards
  energyRange: [EnergyLevel, EnergyLevel];
  priority: number; // 1-10, higher = runs more often
}

// All the hungry scouts
export const SCOUT_CONFIGS: ScoutConfig[] = [
  // Nigerian Scouts
  {
    id: 'afrobeats-scout',
    name: 'Afrobeats Hunter',
    region: 'west-africa',
    genre: 'afrobeats',
    searchQueries: [
      'afrobeats 2024', 'afrobeats 2025', 'new afrobeats',
      'nigerian music 2024', 'naija songs', 'afrobeats hits',
      'burna boy', 'wizkid', 'davido', 'rema', 'asake',
      'ayra starr', 'tems', 'ckay', 'omah lay', 'fireboy dml'
    ],
    artistKeywords: ['burna', 'wizkid', 'davido', 'rema', 'asake', 'ayra', 'tems', 'ckay', 'omah', 'fireboy', 'joeboy', 'olamide', 'tiwa'],
    moodBias: 'energetic',
    energyRange: [3, 5],
    priority: 10
  },
  {
    id: 'alte-scout',
    name: 'Alte Scene Scout',
    region: 'west-africa',
    genre: 'alte',
    searchQueries: [
      'alte music', 'alte nigeria', 'santi music', 'odunsi music',
      'cruel santino', 'alte cruise', 'lagos alte'
    ],
    artistKeywords: ['santi', 'odunsi', 'lady donli', 'prettyboy'],
    moodBias: 'chill',
    energyRange: [2, 4],
    priority: 6
  },

  // South African Scouts
  {
    id: 'amapiano-scout',
    name: 'Amapiano Hunter',
    region: 'south-africa',
    genre: 'amapiano',
    searchQueries: [
      'amapiano 2024', 'amapiano 2025', 'new amapiano',
      'amapiano mix', 'amapiano hits', 'south african amapiano',
      'kabza de small', 'dj maphorisa', 'focalistic', 'uncle waffles'
    ],
    artistKeywords: ['kabza', 'maphorisa', 'focalistic', 'waffles', 'young stunna', 'vigro', 'kelvin momo'],
    moodBias: 'party',
    energyRange: [3, 5],
    priority: 9
  },
  {
    id: 'gqom-scout',
    name: 'Gqom Hunter',
    region: 'south-africa',
    genre: 'gqom',
    searchQueries: [
      'gqom music', 'gqom 2024', 'durban gqom',
      'babes wodumo', 'dj lag', 'gqom mix'
    ],
    artistKeywords: ['babes wodumo', 'dj lag', 'destruction boyz'],
    moodBias: 'aggressive',
    energyRange: [4, 5],
    priority: 7
  },

  // East African Scouts
  {
    id: 'bongo-scout',
    name: 'Bongo Flava Hunter',
    region: 'east-africa',
    genre: 'bongo-flava',
    searchQueries: [
      'bongo flava 2024', 'tanzanian music', 'bongo hits',
      'diamond platnumz', 'harmonize', 'zuchu', 'rayvanny'
    ],
    artistKeywords: ['diamond', 'harmonize', 'zuchu', 'rayvanny', 'nandy', 'mbosso', 'alikiba'],
    moodBias: 'romantic',
    energyRange: [3, 4],
    priority: 8
  },
  {
    id: 'gengetone-scout',
    name: 'Gengetone Hunter',
    region: 'east-africa',
    genre: 'gengetone',
    searchQueries: [
      'gengetone 2024', 'kenyan gengetone', 'ethic entertainment',
      'sailors gang', 'rekles', 'boondocks gang'
    ],
    artistKeywords: ['ethic', 'sailors', 'rekles', 'boondocks', 'trio mio'],
    moodBias: 'aggressive',
    energyRange: [4, 5],
    priority: 6
  },

  // Ghanaian Scouts
  {
    id: 'highlife-scout',
    name: 'Highlife Hunter',
    region: 'west-africa',
    genre: 'highlife',
    searchQueries: [
      'ghana highlife', 'highlife music', 'kuami eugene',
      'kidi', 'king promise', 'sarkodie', 'black sherif'
    ],
    artistKeywords: ['kuami', 'kidi', 'king promise', 'sarkodie', 'black sherif', 'stonebwoy', 'shatta wale'],
    moodBias: 'playful',
    energyRange: [3, 5],
    priority: 8
  },

  // Francophone Scouts
  {
    id: 'francophone-scout',
    name: 'Francophone Africa Hunter',
    region: 'francophone',
    genre: 'coupe-decale',
    searchQueries: [
      'musique africaine', 'coupé décalé', 'afro francophone',
      'fally ipupa', 'innoss b', 'gims', 'dadju', 'aya nakamura'
    ],
    artistKeywords: ['fally', 'innoss', 'gims', 'dadju', 'aya nakamura', 'niska', 'vegedream'],
    moodBias: 'party',
    energyRange: [3, 5],
    priority: 7
  },
  {
    id: 'ndombolo-scout',
    name: 'Ndombolo Hunter',
    region: 'central-africa',
    genre: 'ndombolo',
    searchQueries: [
      'ndombolo music', 'congolese rumba', 'ferre gola',
      'koffi olomide', 'papa wemba', 'fally ipupa'
    ],
    artistKeywords: ['ferre gola', 'koffi', 'papa wemba', 'fally ipupa', 'werrason'],
    moodBias: 'party',
    energyRange: [3, 5],
    priority: 6
  },

  // Gospel Scout
  {
    id: 'gospel-scout',
    name: 'African Gospel Hunter',
    region: 'west-africa',
    genre: 'african-gospel',
    searchQueries: [
      'african gospel', 'nigerian gospel', 'sinach', 'nathaniel bassey',
      'tim godfrey', 'mercy chinwo', 'ada ehi', 'south african gospel'
    ],
    artistKeywords: ['sinach', 'nathaniel bassey', 'tim godfrey', 'mercy chinwo', 'ada', 'frank edwards'],
    moodBias: 'spiritual',
    energyRange: [2, 5],
    priority: 7
  },

  // Classics Scout
  {
    id: 'classics-scout',
    name: 'African Classics Hunter',
    region: 'west-africa',
    searchQueries: [
      'african classic songs', 'old school african music',
      'fela kuti', 'king sunny ade', 'ebenezer obey',
      'youssou ndour', 'salif keita', 'miriam makeba',
      'african throwback', 'old naija music'
    ],
    artistKeywords: ['fela', 'sunny ade', 'ebenezer obey', 'youssou', 'salif keita', 'miriam makeba', '2face'],
    moodBias: 'nostalgic',
    energyRange: [2, 4],
    priority: 5
  },

  // Kizomba/Semba Scout
  {
    id: 'kizomba-scout',
    name: 'Kizomba Hunter',
    region: 'lusophone',
    genre: 'kizomba',
    searchQueries: [
      'kizomba 2024', 'kizomba music', 'semba music',
      'angolan music', 'nelson freitas', 'c4 pedro'
    ],
    artistKeywords: ['nelson freitas', 'c4 pedro', 'yola semedo', 'anselmo ralph'],
    moodBias: 'sensual',
    energyRange: [2, 3],
    priority: 6
  },

  // Afro House Scout
  {
    id: 'afrohouse-scout',
    name: 'Afro House Hunter',
    region: 'south-africa',
    genre: 'afro-house',
    searchQueries: [
      'afro house 2024', 'afro house mix', 'black coffee',
      'afro tech', 'melodic afro house', 'afro deep'
    ],
    artistKeywords: ['black coffee', 'da capo', 'enoo napa', 'caiiro'],
    moodBias: 'chill',
    energyRange: [3, 4],
    priority: 7
  }
];

// ============================================
// CLASSIFICATION ENGINE
// ============================================

interface ClassificationResult {
  primaryMood: PrimaryMood;
  feelings: FeelingTag[];
  energy: EnergyLevel;
  confidence: number;
}

export function classifyTrack(
  title: string,
  artistName: string,
  description?: string,
  config?: ScoutConfig
): ClassificationResult {
  const fullText = `${title} ${artistName} ${description || ''}`;

  // Detect moods from text
  const detectedMoods = detectMoodFromText(fullText);
  const primaryMood = detectedMoods[0] || config?.moodBias || 'energetic';

  // Estimate energy
  const energy = estimateEnergy(title, config?.genre);

  // Detect feeling tags
  const feelings = detectFeelings(fullText, primaryMood);

  // Calculate confidence
  const confidence = calculateConfidence(detectedMoods.length, feelings.length);

  return { primaryMood, feelings, energy, confidence };
}

function detectFeelings(text: string, mood: PrimaryMood): FeelingTag[] {
  const lowerText = text.toLowerCase();
  const feelings: FeelingTag[] = [];

  // Energy feelings
  if (['hype', 'fire', 'lit', 'turnt'].some(w => lowerText.includes(w))) {
    feelings.push('hype', 'lit');
  }
  if (['crazy', 'wild', 'mad'].some(w => lowerText.includes(w))) {
    feelings.push('wild');
  }

  // Chill feelings
  if (['chill', 'relax', 'easy'].some(w => lowerText.includes(w))) {
    feelings.push('mellow', 'easy');
  }
  if (['smooth', 'vibe'].some(w => lowerText.includes(w))) {
    feelings.push('smooth', 'floating');
  }

  // Love feelings
  if (['love', 'heart', 'baby'].some(w => lowerText.includes(w))) {
    feelings.push('in-love');
  }
  if (['miss', 'pain', 'hurt'].some(w => lowerText.includes(w))) {
    feelings.push('heartbreak', 'pain');
  }

  // Party feelings
  if (['party', 'dance', 'club'].some(w => lowerText.includes(w))) {
    feelings.push('dancing', 'celebration');
  }
  if (['turn up', 'go crazy'].some(w => lowerText.includes(w))) {
    feelings.push('euphoric');
  }

  // Spiritual feelings
  if (['god', 'lord', 'jesus', 'praise'].some(w => lowerText.includes(w))) {
    feelings.push('blessed', 'grateful', 'worship');
  }

  // Power feelings
  if (['boss', 'king', 'queen', 'champion'].some(w => lowerText.includes(w))) {
    feelings.push('boss', 'confident');
  }
  if (['win', 'success', 'legend'].some(w => lowerText.includes(w))) {
    feelings.push('winner', 'legendary');
  }

  // Intimate feelings
  if (['body', 'touch', 'slow wine', 'waist'].some(w => lowerText.includes(w))) {
    feelings.push('sexy', 'slow-wine');
  }

  // Default based on mood
  if (feelings.length === 0) {
    const moodDefaults: Record<PrimaryMood, FeelingTag[]> = {
      energetic: ['hype', 'fire'],
      chill: ['mellow', 'smooth'],
      romantic: ['in-love', 'devotion'],
      party: ['dancing', 'vibing'],
      spiritual: ['blessed', 'grateful'],
      melancholic: ['pain', 'missing'],
      triumphant: ['winner', 'confident'],
      nostalgic: ['memories', 'throwback'],
      sensual: ['intimate', 'slow-wine'],
      aggressive: ['raw', 'street'],
      peaceful: ['mellow', 'floating'],
      playful: ['vibing', 'dancing']
    };
    feelings.push(...(moodDefaults[mood] || ['vibing']));
  }

  return feelings.slice(0, 5); // Max 5 feelings
}

function calculateConfidence(moodMatches: number, feelingMatches: number): number {
  // Base confidence
  let confidence = 0.5;

  // More mood matches = higher confidence
  confidence += moodMatches * 0.1;

  // More feeling matches = higher confidence
  confidence += feelingMatches * 0.05;

  return Math.min(1, confidence);
}

// ============================================
// HUNGRY SCOUT CLASS
// ============================================

export class HungryScout {
  config: ScoutConfig;
  isRunning: boolean = false;
  lastRun: number = 0;
  tracksFound: number = 0;
  artistsFound: number = 0;

  constructor(config: ScoutConfig) {
    this.config = config;
  }

  // Extract artist from title (common patterns)
  extractArtist(title: string): { artist: string; cleanTitle: string } {
    // Pattern: "Artist - Title"
    const dashMatch = title.match(/^([^-]+)\s*-\s*(.+)$/);
    if (dashMatch) {
      return { artist: dashMatch[1].trim(), cleanTitle: dashMatch[2].trim() };
    }

    // Pattern: "Title (Artist)"
    const parenMatch = title.match(/^(.+)\s*\(([^)]+)\)$/);
    if (parenMatch) {
      return { artist: parenMatch[2].trim(), cleanTitle: parenMatch[1].trim() };
    }

    // Pattern: "Title by Artist"
    const byMatch = title.match(/^(.+)\s+by\s+(.+)$/i);
    if (byMatch) {
      return { artist: byMatch[2].trim(), cleanTitle: byMatch[1].trim() };
    }

    // Pattern: "Title ft. Artist"
    const ftMatch = title.match(/^(.+?)\s*(ft\.?|feat\.?|featuring)\s+(.+)$/i);
    if (ftMatch) {
      return { artist: ftMatch[1].trim(), cleanTitle: title };
    }

    // Check for known artist keywords
    for (const keyword of this.config.artistKeywords) {
      if (title.toLowerCase().includes(keyword.toLowerCase())) {
        return { artist: keyword, cleanTitle: title };
      }
    }

    return { artist: 'Unknown Artist', cleanTitle: title };
  }

  // Process a discovered video
  processDiscovery(
    videoId: string,
    title: string,
    channelName: string,
    description?: string
  ): TrackKnowledge | null {
    // Extract artist
    const { artist, cleanTitle } = this.extractArtist(title);
    const artistName = artist !== 'Unknown Artist' ? artist : channelName;

    // Skip if it's a mix, compilation, or live
    const lowerTitle = title.toLowerCase();
    if (['mix', 'compilation', 'live performance', 'concert', 'mashup'].some(w => lowerTitle.includes(w))) {
      return null;
    }

    // Classify the track
    const classification = classifyTrack(cleanTitle, artistName, description, this.config);

    // Create track knowledge
    const track: TrackKnowledge = {
      id: videoId,
      title: cleanTitle,
      artistId: artistName.toLowerCase().replace(/\s+/g, '-'),
      artistName,
      primaryMood: classification.primaryMood,
      feelings: classification.feelings,
      energy: classification.energy,
      region: this.config.region,
      genre: this.config.genre,
      isClassic: this.config.id === 'classics-scout',
      isTrending: true, // Assume discovered tracks are trending
      discoveredAt: Date.now(),
      classifiedAt: Date.now(),
      confidence: classification.confidence,
      // Canon system defaults (will be enriched by canonizer)
      canonLevel: this.config.id === 'classics-scout' ? 'ARCHIVE' : 'ECHO',
      culturalTags: [],  // Will be enriched by canonizer
    };

    return track;
  }

  // Scout YouTube for tracks
  async hunt(): Promise<TrackKnowledge[]> {
    if (this.isRunning) return [];

    this.isRunning = true;
    this.lastRun = Date.now();
    const discoveredTracks: TrackKnowledge[] = [];

    console.log(`[Scout:${this.config.name}] Starting hunt...`);

    try {
      // For each search query, fetch results
      for (const query of this.config.searchQueries) {
        const tracks = await this.searchYouTube(query);
        discoveredTracks.push(...tracks);

        // Small delay between searches to be nice
        await new Promise(r => setTimeout(r, 100));
      }

      this.tracksFound += discoveredTracks.length;
      console.log(`[Scout:${this.config.name}] Found ${discoveredTracks.length} tracks`);

      // Feed to knowledge store
      const store = useKnowledgeStore.getState();
      store.addTracks(discoveredTracks);

      // Record discovery
      store.recordDiscovery({
        scoutId: this.config.id,
        scoutType: this.config.name,
        timestamp: Date.now(),
        tracksFound: discoveredTracks.length,
        artistsFound: new Set(discoveredTracks.map(t => t.artistId)).size,
        region: this.config.region,
        genre: this.config.genre
      });

    } catch (error) {
      console.error(`[Scout:${this.config.name}] Error:`, error);
    } finally {
      this.isRunning = false;
    }

    return discoveredTracks;
  }

  // Search YouTube (using existing search service)
  private async searchYouTube(query: string): Promise<TrackKnowledge[]> {
    const tracks: TrackKnowledge[] = [];

    try {
      // Use the existing YouTube search
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?` +
        `part=snippet&type=video&videoCategoryId=10&maxResults=25&` +
        `q=${encodeURIComponent(query)}&key=${import.meta.env.VITE_YOUTUBE_API_KEY}`
      );

      if (!response.ok) return tracks;

      const data = await response.json();
      const items = data.items || [];

      for (const item of items) {
        const track = this.processDiscovery(
          item.id.videoId,
          item.snippet.title,
          item.snippet.channelTitle,
          item.snippet.description
        );
        if (track) {
          tracks.push(track);
        }
      }
    } catch (error) {
      console.warn(`[Scout:${this.config.name}] Search failed for "${query}":`, error);
    }

    return tracks;
  }
}

// ============================================
// SCOUT MANAGER
// ============================================

class ScoutManager {
  private scouts: Map<string, HungryScout> = new Map();
  private isRunning: boolean = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Initialize all scouts
    for (const config of SCOUT_CONFIGS) {
      this.scouts.set(config.id, new HungryScout(config));
    }
  }

  // Get a specific scout
  getScout(id: string): HungryScout | undefined {
    return this.scouts.get(id);
  }

  // Get all scouts
  getAllScouts(): HungryScout[] {
    return Array.from(this.scouts.values());
  }

  // Run a single scout
  async runScout(id: string): Promise<TrackKnowledge[]> {
    const scout = this.scouts.get(id);
    if (!scout) return [];
    return scout.hunt();
  }

  // Run all scouts in parallel
  async runAllScouts(): Promise<TrackKnowledge[]> {
    const allTracks: TrackKnowledge[] = [];

    console.log('[ScoutManager] Releasing ALL hungry scouts...');

    // Run in parallel batches (to not overload)
    const batchSize = 3;
    const scoutArray = Array.from(this.scouts.values());

    for (let i = 0; i < scoutArray.length; i += batchSize) {
      const batch = scoutArray.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(s => s.hunt()));
      results.forEach(tracks => allTracks.push(...tracks));
    }

    console.log(`[ScoutManager] Total tracks discovered: ${allTracks.length}`);
    return allTracks;
  }

  // Run high-priority scouts only
  async runPriorityScouts(minPriority: number = 7): Promise<TrackKnowledge[]> {
    const allTracks: TrackKnowledge[] = [];

    const priorityScouts = Array.from(this.scouts.values())
      .filter(s => s.config.priority >= minPriority);

    console.log(`[ScoutManager] Running ${priorityScouts.length} priority scouts...`);

    const results = await Promise.all(priorityScouts.map(s => s.hunt()));
    results.forEach(tracks => allTracks.push(...tracks));

    return allTracks;
  }

  // Start continuous scouting (runs periodically)
  startContinuousScouting(intervalMinutes: number = 30) {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log(`[ScoutManager] Starting continuous scouting every ${intervalMinutes} minutes`);

    // Run immediately
    this.runPriorityScouts();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.runPriorityScouts();
    }, intervalMinutes * 60 * 1000);
  }

  // Stop continuous scouting
  stopContinuousScouting() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[ScoutManager] Stopped continuous scouting');
  }

  // Get stats
  getStats() {
    const scouts = Array.from(this.scouts.values());
    return {
      totalScouts: scouts.length,
      activeScouts: scouts.filter(s => s.isRunning).length,
      totalTracksFound: scouts.reduce((sum, s) => sum + s.tracksFound, 0),
      totalArtistsFound: scouts.reduce((sum, s) => sum + s.artistsFound, 0),
      isRunning: this.isRunning
    };
  }
}

// Singleton instance
export const scoutManager = new ScoutManager();

// ============================================
// CONVENIENCE EXPORTS
// ============================================

export async function unleashScouts(): Promise<TrackKnowledge[]> {
  return scoutManager.runAllScouts();
}

export async function runPriorityScouts(): Promise<TrackKnowledge[]> {
  return scoutManager.runPriorityScouts();
}

export function startScoutPatrol(intervalMinutes: number = 30) {
  scoutManager.startContinuousScouting(intervalMinutes);
}

export function stopScoutPatrol() {
  scoutManager.stopContinuousScouting();
}

export function getScoutStats() {
  return scoutManager.getStats();
}

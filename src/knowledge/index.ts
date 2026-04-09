/**
 * VOYO Knowledge Module
 *
 * The Brain's knowledge layer - pre-classified music intelligence.
 * Brain reads, Scouts write. No searching, just knowing.
 */

// ============================================
// MOOD TAGS AND TYPES
// ============================================

export type {
  PrimaryMood,
  FeelingTag,
  EnergyLevel,
  AfricanRegion,
  AfricanGenre,
  VibeProfile,
  // Canon system types
  ArtistTier,
  CanonLevel,
  CulturalTag,
  AestheticTag,
  ContentType,
  MusicalEra,
  CanonScore,
  QuickScore,
} from './MoodTags';

export {
  VIBE_PROFILES,
  MOOD_KEYWORDS,
  CULTURAL_TAG_KEYWORDS,
  TIER_A_ARTISTS,
  detectMoodFromText,
  estimateEnergy,
  getCompatibleMoods,
  detectCulturalTags,
  estimateArtistTier,
  estimateCanonLevel,
} from './MoodTags';

// ============================================
// KNOWLEDGE STORE
// ============================================

export type {
  TrackKnowledge,
  ArtistKnowledge,
  VibeClustersEntry,
  ScoutDiscovery,
} from './KnowledgeStore';

export {
  useKnowledgeStore,
  getKnowledgeStats,
  findTracksByVibeProfile,
} from './KnowledgeStore';

// ============================================
// KNOWLEDGE LOADER
// ============================================

export { useKnowledgeLoader } from './useKnowledgeLoader';

// ============================================
// ARTIST TIER SYSTEM
// ============================================

export {
  getArtistTier,
  getArtistInfo,
  getCanonLevel,
  getAllVerifiedArtists,
} from './artistTiers';
// ArtistTier type already exported from MoodTags above

// ============================================
// QUICK ACCESS HELPERS
// ============================================

import { useKnowledgeStore } from './KnowledgeStore';
import type { CanonLevel, ArtistTier, CulturalTag } from './MoodTags';

/**
 * Get tracks by canon level with optional limit
 */
export function getTracksByCanon(level: CanonLevel, limit = 50) {
  return useKnowledgeStore.getState().findTracksByCanon(level, limit);
}

/**
 * Get artists by tier
 */
export function getArtistsByTier(tier: ArtistTier, limit = 50) {
  return useKnowledgeStore.getState().findArtistsByTier(tier, limit);
}

/**
 * Get echo tracks (hidden gems)
 */
export function getEchoTracks(limit = 50) {
  return useKnowledgeStore.getState().findEchoTracks(limit);
}

/**
 * Get tracks by cultural tag
 */
export function getTracksByCulturalTag(tag: CulturalTag, limit = 50) {
  return useKnowledgeStore.getState().findTracksByCulturalTag(tag, limit);
}

/**
 * Get CORE tracks (essential listening)
 */
export function getCoreTracks(limit = 50) {
  return getTracksByCanon('CORE', limit);
}

/**
 * Get A-tier artists (global icons)
 */
export function getGlobalIcons(limit = 50) {
  return getArtistsByTier('A', limit);
}

/**
 * Get liberation/revolution tracks
 */
export function getLiberationTracks(limit = 50) {
  const liberation = getTracksByCulturalTag('liberation', limit);
  const revolution = getTracksByCulturalTag('revolution', limit);
  const protest = getTracksByCulturalTag('protest', limit);

  // Dedupe
  const seen = new Set<string>();
  return [...liberation, ...revolution, ...protest].filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  }).slice(0, limit);
}

/**
 * Get tracks for Classic page sections
 */
export function getClassicPageData() {
  const store = useKnowledgeStore.getState();

  return {
    core: store.findTracksByCanon('CORE', 20),
    essential: store.findTracksByCanon('ESSENTIAL', 20),
    deepCuts: store.findTracksByCanon('DEEP_CUT', 20),
    archive: store.findTracksByCanon('ARCHIVE', 20),
    echoes: store.findEchoTracks(20),
    liberation: getLiberationTracks(10),
    globalIcons: store.findArtistsByTier('A', 10),
    risingStars: store.findArtistsByTier('B', 10),
  };
}

/**
 * Get knowledge stats
 */
export function getStats() {
  return useKnowledgeStore.getState().getStats();
}

/**
 * Check if knowledge is loaded
 */
export function isKnowledgeLoaded() {
  const stats = getStats();
  return stats.totalTracks > 0;
}

/**
 * Get track by ID
 */
export function getTrack(id: string) {
  return useKnowledgeStore.getState().getTrack(id);
}

/**
 * Get artist by ID
 */
export function getArtist(id: string) {
  return useKnowledgeStore.getState().getArtist(id);
}

/**
 * Get artist by name (fuzzy)
 */
export function getArtistByName(name: string) {
  return useKnowledgeStore.getState().getArtistByName(name);
}

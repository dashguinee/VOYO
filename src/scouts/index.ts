/**
 * VOYO Scouts - Knowledge Discovery System
 *
 * Hungry scouts that discover African music and feed knowledge to the Brain.
 */

// Scout exports
export {
  HungryScout,
  SCOUT_CONFIGS,
  scoutManager,
  unleashScouts,
  runPriorityScouts,
  startScoutPatrol,
  stopScoutPatrol,
  getScoutStats,
  classifyTrack
} from './HungryScouts';

// Knowledge integration exports
export {
  getKnowledgeCuratedTracks,
  getTracksByMixMode,
  getShadowSessionTracks,
  enrichTrackWithKnowledge,
  syncKnowledgeToPool,
  getKnowledgeRecommendations,
  createMoodJourney,
  getTracksForJourney,
  getKnowledgeStats,
  hasKnowledge,
  getKnowledgeCount
} from './KnowledgeIntegration';

// Database feeding exports
export {
  feedTrackToDatabase,
  feedTracksToDatabase,
  unleashAndFeed,
  feedPriorityScouts,
  syncKnowledgeToDatabase,
  getDatabaseStats,
  searchAndFeed,
  bulkSearchAndFeed,
  buildAfricanMusicDatabase
} from './DatabaseFeeder';

// Types re-export
export type { TrackKnowledge, ArtistKnowledge } from '../knowledge/KnowledgeStore';

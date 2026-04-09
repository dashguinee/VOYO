/**
 * VOYO Intent Engine - Debug & Verification Utilities
 * Run these to verify the scoring system works correctly
 */

import { TRACKS } from '../data/tracks';
import { MODE_KEYWORDS, matchTrackToMode, VibeMode } from '../store/intentStore';
import { calculateIntentScore, calculateBehaviorScore, getTracksByMode } from '../services/personalization';

// ============================================
// KEYWORD MATCHING VERIFICATION
// ============================================

/**
 * Test how well our MODE_KEYWORDS match the actual TRACKS
 */
export function verifyKeywordMatching(): void {
  console.log('\n========================================');
  console.log('🔍 KEYWORD MATCHING VERIFICATION');
  console.log('========================================\n');

  const modeMatches: Record<VibeMode, string[]> = {
    'afro-heat': [],
    'chill-vibes': [],
    'party-mode': [],
    'late-night': [],
    'workout': [],
    'random-mixer': [],
  };

  // Test each track
  TRACKS.forEach((track) => {
    const matchedMode = matchTrackToMode({
      title: track.title,
      artist: track.artist,
      tags: track.tags,
      mood: track.mood,
    });

    modeMatches[matchedMode].push(`${track.artist} - ${track.title}`);
  });

  // Print results
  Object.entries(modeMatches).forEach(([mode, tracks]) => {
    console.log(`\n📁 ${mode.toUpperCase()} (${tracks.length} tracks):`);
    if (tracks.length === 0) {
      console.log('   ⚠️  NO MATCHES - Keywords need adjustment!');
    } else {
      tracks.forEach((t) => console.log(`   • ${t}`));
    }
  });

  // Summary
  const unmatched = modeMatches['random-mixer'].length;
  const total = TRACKS.length;
  const matchRate = ((total - unmatched) / total * 100).toFixed(1);

  console.log('\n========================================');
  console.log(`📊 MATCH RATE: ${matchRate}% (${total - unmatched}/${total} tracks matched)`);
  console.log(`⚠️  Unmatched (fell to random-mixer): ${unmatched}`);
  console.log('========================================\n');
}

/**
 * Show which keywords are actually matching
 */
export function debugKeywordHits(): void {
  console.log('\n========================================');
  console.log('🎯 KEYWORD HIT ANALYSIS');
  console.log('========================================\n');

  const keywordHits: Record<string, number> = {};

  TRACKS.forEach((track) => {
    const searchText = `${track.title} ${track.artist} ${track.tags?.join(' ') || ''} ${track.mood || ''}`.toLowerCase();

    Object.entries(MODE_KEYWORDS).forEach(([mode, keywords]) => {
      keywords.forEach((kw) => {
        if (searchText.includes(kw.toLowerCase())) {
          const key = `${mode}:${kw}`;
          keywordHits[key] = (keywordHits[key] || 0) + 1;
        }
      });
    });
  });

  // Sort by hits
  const sorted = Object.entries(keywordHits).sort((a, b) => b[1] - a[1]);

  console.log('Keywords that matched (sorted by hits):');
  sorted.forEach(([key, hits]) => {
    console.log(`   ${key}: ${hits} hits`);
  });

  // Find keywords with ZERO hits
  console.log('\n⚠️  Keywords with ZERO matches:');
  Object.entries(MODE_KEYWORDS).forEach(([mode, keywords]) => {
    keywords.forEach((kw) => {
      const key = `${mode}:${kw}`;
      if (!keywordHits[key]) {
        console.log(`   ${key}`);
      }
    });
  });
}

// ============================================
// SCORING SYSTEM VERIFICATION
// ============================================

/**
 * Test scoring with different intent configurations
 */
export function verifyScoring(): void {
  console.log('\n========================================');
  console.log('📈 SCORING SYSTEM VERIFICATION');
  console.log('========================================\n');

  // Test intent scores for all tracks
  console.log('Intent Scores (based on current MixBoard state):');

  TRACKS.slice(0, 5).forEach((track) => {
    const intentScore = calculateIntentScore(track);
    const behaviorScore = calculateBehaviorScore(track, {});
    const mode = matchTrackToMode({
      title: track.title,
      artist: track.artist,
      tags: track.tags,
      mood: track.mood,
    });

    console.log(`\n   ${track.artist} - ${track.title}`);
    console.log(`   Mode: ${mode}`);
    console.log(`   Intent Score: ${intentScore.toFixed(2)}`);
    console.log(`   Behavior Score: ${behaviorScore.toFixed(2)}`);
    console.log(`   Combined (60/40): ${(intentScore * 0.6 + behaviorScore * 0.4).toFixed(2)}`);
  });
}

/**
 * Test getTracksByMode function
 */
export function verifyModeRetrieval(): void {
  console.log('\n========================================');
  console.log('🎵 MODE RETRIEVAL VERIFICATION');
  console.log('========================================\n');

  const modes: VibeMode[] = ['afro-heat', 'chill-vibes', 'party-mode', 'late-night', 'workout', 'random-mixer'];

  modes.forEach((mode) => {
    const tracks = getTracksByMode(mode, 3);
    console.log(`\n${mode.toUpperCase()}:`);
    tracks.forEach((t) => console.log(`   • ${t.artist} - ${t.title}`));
  });
}

// ============================================
// RUN ALL VERIFICATIONS
// ============================================

export function runAllVerifications(): void {
  console.log('\n🚀 VOYO INTENT ENGINE - FULL VERIFICATION\n');

  verifyKeywordMatching();
  debugKeywordHits();
  verifyScoring();
  verifyModeRetrieval();

  console.log('\n✅ Verification complete!\n');
}

// Export for browser console access
if (typeof window !== 'undefined') {
  (window as any).voyoDebug = {
    verifyKeywordMatching,
    debugKeywordHits,
    verifyScoring,
    verifyModeRetrieval,
    runAllVerifications,
  };
  console.log('🔧 VOYO Debug tools loaded. Run: voyoDebug.runAllVerifications()');
}

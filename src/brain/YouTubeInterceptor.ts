/**
 * VOYO Brain - YouTube Interceptor
 *
 * Captures YouTube's related video recommendations as free intelligence.
 * When we play a track, YouTube suggests related content - we grab that!
 *
 * Key Features:
 * 1. Capture related videos from YouTube player
 * 2. Track recurring recommendations (high signal)
 * 3. Detect video types (track, mix, live, remix)
 * 4. Detect vibe from title/keywords
 * 5. Feed everything to the Brain
 *
 * Philosophy: YouTube's algorithm is free - use it!
 */

import { signals } from './SignalEmitter';

// ============================================
// TYPES
// ============================================

export interface YouTubeRecommendation {
  videoId: string;
  title: string;
  channelName?: string;
  duration?: number; // seconds
  viewCount?: number;
  detectedType: 'track' | 'mix' | 'live' | 'remix';
  detectedVibe?: string;
  position: number; // Position in related list (1 = most relevant)
  capturedFrom: string; // Source track ID
  capturedAt: string;
}

export interface RecurringTrack {
  videoId: string;
  title: string;
  detectedType: 'track' | 'mix' | 'live' | 'remix';
  detectedVibe?: string;
  count: number; // How many times recommended
  positions: number[]; // All positions seen
  avgPosition: number;
  lastSeen: string;
  sourceTrackIds: string[];
}

// ============================================
// CONSTANTS
// ============================================

// Keywords for type detection
const MIX_KEYWORDS = ['mix', 'mixtape', 'set', 'session', 'playlist', 'hour', 'minutes', 'non stop', 'nonstop', 'compilation'];
const LIVE_KEYWORDS = ['live', 'concert', 'festival', 'performance', 'show', 'tour'];
const REMIX_KEYWORDS = ['remix', 'cover', 'version', 'edit', 'bootleg'];

// Keywords for vibe detection
const VIBE_KEYWORDS: Record<string, string[]> = {
  'afro-heat': ['afrobeats', 'afrobeat', 'amapiano', 'naija', 'african', 'lagos', 'nigeria', 'ghana'],
  'chill-vibes': ['chill', 'relax', 'smooth', 'slow', 'calm', 'acoustic', 'rnb', 'r&b', 'soul'],
  'party-mode': ['party', 'club', 'dance', 'turn up', 'lit', 'banger', 'hype', 'energy'],
  'late-night': ['night', 'late', 'midnight', 'dark', 'moody', 'feels', 'sad', 'emotional'],
  'workout': ['workout', 'gym', 'fitness', 'pump', 'motivation', 'power', 'beast']
};

// ============================================
// YOUTUBE INTERCEPTOR CLASS
// ============================================

class YouTubeInterceptor {
  private recentRecs: Map<string, YouTubeRecommendation[]> = new Map();
  private recurringTracker: Map<string, RecurringTrack> = new Map();
  private maxRecsPerSource: number = 20;
  private maxSources: number = 50;

  constructor() {
    console.log('[Brain] YouTubeInterceptor initialized');
  }

  // ============================================
  // DETECTION HELPERS
  // ============================================

  /**
   * Detect video type from title
   */
  private detectType(title: string): YouTubeRecommendation['detectedType'] {
    const lowerTitle = title.toLowerCase();

    // Check for mix (longest duration indicator)
    for (const keyword of MIX_KEYWORDS) {
      if (lowerTitle.includes(keyword)) return 'mix';
    }

    // Check duration indicators (1 hour+, 45 min+, etc)
    if (/\d+\s*(hour|hr|h)\b/i.test(lowerTitle) || /[4-9]\d\s*min/i.test(lowerTitle)) {
      return 'mix';
    }

    // Check for live
    for (const keyword of LIVE_KEYWORDS) {
      if (lowerTitle.includes(keyword)) return 'live';
    }

    // Check for remix
    for (const keyword of REMIX_KEYWORDS) {
      if (lowerTitle.includes(keyword)) return 'remix';
    }

    return 'track';
  }

  /**
   * Detect vibe from title
   */
  private detectVibe(title: string): string | undefined {
    const lowerTitle = title.toLowerCase();

    for (const [vibe, keywords] of Object.entries(VIBE_KEYWORDS)) {
      for (const keyword of keywords) {
        if (lowerTitle.includes(keyword)) return vibe;
      }
    }

    return undefined;
  }

  /**
   * Parse duration string (e.g., "3:45" or "1:02:30") to seconds
   */
  private parseDuration(durationStr?: string): number | undefined {
    if (!durationStr) return undefined;

    const parts = durationStr.split(':').map(Number);
    if (parts.some(isNaN)) return undefined;

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return undefined;
  }

  // ============================================
  // MAIN CAPTURE METHOD
  // ============================================

  /**
   * Capture recommendations from YouTube player
   * Call this when related videos are loaded
   */
  captureRecommendations(
    sourceTrackId: string,
    related: Array<{
      id?: string;
      videoId?: string;
      title: string;
      channelName?: string;
      duration?: string;
      viewCount?: number | string;
    }>
  ): void {
    const now = new Date().toISOString();

    const recommendations: YouTubeRecommendation[] = related.map((r, i) => ({
      videoId: r.id || r.videoId || '',
      title: r.title,
      channelName: r.channelName,
      duration: this.parseDuration(r.duration),
      viewCount: typeof r.viewCount === 'string' ? parseInt(r.viewCount.replace(/,/g, '')) : r.viewCount,
      detectedType: this.detectType(r.title),
      detectedVibe: this.detectVibe(r.title),
      position: i + 1,
      capturedFrom: sourceTrackId,
      capturedAt: now
    })).filter(r => r.videoId); // Filter out empty IDs

    if (recommendations.length === 0) {
      console.log('[Brain] No valid recommendations to capture');
      return;
    }

    // Store by source
    this.recentRecs.set(sourceTrackId, recommendations.slice(0, this.maxRecsPerSource));

    // Trim old sources
    if (this.recentRecs.size > this.maxSources) {
      const oldestKey = this.recentRecs.keys().next().value;
      if (oldestKey) this.recentRecs.delete(oldestKey);
    }

    // Track recurring recommendations
    recommendations.forEach(rec => {
      const existing = this.recurringTracker.get(rec.videoId);

      if (existing) {
        existing.count++;
        existing.positions.push(rec.position);
        existing.avgPosition = existing.positions.reduce((a, b) => a + b, 0) / existing.positions.length;
        existing.lastSeen = now;
        if (!existing.sourceTrackIds.includes(sourceTrackId)) {
          existing.sourceTrackIds.push(sourceTrackId);
        }
      } else {
        this.recurringTracker.set(rec.videoId, {
          videoId: rec.videoId,
          title: rec.title,
          detectedType: rec.detectedType,
          detectedVibe: rec.detectedVibe,
          count: 1,
          positions: [rec.position],
          avgPosition: rec.position,
          lastSeen: now,
          sourceTrackIds: [sourceTrackId]
        });
      }
    });

    // Emit signals
    signals.youtubeRecommendations(sourceTrackId, recommendations.map(r => ({
      videoId: r.videoId,
      title: r.title,
      duration: r.duration,
      detectedType: r.detectedType,
      detectedVibe: r.detectedVibe,
      position: r.position
    })));

    // Emit recurring signal for high-frequency tracks
    const recurring = this.getRecurring(3); // Tracks seen 3+ times
    if (recurring.length > 0) {
      signals.youtubeRecurring(sourceTrackId, recurring.map(r => ({
        videoId: r.videoId,
        count: r.count,
        positions: r.positions
      })));
    }

    console.log(`[Brain] Captured ${recommendations.length} recommendations from ${sourceTrackId}, ${recurring.length} recurring`);
  }

  // ============================================
  // QUERY METHODS
  // ============================================

  /**
   * Get recommendations for a source track
   */
  getRecommendationsFor(sourceTrackId: string): YouTubeRecommendation[] {
    return this.recentRecs.get(sourceTrackId) || [];
  }

  /**
   * Get all recurring tracks above threshold
   */
  getRecurring(minCount: number = 2): RecurringTrack[] {
    return Array.from(this.recurringTracker.values())
      .filter(r => r.count >= minCount)
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get top recurring tracks
   */
  getTopRecurring(limit: number = 10): RecurringTrack[] {
    return Array.from(this.recurringTracker.values())
      .sort((a, b) => {
        // Score by count and average position (lower position = more relevant)
        const scoreA = a.count * (21 - Math.min(a.avgPosition, 20));
        const scoreB = b.count * (21 - Math.min(b.avgPosition, 20));
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  /**
   * Get recommended mixes (30+ minutes)
   */
  getRecommendedMixes(limit: number = 5): RecurringTrack[] {
    return Array.from(this.recurringTracker.values())
      .filter(r => r.detectedType === 'mix')
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get recommendations by vibe
   */
  getByVibe(vibe: string, limit: number = 10): RecurringTrack[] {
    return Array.from(this.recurringTracker.values())
      .filter(r => r.detectedVibe === vibe)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Check if a video ID has been recommended before
   */
  hasBeenRecommended(videoId: string): RecurringTrack | null {
    return this.recurringTracker.get(videoId) || null;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalSources: number;
    totalRecurring: number;
    highSignalCount: number;
    mixesFound: number;
    topVibe: string | null;
  } {
    const recurring = Array.from(this.recurringTracker.values());
    const highSignal = recurring.filter(r => r.count >= 3);
    const mixes = recurring.filter(r => r.detectedType === 'mix');

    // Count vibes
    const vibeCounts: Record<string, number> = {};
    recurring.forEach(r => {
      if (r.detectedVibe) {
        vibeCounts[r.detectedVibe] = (vibeCounts[r.detectedVibe] || 0) + r.count;
      }
    });

    const topVibe = Object.entries(vibeCounts)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

    return {
      totalSources: this.recentRecs.size,
      totalRecurring: recurring.length,
      highSignalCount: highSignal.length,
      mixesFound: mixes.length,
      topVibe
    };
  }

  /**
   * Clear old data
   */
  clearOld(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

    for (const [id, rec] of this.recurringTracker) {
      if (rec.lastSeen < cutoff) {
        this.recurringTracker.delete(id);
      }
    }

    console.log(`[Brain] Cleared old recommendations, ${this.recurringTracker.size} remaining`);
  }

  /**
   * Reset all data
   */
  reset(): void {
    this.recentRecs.clear();
    this.recurringTracker.clear();
    console.log('[Brain] YouTubeInterceptor reset');
  }
}

// Singleton
export const youtubeInterceptor = new YouTubeInterceptor();

export default youtubeInterceptor;

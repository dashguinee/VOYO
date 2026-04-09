/**
 * VOYO Moments Service
 *
 * Manages short-form video clips (15-60s) that promote full songs.
 * Like TikTok sounds - clip plays, user taps to hear full track.
 *
 * Flow:
 * 1. Moments Discovery finds viral clips (Instagram, TikTok, YouTube Shorts)
 * 2. Each moment links to a parent track in video_intelligence
 * 3. User swipes through moments in feed
 * 4. Tapping "Play Full Song" opens the real track
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';

// ============================================
// TYPES
// ============================================

export type MomentPlatform = 'youtube' | 'youtube_shorts' | 'instagram' | 'tiktok';

export type MomentContentType =
  | 'dance'
  | 'lip_sync'
  | 'reaction'
  | 'cover'
  | 'live'
  | 'comedy'
  | 'fashion'
  | 'sports'
  | 'tutorial'
  | 'original';

export type TrackMatchMethod = 'gemini' | 'audio_fingerprint' | 'manual' | 'user_tag';

export interface Moment {
  id: string;
  source_platform: MomentPlatform;
  source_id: string;
  source_url?: string;
  title: string;
  description?: string;
  creator_username?: string;
  creator_name?: string;
  thumbnail_url?: string;
  duration_seconds: number;
  hook_start_seconds: number;
  parent_track_id?: string;
  parent_track_title?: string;
  parent_track_artist?: string;
  track_match_confidence: number;
  track_match_method: TrackMatchMethod;
  content_type: MomentContentType;
  vibe_tags: string[];
  cultural_tags: string[];
  view_count: number;
  like_count: number;
  share_count: number;
  comment_count: number;
  voyo_plays: number;
  voyo_skips: number;
  voyo_full_song_taps: number;
  voyo_reactions: number;
  virality_score: number;
  conversion_rate: number;
  heat_score: number;
  discovered_at: string;
  discovered_by: string;
  verified: boolean;
  featured: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MomentInput {
  source_platform: MomentPlatform;
  source_id: string;
  source_url?: string;
  title: string;
  description?: string;
  creator_username?: string;
  creator_name?: string;
  thumbnail_url?: string;
  duration_seconds?: number;
  hook_start_seconds?: number;
  content_type?: MomentContentType;
  vibe_tags?: string[];
  cultural_tags?: string[];
  view_count?: number;
  like_count?: number;
  share_count?: number;
  comment_count?: number;
}

export interface MomentTrackLink {
  moment_id: string;
  track_id: string;
  starts_at_seconds: number;
  ends_at_seconds?: number;
  is_primary: boolean;
  match_confidence: number;
  match_method: TrackMatchMethod;
}

export interface MomentStats {
  total_moments: number;
  linked_moments: number;
  verified_moments: number;
  featured_moments: number;
  total_plays: number;
  total_full_song_taps: number;
  avg_conversion_rate: number;
  unique_tracks_promoted: number;
}

// ============================================
// MOMENTS SERVICE
// ============================================

class MomentsService {
  private localCache: Map<string, Moment> = new Map();

  constructor() {
    console.log('[MomentsService] Initialized');
  }

  // ============================================
  // CREATE & UPDATE
  // ============================================

  /**
   * Create a new moment
   */
  async createMoment(input: MomentInput): Promise<Moment | null> {
    if (!supabase || !isSupabaseConfigured) {
      console.log('[MomentsService] Supabase not configured');
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('voyo_moments')
        .insert({
          source_platform: input.source_platform,
          source_id: input.source_id,
          source_url: input.source_url,
          title: input.title,
          description: input.description,
          creator_username: input.creator_username,
          creator_name: input.creator_name,
          thumbnail_url: input.thumbnail_url,
          duration_seconds: input.duration_seconds || 30,
          hook_start_seconds: input.hook_start_seconds || 0,
          content_type: input.content_type || 'dance',
          vibe_tags: input.vibe_tags || [],
          cultural_tags: input.cultural_tags || [],
          view_count: input.view_count || 0,
          like_count: input.like_count || 0,
          share_count: input.share_count || 0,
          comment_count: input.comment_count || 0,
        })
        .select()
        .single();

      if (error) {
        console.error('[MomentsService] Create error:', error.message);
        return null;
      }

      const moment = data as Moment;
      this.localCache.set(moment.id, moment);
      console.log(`[MomentsService] Created moment: ${moment.id} (${moment.title})`);
      return moment;
    } catch (err) {
      console.error('[MomentsService] Create error:', err);
      return null;
    }
  }

  /**
   * Link a moment to a parent track
   * Uses the database function for atomic update
   */
  async linkToTrack(
    momentId: string,
    trackId: string,
    confidence: number = 0.8,
    method: TrackMatchMethod = 'gemini'
  ): Promise<boolean> {
    if (!supabase || !isSupabaseConfigured) {
      return false;
    }

    try {
      const { data, error } = await supabase.rpc('link_moment_to_track', {
        p_moment_id: momentId,
        p_track_id: trackId,
        p_confidence: confidence,
        p_method: method,
      });

      if (error) {
        console.error('[MomentsService] Link error:', error.message);
        return false;
      }

      // Invalidate cache
      this.localCache.delete(momentId);

      console.log(`[MomentsService] Linked moment ${momentId} to track ${trackId}`);
      return data === true;
    } catch (err) {
      console.error('[MomentsService] Link error:', err);
      return false;
    }
  }

  // ============================================
  // READ
  // ============================================

  /**
   * Get a moment by ID
   */
  async getMoment(momentId: string): Promise<Moment | null> {
    // Check cache first
    const cached = this.localCache.get(momentId);
    if (cached) {
      return cached;
    }

    if (!supabase || !isSupabaseConfigured) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('voyo_moments')
        .select('*')
        .eq('id', momentId)
        .single();

      if (error || !data) {
        return null;
      }

      const moment = data as Moment;
      this.localCache.set(momentId, moment);
      return moment;
    } catch (err) {
      console.error('[MomentsService] Get error:', err);
      return null;
    }
  }

  /**
   * Get hot moments for feed
   * Uses the database function for optimized query
   */
  async getHotMoments(
    contentType?: MomentContentType,
    limit: number = 50
  ): Promise<Moment[]> {
    if (!supabase || !isSupabaseConfigured) {
      return [];
    }

    try {
      const { data, error } = await supabase.rpc('get_hot_moments', {
        p_content_type: contentType || null,
        p_limit: limit,
      });

      if (error) {
        console.error('[MomentsService] Get hot moments error:', error.message);
        // Fallback to direct query
        return this.getHotMomentsFallback(contentType, limit);
      }

      return (data || []) as Moment[];
    } catch (err) {
      console.error('[MomentsService] Get hot moments error:', err);
      return [];
    }
  }

  /**
   * Fallback for hot moments if RPC not available
   */
  private async getHotMomentsFallback(
    contentType?: MomentContentType,
    limit: number = 50
  ): Promise<Moment[]> {
    if (!supabase) return [];

    let query = supabase
      .from('voyo_moments')
      .select('*')
      .eq('is_active', true)
      .not('parent_track_id', 'is', null)
      .order('heat_score', { ascending: false })
      .limit(limit);

    if (contentType) {
      query = query.eq('content_type', contentType);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[MomentsService] Fallback query error:', error.message);
      return [];
    }

    return (data || []) as Moment[];
  }

  /**
   * Get moments for a specific track
   * Uses the database function
   */
  async getMomentsForTrack(trackId: string, limit: number = 20): Promise<Moment[]> {
    if (!supabase || !isSupabaseConfigured) {
      return [];
    }

    try {
      const { data, error } = await supabase.rpc('get_moments_for_track', {
        p_track_id: trackId,
        p_limit: limit,
      });

      if (error) {
        console.error('[MomentsService] Get moments for track error:', error.message);
        // Fallback to direct query
        return this.getMomentsForTrackFallback(trackId, limit);
      }

      return (data || []) as Moment[];
    } catch (err) {
      console.error('[MomentsService] Get moments for track error:', err);
      return [];
    }
  }

  /**
   * Fallback for moments by track
   */
  private async getMomentsForTrackFallback(
    trackId: string,
    limit: number = 20
  ): Promise<Moment[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('voyo_moments')
      .select('*')
      .eq('parent_track_id', trackId)
      .eq('is_active', true)
      .order('heat_score', { ascending: false })
      .limit(limit);

    if (error) {
      return [];
    }

    return (data || []) as Moment[];
  }

  /**
   * Get featured moments
   */
  async getFeaturedMoments(limit: number = 20): Promise<Moment[]> {
    if (!supabase || !isSupabaseConfigured) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('voyo_moments')
        .select('*')
        .eq('featured', true)
        .eq('is_active', true)
        .order('heat_score', { ascending: false })
        .limit(limit);

      if (error) {
        return [];
      }

      return (data || []) as Moment[];
    } catch (err) {
      console.error('[MomentsService] Get featured error:', err);
      return [];
    }
  }

  /**
   * Get moments by content type
   */
  async getMomentsByContentType(
    contentType: MomentContentType,
    limit: number = 50
  ): Promise<Moment[]> {
    if (!supabase || !isSupabaseConfigured) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('voyo_moments')
        .select('*')
        .eq('content_type', contentType)
        .eq('is_active', true)
        .order('heat_score', { ascending: false })
        .limit(limit);

      if (error) {
        return [];
      }

      return (data || []) as Moment[];
    } catch (err) {
      console.error('[MomentsService] Get by content type error:', err);
      return [];
    }
  }

  /**
   * Get recent moments
   */
  async getRecentMoments(limit: number = 50): Promise<Moment[]> {
    if (!supabase || !isSupabaseConfigured) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('voyo_moments')
        .select('*')
        .eq('is_active', true)
        .order('discovered_at', { ascending: false })
        .limit(limit);

      if (error) {
        return [];
      }

      return (data || []) as Moment[];
    } catch (err) {
      console.error('[MomentsService] Get recent error:', err);
      return [];
    }
  }

  /**
   * Search moments by vibe tags
   */
  async getMomentsByVibe(vibeTags: string[], limit: number = 50): Promise<Moment[]> {
    if (!supabase || !isSupabaseConfigured || vibeTags.length === 0) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('voyo_moments')
        .select('*')
        .eq('is_active', true)
        .overlaps('vibe_tags', vibeTags)
        .order('heat_score', { ascending: false })
        .limit(limit);

      if (error) {
        return [];
      }

      return (data || []) as Moment[];
    } catch (err) {
      console.error('[MomentsService] Get by vibe error:', err);
      return [];
    }
  }

  // ============================================
  // ENGAGEMENT TRACKING
  // ============================================

  /**
   * Record a moment play
   * Updates voyo_plays and optionally voyo_full_song_taps
   */
  async recordPlay(momentId: string, tappedFullSong: boolean = false): Promise<boolean> {
    if (!supabase || !isSupabaseConfigured) {
      return false;
    }

    try {
      const { data, error } = await supabase.rpc('record_moment_play', {
        p_moment_id: momentId,
        p_tapped_full_song: tappedFullSong,
      });

      if (error) {
        console.error('[MomentsService] Record play error:', error.message);
        // Fallback to direct update
        return this.recordPlayFallback(momentId, tappedFullSong);
      }

      // Invalidate cache
      this.localCache.delete(momentId);

      return data === true;
    } catch (err) {
      console.error('[MomentsService] Record play error:', err);
      return false;
    }
  }

  /**
   * Fallback for record play - uses direct update
   * The trigger will update heat_score automatically
   */
  private async recordPlayFallback(momentId: string, tappedFullSong: boolean): Promise<boolean> {
    if (!supabase) return false;

    try {
      // Get current values first
      const { data: current, error: fetchError } = await supabase
        .from('voyo_moments')
        .select('voyo_plays, voyo_full_song_taps')
        .eq('id', momentId)
        .single();

      if (fetchError || !current) {
        return false;
      }

      // Update with incremented values
      const { error } = await supabase
        .from('voyo_moments')
        .update({
          voyo_plays: (current.voyo_plays || 0) + 1,
          voyo_full_song_taps: tappedFullSong
            ? (current.voyo_full_song_taps || 0) + 1
            : current.voyo_full_song_taps,
        })
        .eq('id', momentId);

      return !error;
    } catch {
      return false;
    }
  }

  /**
   * Record a skip (user swiped away quickly)
   */
  async recordSkip(momentId: string): Promise<boolean> {
    if (!supabase || !isSupabaseConfigured) {
      return false;
    }

    try {
      // Get current value and increment
      const { data: current, error: fetchError } = await supabase
        .from('voyo_moments')
        .select('voyo_skips')
        .eq('id', momentId)
        .single();

      if (fetchError || !current) {
        console.error('[MomentsService] Record skip error:', fetchError?.message);
        return false;
      }

      const { error } = await supabase
        .from('voyo_moments')
        .update({
          voyo_skips: (current.voyo_skips || 0) + 1,
        })
        .eq('id', momentId);

      if (error) {
        console.error('[MomentsService] Record skip error:', error.message);
        return false;
      }

      // Invalidate cache
      this.localCache.delete(momentId);
      return true;
    } catch (err) {
      console.error('[MomentsService] Record skip error:', err);
      return false;
    }
  }

  /**
   * Record a reaction (heart, fire, etc.)
   */
  async recordReaction(momentId: string): Promise<boolean> {
    if (!supabase || !isSupabaseConfigured) {
      return false;
    }

    try {
      // Get current value and increment
      const { data: current, error: fetchError } = await supabase
        .from('voyo_moments')
        .select('voyo_reactions')
        .eq('id', momentId)
        .single();

      if (fetchError || !current) {
        console.error('[MomentsService] Record reaction error:', fetchError?.message);
        return false;
      }

      const { error } = await supabase
        .from('voyo_moments')
        .update({
          voyo_reactions: (current.voyo_reactions || 0) + 1,
        })
        .eq('id', momentId);

      if (error) {
        console.error('[MomentsService] Record reaction error:', error.message);
        return false;
      }

      // Invalidate cache
      this.localCache.delete(momentId);
      return true;
    } catch (err) {
      console.error('[MomentsService] Record reaction error:', err);
      return false;
    }
  }

  // ============================================
  // STATS
  // ============================================

  /**
   * Get overall moments stats
   */
  async getStats(): Promise<MomentStats | null> {
    if (!supabase || !isSupabaseConfigured) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('voyo_moments_stats')
        .select('*')
        .single();

      if (error) {
        console.error('[MomentsService] Get stats error:', error.message);
        return null;
      }

      return data as MomentStats;
    } catch (err) {
      console.error('[MomentsService] Get stats error:', err);
      return null;
    }
  }

  /**
   * Get conversion rate for a moment
   * (full song taps / plays)
   */
  getConversionRate(moment: Moment): number {
    if (moment.voyo_plays === 0) return 0;
    return (moment.voyo_full_song_taps / moment.voyo_plays) * 100;
  }

  // ============================================
  // ADMIN / MODERATION
  // ============================================

  /**
   * Verify a moment (confirm track match is correct)
   */
  async verifyMoment(momentId: string): Promise<boolean> {
    if (!supabase || !isSupabaseConfigured) {
      return false;
    }

    try {
      const { error } = await supabase
        .from('voyo_moments')
        .update({ verified: true })
        .eq('id', momentId);

      if (error) {
        return false;
      }

      this.localCache.delete(momentId);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Feature a moment (show prominently in feed)
   */
  async featureMoment(momentId: string, featured: boolean = true): Promise<boolean> {
    if (!supabase || !isSupabaseConfigured) {
      return false;
    }

    try {
      const { error } = await supabase
        .from('voyo_moments')
        .update({ featured })
        .eq('id', momentId);

      if (error) {
        return false;
      }

      this.localCache.delete(momentId);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Deactivate a moment
   */
  async deactivateMoment(momentId: string, reason: string): Promise<boolean> {
    if (!supabase || !isSupabaseConfigured) {
      return false;
    }

    try {
      const { error } = await supabase
        .from('voyo_moments')
        .update({
          is_active: false,
          deactivated_reason: reason,
        })
        .eq('id', momentId);

      if (error) {
        return false;
      }

      this.localCache.delete(momentId);
      return true;
    } catch (err) {
      return false;
    }
  }

  // ============================================
  // CACHE MANAGEMENT
  // ============================================

  /**
   * Clear local cache
   */
  clearCache(): void {
    this.localCache.clear();
    console.log('[MomentsService] Cache cleared');
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number } {
    return { size: this.localCache.size };
  }
}

// ============================================
// SINGLETON EXPORT
// ============================================

export const momentsService = new MomentsService();

// Named exports for convenience
export const createMoment = (input: MomentInput) => momentsService.createMoment(input);
export const linkMomentToTrack = (momentId: string, trackId: string, confidence?: number, method?: TrackMatchMethod) =>
  momentsService.linkToTrack(momentId, trackId, confidence, method);
export const getHotMoments = (contentType?: MomentContentType, limit?: number) =>
  momentsService.getHotMoments(contentType, limit);
export const getMomentsForTrack = (trackId: string, limit?: number) =>
  momentsService.getMomentsForTrack(trackId, limit);
export const recordMomentPlay = (momentId: string, tappedFullSong?: boolean) =>
  momentsService.recordPlay(momentId, tappedFullSong);

export default momentsService;

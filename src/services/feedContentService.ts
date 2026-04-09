/**
 * VOYO Feed Content Service
 *
 * Manages the feed content cache in Supabase:
 * - Checks if track exists in feed_content table
 * - Creates new entries with thumbnail URL
 * - Updates last_accessed_at on each view
 * - Provides batch operations for efficient feed loading
 *
 * Data sources:
 * - youtube: Standard YouTube tracks
 * - ugc: User-generated content
 * - social: Imported from social media
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';

// ============================================
// TYPES
// ============================================

export type FeedContentSource = 'youtube' | 'ugc' | 'social';

export interface FeedContentMetadata {
  tags?: string[];
  mood?: string;
  genre?: string;
  bpm?: number;
  key?: string;
  energy?: number;
  danceability?: number;
  [key: string]: unknown;
}

export interface FeedContent {
  id?: string;
  track_id: string;
  title: string;
  artist: string;
  thumbnail_url?: string | null;
  audio_extract_url?: string | null;
  duration?: number | null;
  source: FeedContentSource;
  metadata?: FeedContentMetadata;
  cached_at?: string;
  last_accessed_at?: string;
  access_count?: number;
}

export interface FeedContentRow extends FeedContent {
  id: string;
  cached_at: string;
  last_accessed_at: string;
  access_count: number;
}

// ============================================
// FEED CONTENT SERVICE
// ============================================

class FeedContentService {
  private localCache: Map<string, FeedContentRow> = new Map();
  private pendingUpdates: Set<string> = new Set();

  constructor() {
    console.log('[FeedContentService] Initialized');
  }

  /**
   * Get feed content for a track
   * Checks local cache first, then Supabase
   */
  async getFeedContent(trackId: string): Promise<FeedContentRow | null> {
    // Check local cache first
    const cached = this.localCache.get(trackId);
    if (cached) {
      return cached;
    }

    // Query Supabase
    if (!supabase || !isSupabaseConfigured) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('voyo_feed_content')
        .select('*')
        .eq('track_id', trackId)
        .single();

      if (error || !data) {
        return null;
      }

      // Cache locally
      this.localCache.set(trackId, data as FeedContentRow);
      return data as FeedContentRow;
    } catch (err) {
      console.error('[FeedContentService] Get error:', err);
      return null;
    }
  }

  /**
   * Cache new feed content
   * Creates entry if it doesn't exist, updates if it does
   */
  async cacheFeedContent(content: FeedContent): Promise<boolean> {
    if (!supabase || !isSupabaseConfigured) {
      console.log('[FeedContentService] Supabase not configured, skipping cache');
      return false;
    }

    try {
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from('voyo_feed_content')
        .upsert({
          track_id: content.track_id,
          title: content.title,
          artist: content.artist,
          thumbnail_url: content.thumbnail_url || this.generateThumbnailUrl(content.track_id),
          audio_extract_url: content.audio_extract_url || null,
          duration: content.duration || null,
          source: content.source || 'youtube',
          metadata: content.metadata || {},
          cached_at: now,
          last_accessed_at: now,
          access_count: 1,
        }, {
          onConflict: 'track_id',
          ignoreDuplicates: false,
        })
        .select()
        .single();

      if (error) {
        console.error('[FeedContentService] Cache error:', error.message);
        return false;
      }

      // Update local cache
      if (data) {
        this.localCache.set(content.track_id, data as FeedContentRow);
      }

      console.log(`[FeedContentService] Cached: ${content.track_id} (${content.title})`);
      return true;
    } catch (err) {
      console.error('[FeedContentService] Cache error:', err);
      return false;
    }
  }

  /**
   * Update access time for a track
   * Debounced to avoid excessive updates
   */
  async updateAccessTime(trackId: string): Promise<void> {
    // Debounce: skip if already pending
    if (this.pendingUpdates.has(trackId)) {
      return;
    }

    this.pendingUpdates.add(trackId);

    // Update local cache immediately
    const cached = this.localCache.get(trackId);
    if (cached) {
      cached.last_accessed_at = new Date().toISOString();
      cached.access_count = (cached.access_count || 0) + 1;
    }

    // Debounce Supabase update
    setTimeout(async () => {
      this.pendingUpdates.delete(trackId);

      if (!supabase || !isSupabaseConfigured) {
        return;
      }

      try {
        // Use the RPC function for atomic increment
        await supabase.rpc('update_feed_content_access', {
          track_id_param: trackId,
        });
      } catch (err) {
        console.warn('[FeedContentService] Access update error:', err);
      }
    }, 1000); // 1 second debounce
  }

  /**
   * Batch get multiple feed content items
   * Efficient for loading feed pages
   */
  async getBatch(trackIds: string[]): Promise<Map<string, FeedContentRow>> {
    const result = new Map<string, FeedContentRow>();
    const toFetch: string[] = [];

    // Check local cache first
    for (const trackId of trackIds) {
      const cached = this.localCache.get(trackId);
      if (cached) {
        result.set(trackId, cached);
      } else {
        toFetch.push(trackId);
      }
    }

    // Fetch missing from Supabase
    if (toFetch.length > 0 && supabase && isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('voyo_feed_content')
          .select('*')
          .in('track_id', toFetch);

        if (!error && data) {
          for (const row of data) {
            const feedContent = row as FeedContentRow;
            result.set(feedContent.track_id, feedContent);
            this.localCache.set(feedContent.track_id, feedContent);
          }
        }
      } catch (err) {
        console.error('[FeedContentService] Batch get error:', err);
      }
    }

    return result;
  }

  /**
   * Batch cache multiple feed content items
   * Efficient for bulk operations
   */
  async cacheBatch(contents: FeedContent[]): Promise<number> {
    if (!supabase || !isSupabaseConfigured || contents.length === 0) {
      return 0;
    }

    try {
      const now = new Date().toISOString();

      const rows = contents.map((content) => ({
        track_id: content.track_id,
        title: content.title,
        artist: content.artist,
        thumbnail_url: content.thumbnail_url || this.generateThumbnailUrl(content.track_id),
        audio_extract_url: content.audio_extract_url || null,
        duration: content.duration || null,
        source: content.source || 'youtube',
        metadata: content.metadata || {},
        cached_at: now,
        last_accessed_at: now,
        access_count: 1,
      }));

      const { data, error, count } = await supabase
        .from('voyo_feed_content')
        .upsert(rows, {
          onConflict: 'track_id',
          ignoreDuplicates: false,
          count: 'exact',
        })
        .select();

      if (error) {
        console.error('[FeedContentService] Batch cache error:', error.message);
        return 0;
      }

      // Update local cache
      if (data) {
        for (const row of data) {
          this.localCache.set(row.track_id, row as FeedContentRow);
        }
      }

      console.log(`[FeedContentService] Batch cached ${count || data?.length || 0} items`);
      return count || data?.length || 0;
    } catch (err) {
      console.error('[FeedContentService] Batch cache error:', err);
      return 0;
    }
  }

  /**
   * Get recently accessed feed content
   */
  async getRecentlyAccessed(limit = 20): Promise<FeedContentRow[]> {
    if (!supabase || !isSupabaseConfigured) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('voyo_feed_content')
        .select('*')
        .order('last_accessed_at', { ascending: false })
        .limit(limit);

      if (error) {
        return [];
      }

      return (data || []) as FeedContentRow[];
    } catch (err) {
      console.error('[FeedContentService] Get recent error:', err);
      return [];
    }
  }

  /**
   * Get popular feed content by access count
   */
  async getPopular(limit = 20): Promise<FeedContentRow[]> {
    if (!supabase || !isSupabaseConfigured) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('voyo_feed_content')
        .select('*')
        .order('access_count', { ascending: false })
        .limit(limit);

      if (error) {
        return [];
      }

      return (data || []) as FeedContentRow[];
    } catch (err) {
      console.error('[FeedContentService] Get popular error:', err);
      return [];
    }
  }

  /**
   * Get feed content by source type
   */
  async getBySource(source: FeedContentSource, limit = 50): Promise<FeedContentRow[]> {
    if (!supabase || !isSupabaseConfigured) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('voyo_feed_content')
        .select('*')
        .eq('source', source)
        .order('cached_at', { ascending: false })
        .limit(limit);

      if (error) {
        return [];
      }

      return (data || []) as FeedContentRow[];
    } catch (err) {
      console.error('[FeedContentService] Get by source error:', err);
      return [];
    }
  }

  /**
   * Check if track exists in feed content
   */
  async exists(trackId: string): Promise<boolean> {
    // Check local cache first
    if (this.localCache.has(trackId)) {
      return true;
    }

    const content = await this.getFeedContent(trackId);
    return content !== null;
  }

  /**
   * Clear local cache
   */
  clearLocalCache(): void {
    this.localCache.clear();
    console.log('[FeedContentService] Local cache cleared');
  }

  /**
   * Get cache stats
   */
  getStats(): { localCacheSize: number; pendingUpdates: number } {
    return {
      localCacheSize: this.localCache.size,
      pendingUpdates: this.pendingUpdates.size,
    };
  }

  /**
   * Generate thumbnail URL for a YouTube track
   */
  private generateThumbnailUrl(trackId: string): string {
    return `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`;
  }
}

// ============================================
// SINGLETON EXPORT
// ============================================

export const feedContentService = new FeedContentService();

// Named exports for individual functions
export const getFeedContent = (trackId: string) => feedContentService.getFeedContent(trackId);
export const cacheFeedContent = (content: FeedContent) => feedContentService.cacheFeedContent(content);
export const updateAccessTime = (trackId: string) => feedContentService.updateAccessTime(trackId);

export default feedContentService;

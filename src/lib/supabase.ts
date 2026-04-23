/**
 * VOYO Supabase Client
 *
 * MIGRATION NOTE (Jan 2026):
 * - Auth is now handled by DASH Command Center (hub.dasuperhub.com)
 * - User identity is DASH ID, not username
 * - DEPRECATED APIs removed: followsAPI, directMessagesAPI, activityFeedAPI, feedContentAPI, avatarAPI
 * - Use voyo-api.ts for new code: profileAPI, friendsAPI, messagesAPI
 *
 * Remaining APIs:
 * - universeAPI (still consumed by universeStore, migrate later)
 * - portalChatAPI, lyricsAPI, videoIntelligenceAPI, playlistAPI
 */

import { createClient } from '@supabase/supabase-js';
import { devLog, devWarn } from '../utils/logger';

// Get from environment or use defaults for development
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Check if Supabase is configured
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Create client (will be null if not configured)
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;

// ============================================
// TYPES
// ============================================

export interface UniverseRow {
  username: string;
  pin_hash: string;
  phone: string | null;
  state: UniverseState;
  public_profile: PublicProfile;
  now_playing: NowPlaying | null;
  portal_open: boolean;
  portal_viewers: string[];
  created_at: string;
  updated_at: string;
  last_active: string;
}

export interface UniverseState {
  likes: string[];
  playlists: Playlist[];
  queue: string[];
  history: HistoryItem[];
  preferences: {
    boostProfile: string;
    shuffleMode: boolean;
    repeatMode: string;
  };
  stats: {
    totalListens: number;
    totalMinutes: number;
    totalOyes: number;
  };
}

export interface PublicProfile {
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  topTracks: string[];
  publicPlaylists: string[];
  isPublic: boolean;
}

export interface NowPlaying {
  trackId: string;
  title: string;
  artist: string;
  thumbnail: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  isPublic: boolean;
  createdAt: string;
}

export interface HistoryItem {
  trackId: string;
  playedAt: string;
  duration: number;
}

// ============================================
// PIN HASHING (used internally by universeAPI)
// ============================================

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + 'voyo-salt-2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPin(pin: string, hash: string): Promise<boolean> {
  const pinHash = await hashPin(pin);
  return pinHash === hash;
}

// ============================================
// UNIVERSE API - DEPRECATED (still consumed by universeStore)
// Use DASH Command Center auth + voyo-api.ts profileAPI instead
// ============================================

/** @deprecated Use DASH Command Center auth instead */
export const universeAPI = {
  async checkUsername(username: string): Promise<boolean> {
    if (!supabase) return true;
    const { data } = await supabase
      .from('universes')
      .select('username')
      .eq('username', username.toLowerCase())
      .single();
    return !data;
  },

  async create(
    username: string,
    pin: string,
    displayName?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!supabase) return { success: false, error: 'Supabase not configured' };

    const normalizedUsername = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (normalizedUsername.length < 3) return { success: false, error: 'Username must be at least 3 characters' };

    const available = await this.checkUsername(normalizedUsername);
    if (!available) return { success: false, error: 'Username already taken' };

    const pinHash = await hashPin(pin);
    const { error } = await supabase.from('universes').insert({
      username: normalizedUsername,
      pin_hash: pinHash,
      public_profile: {
        displayName: displayName || normalizedUsername,
        bio: '',
        avatarUrl: null,
        topTracks: [],
        publicPlaylists: [],
        isPublic: true,
      },
    });

    if (error) {
      const s = (error as any).status;
      if (s === 401 || s === 403) return { success: false, error: 'Unauthorized' };
      devWarn('[VOYO] Create universe error:', error);
      return { success: false, error: error.message };
    }
    return { success: true };
  },

  async login(
    username: string,
    pin: string
  ): Promise<{ success: boolean; universe?: UniverseRow; error?: string }> {
    if (!supabase) return { success: false, error: 'Supabase not configured' };

    const normalizedUsername = username.toLowerCase();
    const { data, error } = await supabase
      .from('universes')
      .select('*')
      .eq('username', normalizedUsername)
      .single();

    if (error || !data) return { success: false, error: 'Universe not found' };

    const valid = await verifyPin(pin, data.pin_hash);
    if (!valid) return { success: false, error: 'Invalid PIN' };

    await supabase
      .from('universes')
      .update({ last_active: new Date().toISOString() })
      .eq('username', normalizedUsername);

    return { success: true, universe: data };
  },

  async getPublicProfile(username: string): Promise<{
    profile: PublicProfile | null;
    nowPlaying: NowPlaying | null;
    portalOpen: boolean;
  }> {
    if (!supabase) return { profile: null, nowPlaying: null, portalOpen: false };

    const { data } = await supabase
      .from('universes')
      .select('public_profile, now_playing, portal_open')
      .eq('username', username.toLowerCase())
      .single();

    if (!data) return { profile: null, nowPlaying: null, portalOpen: false };
    return {
      profile: data.public_profile,
      nowPlaying: data.now_playing,
      portalOpen: data.portal_open,
    };
  },

  async updateState(username: string, state: Partial<UniverseState>): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase
      .from('universes')
      .update({ state, updated_at: new Date().toISOString() })
      .eq('username', username.toLowerCase());
    return !error;
  },

  async updateProfile(username: string, profile: Partial<PublicProfile>): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase
      .from('universes')
      .update({ public_profile: profile, updated_at: new Date().toISOString() })
      .eq('username', username.toLowerCase());
    return !error;
  },

  async updateNowPlaying(username: string, nowPlaying: NowPlaying | null): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase
      .from('universes')
      .update({ now_playing: nowPlaying, last_active: new Date().toISOString() })
      .eq('username', username.toLowerCase());
    return !error;
  },

  async setPortalOpen(username: string, isOpen: boolean): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase
      .from('universes')
      .update({ portal_open: isOpen, portal_viewers: [] })
      .eq('username', username.toLowerCase());
    return !error;
  },

  subscribeToUniverse(username: string, callback: (payload: { new: UniverseRow }) => void) {
    if (!supabase) return null;
    return supabase
      .channel(`universe:${username}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'universes',
        filter: `username=eq.${username.toLowerCase()}`,
      }, callback)
      .subscribe();
  },

  unsubscribe(channel: any) {
    if (!supabase || !channel) return;
    supabase.removeChannel(channel);
  },

  async searchUsers(query: string, limit = 10): Promise<{
    username: string;
    displayName: string;
    avatarUrl: string | null;
    portalOpen: boolean;
  }[]> {
    if (!supabase || query.length < 2) return [];
    const { data, error } = await supabase
      .from('universes')
      .select('username, public_profile, portal_open')
      .ilike('username', `%${query.toLowerCase()}%`)
      .limit(limit);

    if (error || !data) return [];
    return data.map((u: any) => ({
      username: u.username,
      displayName: u.public_profile?.displayName || u.username,
      avatarUrl: u.public_profile?.avatarUrl || null,
      portalOpen: u.portal_open || false,
    }));
  },
};

// ============================================
// PORTAL CHAT API - Room chat in someone's portal
// ============================================

export interface PortalMessage {
  id: string;
  portal_owner: string;
  sender: string;
  sender_color: string;
  message: string;
  created_at: string;
}

export const portalChatAPI = {
  async getMessages(portalOwner: string, limit = 50): Promise<PortalMessage[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('portal_messages')
      .select('*')
      .eq('portal_owner', portalOwner.toLowerCase())
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) {
      const s = (error as any).status;
      if (s === 401 || s === 403) return [];
      devWarn('[VOYO] Failed to fetch portal messages:', error);
      return [];
    }
    return data || [];
  },

  async sendMessage(portalOwner: string, sender: string, senderColor: string, message: string): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase.from('portal_messages').insert({
      portal_owner: portalOwner.toLowerCase(),
      sender,
      sender_color: senderColor,
      message: message.slice(0, 500),
    });
    if (error) {
      const s = (error as any).status;
      if (s === 401 || s === 403) return false;
      devWarn('[VOYO] Failed to send portal message:', error);
      return false;
    }
    return true;
  },

  subscribe(portalOwner: string, onMessage: (message: PortalMessage) => void) {
    if (!supabase) return null;
    return supabase
      .channel(`portal_chat:${portalOwner.toLowerCase()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'portal_messages',
        filter: `portal_owner=eq.${portalOwner.toLowerCase()}`,
      }, (payload) => {
        onMessage(payload.new as PortalMessage);
      })
      .subscribe();
  },

  unsubscribe(channel: any) {
    if (!supabase || !channel) return;
    supabase.removeChannel(channel);
  },
};

// ============================================
// LYRICS API - Phonetic Lyrics Storage
// ============================================

export interface LyricsRow {
  track_id: string;
  title: string;
  artist: string;
  phonetic_raw: string;
  phonetic_clean: string | null;
  language: string;
  confidence: number;
  segments: LyricSegmentRow[];
  translations: Record<string, string>;
  status: 'raw' | 'polished' | 'verified';
  polished_by: string[];
  verified_by: string | null;
  play_count: number;
  created_at: string;
  updated_at: string;
}

export interface LyricSegmentRow {
  start: number;
  end: number;
  text: string;
  phonetic: string;
  english?: string;
  french?: string;
  cultural_note?: string;
}

export const lyricsAPI = {
  async get(trackId: string): Promise<LyricsRow | null> {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('voyo_lyrics')
      .select('*')
      .eq('track_id', trackId)
      .single();
    if (error || !data) return null;
    return data;
  },

  async save(lyrics: Omit<LyricsRow, 'created_at' | 'updated_at' | 'play_count'>): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase.from('voyo_lyrics').upsert({
      ...lyrics,
      play_count: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      const s = (error as any).status;
      if (s === 401 || s === 403) return false;
      devWarn('[Lyrics] Save error:', error);
      return false;
    }
    devLog(`[Lyrics] Saved lyrics for ${lyrics.track_id}`);
    return true;
  },

  async recordPlay(trackId: string): Promise<void> {
    if (!supabase) return;
    await supabase.rpc('increment_lyrics_play_count', { track_id_param: trackId });
  },

  async polish(
    trackId: string,
    segmentIndex: number,
    corrections: {
      text?: string;
      phonetic?: string;
      english?: string;
      french?: string;
      cultural_note?: string;
    },
    userId: string
  ): Promise<boolean> {
    if (!supabase) return false;
    const current = await this.get(trackId);
    if (!current || !current.segments[segmentIndex]) return false;

    const updatedSegments = [...current.segments];
    updatedSegments[segmentIndex] = { ...updatedSegments[segmentIndex], ...corrections };

    const polishedBy = current.polished_by || [];
    if (!polishedBy.includes(userId)) polishedBy.push(userId);

    const { error } = await supabase
      .from('voyo_lyrics')
      .update({
        segments: updatedSegments,
        phonetic_clean: updatedSegments.map(s => s.text).join('\n'),
        polished_by: polishedBy,
        status: 'polished',
        updated_at: new Date().toISOString(),
      })
      .eq('track_id', trackId);
    return !error;
  },

  async verify(trackId: string, verifierId: string): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase
      .from('voyo_lyrics')
      .update({
        status: 'verified',
        verified_by: verifierId,
        updated_at: new Date().toISOString(),
      })
      .eq('track_id', trackId);
    return !error;
  },

  async search(query: string, limit = 20): Promise<Array<{
    track_id: string;
    title: string;
    artist: string;
    snippet: string;
  }>> {
    if (!supabase || query.length < 2) return [];
    const { data, error } = await supabase
      .from('voyo_lyrics')
      .select('track_id, title, artist, phonetic_raw')
      .or(`phonetic_raw.ilike.%${query}%,phonetic_clean.ilike.%${query}%`)
      .limit(limit);
    if (error || !data) return [];
    return data.map((row: any) => ({
      track_id: row.track_id,
      title: row.title,
      artist: row.artist,
      snippet: extractSnippet(row.phonetic_raw, query),
    }));
  },

  async getPopular(limit = 20): Promise<Array<{
    track_id: string;
    title: string;
    artist: string;
    status: string;
    play_count: number;
  }>> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('voyo_lyrics')
      .select('track_id, title, artist, status, play_count')
      .order('play_count', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data;
  },

  async getNeedingPolish(limit = 20): Promise<Array<{
    track_id: string;
    title: string;
    artist: string;
    language: string;
    confidence: number;
  }>> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('voyo_lyrics')
      .select('track_id, title, artist, language, confidence')
      .eq('status', 'raw')
      .order('play_count', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data;
  },
};

function extractSnippet(text: string, query: string, contextLength = 50): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) return text.substring(0, 100) + '...';
  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + query.length + contextLength);
  let snippet = text.substring(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

// ============================================
// VIDEO INTELLIGENCE API - The Collective Brain
// ============================================

export interface VideoIntelligenceRow {
  youtube_id: string;
  title: string;
  artist: string | null;
  channel_name: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  search_terms: string[] | null;
  normalized_title: string | null;
  related_ids: string[];
  similar_ids: string[];
  genres: string[];
  moods: string[];
  language: string | null;
  region: string | null;
  voyo_play_count: number;
  voyo_queue_count: number;
  voyo_reaction_count: number;
  discovered_by: string | null;
  discovery_method: 'manual_play' | 'ocr_extraction' | 'api_search' | 'related_crawl' | 'import' | null;
  created_at: string;
  updated_at: string;
  last_played_at: string | null;
}

// Batch debounce for sync() — collects individual calls into one batchSync()
// after 600ms idle. Prevents HTTP/2 stream refusal when multiple tracks fire
// sync() simultaneously on startup or queue fill.
const _syncQueue = new Map<string, Partial<VideoIntelligenceRow> & { youtube_id: string }>();
let _syncTimer: ReturnType<typeof setTimeout> | null = null;
function _flushSyncQueue() {
  _syncTimer = null;
  if (!supabase || _syncQueue.size === 0) return;
  const batch = [..._syncQueue.values()];
  _syncQueue.clear();
  const cleanVideos = batch.map(v => ({
    youtube_id: v.youtube_id,
    title: v.title || 'Unknown',
    artist: v.artist || null,
    thumbnail_url: v.thumbnail_url || `https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg`,
  }));
  supabase.from('video_intelligence').upsert(cleanVideos, { onConflict: 'youtube_id' }).then(({ error }) => {
    if (error) {
      const s = (error as any).status;
      if (s !== 401 && s !== 403) devLog('[VideoIntelligence] Batch sync error:', error.message);
    }
  });
}

export const videoIntelligenceAPI = {
  async sync(video: Partial<VideoIntelligenceRow> & { youtube_id: string }): Promise<boolean> {
    if (!supabase) return false;
    // Enqueue — dedup by youtube_id, flush after 600ms of quiet
    _syncQueue.set(video.youtube_id, video);
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_flushSyncQueue, 600);
    return true;
  },

  async get(youtubeId: string): Promise<VideoIntelligenceRow | null> {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('video_intelligence')
      .select('*')
      .eq('youtube_id', youtubeId)
      .single();
    if (error || !data) return null;
    return data;
  },

  async search(query: string, limit = 5): Promise<VideoIntelligenceRow[]> {
    if (!supabase || query.length < 2) return [];
    const { data, error } = await supabase
      .rpc('search_video_intelligence', { search_query: query, limit_count: limit });
    if (error) {
      const { data: fallbackData } = await supabase
        .from('video_intelligence')
        .select('*')
        .or(`title.ilike.%${query}%,artist.ilike.%${query}%`)
        .limit(limit);
      return fallbackData || [];
    }
    return data || [];
  },

  async recordPlay(youtubeId: string): Promise<void> {
    if (!supabase) return;
    await supabase.rpc('increment_video_play', { video_id: youtubeId });
  },

  async recordQueue(youtubeId: string): Promise<void> {
    if (!supabase) return;
    supabase.rpc('increment_video_queue', { video_id: youtubeId });
  },

  async getPopular(limit = 20): Promise<VideoIntelligenceRow[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('video_intelligence')
      .select('*')
      .order('voyo_play_count', { ascending: false })
      .limit(limit);
    if (error) return [];
    return data || [];
  },

  async getRecent(limit = 20): Promise<VideoIntelligenceRow[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('video_intelligence')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return data || [];
  },

  async batchSync(videos: Array<Partial<VideoIntelligenceRow> & { youtube_id: string }>): Promise<number> {
    if (!supabase || videos.length === 0) return 0;
    const cleanVideos = videos.map(v => ({
      youtube_id: v.youtube_id,
      title: v.title || 'Unknown',
      artist: v.artist || null,
      thumbnail_url: v.thumbnail_url || `https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg`,
    }));
    const { error, count } = await supabase
      .from('video_intelligence')
      .upsert(cleanVideos, { onConflict: 'youtube_id', count: 'exact' });
    if (error) {
      const s = (error as any).status;
      if (s === 401 || s === 403) return 0;
      devWarn('[VideoIntelligence] Batch sync error:', error.message);
      return 0;
    }
    devLog(`[VideoIntelligence] Batch synced ${count} videos`);
    return count || 0;
  },

  async getStats(): Promise<{
    totalVideos: number;
    totalPlays: number;
    recentDiscoveries: number;
  }> {
    if (!supabase) return { totalVideos: 0, totalPlays: 0, recentDiscoveries: 0 };
    const [countRes, playsRes, recentRes] = await Promise.all([
      supabase.from('video_intelligence').select('*', { count: 'exact', head: true }),
      supabase.from('video_intelligence').select('voyo_play_count'),
      supabase.from('video_intelligence')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    ]);
    const totalPlays = (playsRes.data || []).reduce((sum: number, v: any) => sum + (v.voyo_play_count || 0), 0);
    return {
      totalVideos: countRes.count || 0,
      totalPlays,
      recentDiscoveries: recentRes.count || 0,
    };
  },

  async flagForDownload(youtubeId: string): Promise<void> {
    if (!supabase) return;
    const normalizedId = youtubeId.replace('VOYO_', '');
    const { error } = await supabase
      .from('video_intelligence')
      .update({
        discovery_method: 'manual_play' as const,
        updated_at: new Date().toISOString(),
      })
      .eq('youtube_id', normalizedId);
    if (error) {
      devWarn('[VideoIntelligence] Flag for download failed:', error.message);
    } else {
      devLog(`[VideoIntelligence] Flagged ${normalizedId} for R2 download`);
    }
  },

  async getByArtist(artistName: string, limit = 50): Promise<VideoIntelligenceRow[]> {
    if (!supabase || !artistName) return [];
    const { data, error } = await supabase
      .from('video_intelligence')
      .select('*')
      .eq('matched_artist', artistName)
      .order('voyo_play_count', { ascending: false })
      .limit(limit);
    if (error) {
      devWarn('[VideoIntelligence] getByArtist error:', error.message);
      return [];
    }
    return data || [];
  },
};

// ============================================
// PLAYLIST API - Dedicated Playlist Cloud Storage
// ============================================

interface PlaylistRow {
  id: string;
  username: string;
  name: string;
  track_ids: string[];
  cover_url: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

interface PlaylistInput {
  id: string;
  name: string;
  trackIds: string[];
  coverUrl?: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export const playlistAPI = {
  async savePlaylist(username: string, playlist: PlaylistInput): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase
      .from('voyo_playlists')
      .upsert({
        id: playlist.id,
        username: username.toLowerCase(),
        name: playlist.name,
        track_ids: playlist.trackIds,
        cover_url: playlist.coverUrl || null,
        is_public: playlist.isPublic,
        created_at: playlist.createdAt,
        updated_at: playlist.updatedAt,
      }, { onConflict: 'id' });
    if (error) {
      const s = (error as any).status;
      if (s === 401 || s === 403) return false;
      devWarn('[Playlist] Save error:', error.message);
      return false;
    }
    devLog(`[Playlist] Saved: ${playlist.name} (${playlist.id})`);
    return true;
  },

  async getPlaylists(username: string): Promise<PlaylistInput[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('voyo_playlists')
      .select('*')
      .eq('username', username.toLowerCase())
      .order('created_at', { ascending: false });
    if (error) {
      const s = (error as any).status;
      if (s === 401 || s === 403) return [];
      devWarn('[Playlist] Get error:', error.message);
      return [];
    }
    return (data || []).map((row: PlaylistRow) => ({
      id: row.id,
      name: row.name,
      trackIds: row.track_ids || [],
      coverUrl: row.cover_url,
      isPublic: row.is_public,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },

  async deletePlaylist(username: string, playlistId: string): Promise<boolean> {
    if (!supabase) return false;
    const { error } = await supabase
      .from('voyo_playlists')
      .delete()
      .eq('id', playlistId)
      .eq('username', username.toLowerCase());
    if (error) {
      const s = (error as any).status;
      if (s === 401 || s === 403) return false;
      devWarn('[Playlist] Delete error:', error.message);
      return false;
    }
    devLog(`[Playlist] Deleted: ${playlistId}`);
    return true;
  },

  async savePlaylists(username: string, playlists: PlaylistInput[]): Promise<number> {
    if (!supabase || playlists.length === 0) return 0;
    const rows = playlists.map((playlist) => ({
      id: playlist.id,
      username: username.toLowerCase(),
      name: playlist.name,
      track_ids: playlist.trackIds,
      cover_url: playlist.coverUrl || null,
      is_public: playlist.isPublic,
      created_at: playlist.createdAt,
      updated_at: playlist.updatedAt,
    }));
    const { error, count } = await supabase
      .from('voyo_playlists')
      .upsert(rows, { onConflict: 'id', count: 'exact' });
    if (error) {
      const s = (error as any).status;
      if (s === 401 || s === 403) return 0;
      devWarn('[Playlist] Batch save error:', error.message);
      return 0;
    }
    devLog(`[Playlist] Batch saved ${count} playlists`);
    return count || 0;
  },

  async getPublicPlaylists(username: string): Promise<PlaylistInput[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('voyo_playlists')
      .select('*')
      .eq('username', username.toLowerCase())
      .eq('is_public', true)
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data || []).map((row: PlaylistRow) => ({
      id: row.id,
      name: row.name,
      trackIds: row.track_ids || [],
      coverUrl: row.cover_url,
      isPublic: row.is_public,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },
};

export default supabase;

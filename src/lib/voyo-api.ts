/**
 * VOYO API - Clean DASH ID Native
 *
 * Philosophy:
 * - DASH ID is THE identity
 * - Friends/Messages from Command Center (universal across DASH apps)
 * - VOYO-specific data (profiles, playlists) in VOYO Supabase
 *
 * URL: voyomusic.com/0046AAD
 * Display: V0046AAD
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ============================================
// DUAL SUPABASE SETUP
// ============================================

// VOYO Supabase (product-specific: profiles, playlists, reactions)
const voyoUrl = import.meta.env.VITE_SUPABASE_URL || '';
const voyoKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = voyoUrl && voyoKey
  ? createClient(voyoUrl, voyoKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

// Command Center Supabase (universal: friends, messages, presence)
const commandUrl = import.meta.env.VITE_COMMAND_CENTER_URL || '';
const commandKey = import.meta.env.VITE_COMMAND_CENTER_KEY || '';

export const commandCenter: SupabaseClient | null = commandUrl && commandKey
  ? createClient(commandUrl, commandKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

export const isConfigured = Boolean(supabase);
export const isCommandCenterConfigured = Boolean(commandCenter);

// ============================================
// TYPES
// ============================================

export interface VibeProfile {
  afro_heat: number;
  chill: number;
  party: number;
  workout: number;
  late_night: number;
}

export interface VoyoPreferences {
  track_preferences: Record<string, any>;
  artist_preferences: Record<string, any>;
  tag_preferences: Record<string, any>;
  vibe_profile: VibeProfile;
  display_name?: string;
  bio?: string;
  avatar_url?: string;
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

export interface VoyoProfile {
  dash_id: string;
  preferences: VoyoPreferences;
  history: { trackId: string; playedAt: string; duration: number }[];
  queue: string[];
  likes: string[];
  total_listens: number;
  total_minutes: number;
  now_playing: NowPlaying | null;
  portal_open: boolean;
  created_at: string;
  last_active: string;
}

export interface VoyoPlaylist {
  id: string;
  dash_id: string;
  name: string;
  track_ids: string[];
  cover_url: string | null;
  is_public: boolean;
  created_at: string;
}

export interface VoyoMessage {
  id: string;
  from_id: string;
  to_id: string;
  message: string;
  read_at: string | null;
  created_at: string;
}

// Alias for backward compatibility
export interface DirectMessage {
  id: string;
  from_user: string;
  to_user: string;
  message: string;
  read_at: string | null;
  created_at: string;
}

// ============================================
// PROFILE API
// ============================================

export const profileAPI = {
  /**
   * Get or create profile for DASH ID
   * Called when user first opens VOYO
   */
  async getOrCreate(dashId: string): Promise<VoyoProfile | null> {
    if (!supabase) return null;

    const { data, error } = await supabase
      .rpc('get_or_create_profile', { p_dash_id: dashId });

    if (error) {
      console.error('[VOYO] Profile error:', error);
      return null;
    }

    return data;
  },

  /**
   * Get profile by DASH ID (for viewing others)
   */
  async get(dashId: string): Promise<VoyoProfile | null> {
    if (!supabase) return null;

    const { data } = await supabase
      .from('voyo_profiles')
      .select('*')
      .eq('dash_id', dashId)
      .single();

    return data;
  },

  // Alias for consistency
  async getProfile(dashId: string): Promise<VoyoProfile | null> {
    return this.get(dashId);
  },

  /**
   * Search users by DASH ID prefix
   */
  async search(query: string): Promise<{ dash_id: string; preferences: any; portal_open: boolean }[]> {
    if (!supabase || query.length < 2) return [];

    const { data } = await supabase
      .from('voyo_profiles')
      .select('dash_id, preferences, portal_open')
      .ilike('dash_id', `%${query}%`)
      .limit(10);

    return data || [];
  },

  /**
   * Update preferences
   */
  async updatePreferences(dashId: string, preferences: Partial<VoyoPreferences>): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
      .from('voyo_profiles')
      .update({ preferences, updated_at: new Date().toISOString() })
      .eq('dash_id', dashId);

    return !error;
  },

  /**
   * Update now playing (for portal)
   */
  async updateNowPlaying(dashId: string, nowPlaying: NowPlaying | null): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
      .from('voyo_profiles')
      .update({
        now_playing: nowPlaying,
        last_active: new Date().toISOString(),
      })
      .eq('dash_id', dashId);

    return !error;
  },

  /**
   * Open/close portal
   */
  async setPortalOpen(dashId: string, isOpen: boolean): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
      .from('voyo_profiles')
      .update({
        portal_open: isOpen,
        now_playing: isOpen ? undefined : null,
      })
      .eq('dash_id', dashId);

    return !error;
  },

  /**
   * Subscribe to profile changes (real-time portal)
   */
  subscribe(dashId: string, onUpdate: (profile: VoyoProfile) => void) {
    if (!supabase) return null;

    return supabase
      .channel(`profile:${dashId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'voyo_profiles',
        filter: `dash_id=eq.${dashId}`,
      }, (payload) => onUpdate(payload.new as VoyoProfile))
      .subscribe();
  },

  unsubscribe(channel: any) {
    if (supabase && channel) supabase.removeChannel(channel);
  },
};

// ============================================
// FRIENDS API (Queries Command Center)
// ============================================

export interface Friend {
  dash_id: string;
  name: string;
  nickname?: string;
  status: 'online' | 'offline' | 'away';
  current_app: string | null;
  activity?: string;
  avatar?: string;
  last_seen?: string;
}

export interface Conversation {
  username: string;
  displayName: string;
  avatarUrl?: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  sentFrom?: string;
}

export const friendsAPI = {
  /**
   * Get friends from Command Center
   * These are global friends - same across all DASH apps
   */
  async getFriends(dashId: string): Promise<Friend[]> {
    // Try Command Center first (source of truth)
    if (commandCenter) {
      const { data, error } = await commandCenter
        .rpc('get_friends_with_presence', { p_user_id: dashId });

      if (!error && data) {
        return data.map((f: any) => ({
          dash_id: f.friend_id,
          name: f.nickname || f.full_name || `V${f.friend_id}`,
          nickname: f.nickname,
          status: f.status || 'offline',
          current_app: f.current_app,
          activity: f.activity,
          last_seen: f.last_seen,
        }));
      }
    }

    // Fallback to localStorage (offline mode)
    try {
      const stored = localStorage.getItem('dash_citizen_storage');
      if (!stored) return [];
      const data = JSON.parse(stored);
      return data.state?.friends || [];
    } catch {
      return [];
    }
  },

  /**
   * Get friends who are currently on VOYO
   */
  async getVoyoFriends(dashId: string): Promise<Friend[]> {
    const allFriends = await this.getFriends(dashId);
    return allFriends.filter(f => f.current_app === 'V');
  },

  /**
   * Add friend via Command Center (bidirectional)
   */
  async addFriend(myDashId: string, friendDashId: string, nickname?: string): Promise<boolean> {
    if (!commandCenter) {
      console.warn('[VOYO] Command Center not configured');
      return false;
    }

    const { data, error } = await commandCenter
      .rpc('add_friend', {
        p_user_id: myDashId,
        p_friend_id: friendDashId,
        p_nickname: nickname || null,
      });

    if (error) {
      console.error('[VOYO] Add friend error:', error.message);
      return false;
    }

    return data?.success || false;
  },

  /**
   * Remove friend via Command Center (bidirectional)
   */
  async removeFriend(myDashId: string, friendDashId: string): Promise<boolean> {
    if (!commandCenter) return false;

    const { data, error } = await commandCenter
      .rpc('remove_friend', {
        p_user_id: myDashId,
        p_friend_id: friendDashId,
      });

    if (error) {
      console.error('[VOYO] Remove friend error:', error.message);
      return false;
    }

    return data?.success || false;
  },

  /**
   * Check if someone is a friend
   */
  async isFriend(myDashId: string, otherDashId: string): Promise<boolean> {
    if (commandCenter) {
      const { data } = await commandCenter
        .from('friends')
        .select('id')
        .eq('user_id', myDashId)
        .eq('friend_id', otherDashId)
        .eq('status', 'active')
        .single();

      return !!data;
    }

    // Fallback to localStorage
    const friends = await this.getFriends(myDashId);
    return friends.some(f => f.dash_id === otherDashId);
  },

  /**
   * Update my presence in Command Center
   * Shows friends what I'm doing (e.g., "on VOYO, listening to Burna Boy")
   */
  async updatePresence(
    dashId: string,
    status: 'online' | 'away' | 'offline' = 'online',
    activity?: string,
    activityData?: any
  ): Promise<void> {
    if (!commandCenter) return;

    await commandCenter.rpc('update_presence', {
      p_core_id: dashId,
      p_status: status,
      p_app: 'V', // VOYO
      p_activity: activity || null,
      p_activity_data: activityData || null,
    });
  },

  /**
   * Subscribe to friends' presence changes (real-time)
   */
  subscribeToFriendsPresence(
    friendIds: string[],
    onUpdate: (presence: { coreId: string; status: string; app: string; activity: string }) => void
  ): (() => void) | null {
    if (!commandCenter || friendIds.length === 0) return null;

    const channel = commandCenter
      .channel('friends_presence')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_presence',
      }, (payload) => {
        const p = payload.new as any;
        if (friendIds.includes(p.core_id)) {
          onUpdate({
            coreId: p.core_id,
            status: p.status,
            app: p.current_app,
            activity: p.activity,
          });
        }
      })
      .subscribe();

    return () => commandCenter.removeChannel(channel);
  },
};

// ============================================
// MESSAGES API (Command Center - Universal)
// Same chat thread across ALL DASH apps
// ============================================

export interface MessageAttachment {
  type: 'track' | 'channel' | 'link' | 'image' | 'file';
  data: {
    trackId?: string;
    title?: string;
    thumbnail?: string;
    url?: string;
    [key: string]: any;
  };
}

export const messagesAPI = {
  /**
   * Send message via Command Center (universal)
   * sent_from='V' tags it as coming from VOYO
   */
  async send(
    fromId: string,
    toId: string,
    message: string,
    attachment?: MessageAttachment
  ): Promise<boolean> {
    if (!commandCenter) {
      console.warn('[VOYO] Command Center not configured');
      return false;
    }

    const { error } = await commandCenter
      .from('messages')
      .insert({
        from_id: fromId,
        to_id: toId,
        message: message.slice(0, 1000),
        sent_from: 'V', // VOYO
        attachment_type: attachment?.type || null,
        attachment_data: attachment?.data || null,
      });

    if (error) {
      console.error('[VOYO] Send message error:', error.message);
      return false;
    }

    return true;
  },

  // Alias for DirectMessageChat compatibility
  async sendMessage(fromId: string, toId: string, message: string): Promise<boolean> {
    return this.send(fromId, toId, message);
  },

  /**
   * Get conversation using Command Center RPC
   */
  async getConversation(user1: string, user2: string, limit = 100): Promise<VoyoMessage[]> {
    if (!commandCenter) return [];

    const { data, error } = await commandCenter
      .rpc('get_conversation', {
        p_user_1: user1,
        p_user_2: user2,
        p_limit: limit,
      });

    if (error) {
      console.error('[VOYO] Get conversation error:', error.message);
      return [];
    }

    // Map to VoyoMessage format (Command Center uses same fields)
    return (data || []).map((m: any) => ({
      id: m.id,
      from_id: m.from_id,
      to_id: m.to_id,
      message: m.message,
      read_at: m.read_at,
      created_at: m.created_at,
    }));
  },

  // Alias for DirectMessageChat compatibility - returns DirectMessage format
  async getMessages(currentUser: string, otherUser: string): Promise<DirectMessage[]> {
    const messages = await this.getConversation(currentUser, otherUser);
    return messages.map(m => ({
      id: m.id,
      from_user: m.from_id,
      to_user: m.to_id,
      message: m.message,
      read_at: m.read_at,
      created_at: m.created_at,
    }));
  },

  /**
   * Mark messages as read via Command Center
   */
  async markAsRead(fromId: string, toId: string): Promise<boolean> {
    if (!commandCenter) return false;

    const { data, error } = await commandCenter
      .rpc('mark_messages_read', {
        p_user_id: toId,
        p_friend_id: fromId,
      });

    if (error) {
      console.error('[VOYO] Mark read error:', error.message);
      return false;
    }

    return data?.success || false;
  },

  /**
   * Get unread message count
   */
  async getUnreadCount(dashId: string): Promise<number> {
    if (!commandCenter) return 0;

    const { count, error } = await commandCenter
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('to_id', dashId)
      .is('read_at', null);

    if (error) return 0;
    return count || 0;
  },

  /**
   * Get all conversations using Command Center RPC
   */
  async getConversations(dashId: string): Promise<Conversation[]> {
    if (!commandCenter) return [];

    const { data, error } = await commandCenter
      .rpc('get_conversations', { p_user_id: dashId });

    if (error) {
      console.error('[VOYO] Get conversations error:', error.message);
      return [];
    }

    return (data || []).map((c: any) => ({
      username: c.friend_id,
      displayName: c.friend_name,
      avatarUrl: null, // Would need to fetch from profiles
      lastMessage: c.last_message,
      lastMessageTime: c.last_message_at,
      unreadCount: c.unread_count,
    }));
  },

  /**
   * Subscribe to incoming messages (real-time)
   */
  subscribe(dashId: string, onMessage: (msg: VoyoMessage) => void) {
    if (!commandCenter) return null;

    return commandCenter
      .channel(`messages:${dashId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `to_id=eq.${dashId}`,
      }, (payload) => {
        const m = payload.new as any;
        onMessage({
          id: m.id,
          from_id: m.from_id,
          to_id: m.to_id,
          message: m.message,
          read_at: m.read_at,
          created_at: m.created_at,
        });
      })
      .subscribe();
  },

  // Subscribe to conversation - DirectMessageChat compatibility
  subscribeToConversation(currentUser: string, otherUser: string, onMessage: (msg: DirectMessage) => void) {
    if (!commandCenter) return null;

    const channelId = [currentUser, otherUser].sort().join(':');

    return commandCenter
      .channel(`convo:${channelId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, (payload) => {
        const m = payload.new as any;
        // Filter to only this conversation
        if (
          (m.from_id === currentUser && m.to_id === otherUser) ||
          (m.from_id === otherUser && m.to_id === currentUser)
        ) {
          onMessage({
            id: m.id,
            from_user: m.from_id,
            to_user: m.to_id,
            message: m.message,
            read_at: m.read_at,
            created_at: m.created_at,
          });
        }
      })
      .subscribe();
  },

  unsubscribe(channel: any) {
    if (commandCenter && channel) commandCenter.removeChannel(channel);
  },

  /**
   * Subscribe to incoming messages - returns an unsubscribe function
   * Used by App.tsx for DynamicIsland notifications
   */
  subscribeToIncoming(dashId: string, onMessage: (msg: VoyoMessage) => void): () => void {
    if (!commandCenter) return () => {};

    const channel = commandCenter
      .channel(`incoming:${dashId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `to_id=eq.${dashId}`,
      }, (payload) => {
        const m = payload.new as any;
        onMessage({
          id: m.id,
          from_id: m.from_id,
          to_id: m.to_id,
          message: m.message,
          read_at: m.read_at,
          created_at: m.created_at,
        });
      })
      .subscribe();

    // Return cleanup function
    return () => {
      if (channel) commandCenter.removeChannel(channel);
    };
  },
};

// ============================================
// ACTIVITY FEED API
// ============================================

export interface FriendActivity {
  dash_id: string;
  now_playing: NowPlaying | null;
  portal_open: boolean;
  last_active: string;
  // Display properties (enriched from friends list)
  displayName?: string;
  avatarUrl?: string;
}

export const activityAPI = {
  /**
   * Get activity from friends (from Command Center)
   */
  async getFriendsActivity(dashId: string): Promise<FriendActivity[]> {
    if (!supabase) return [];

    const friends = await friendsAPI.getFriends(dashId);
    const friendIds = friends.map(f => f.dash_id);
    if (friendIds.length === 0) return [];

    const { data } = await supabase
      .from('voyo_profiles')
      .select('dash_id, now_playing, portal_open, last_active')
      .in('dash_id', friendIds)
      .order('last_active', { ascending: false });

    return data || [];
  },

  /**
   * Get friends with open portals
   */
  async getLiveListeners(dashId: string): Promise<FriendActivity[]> {
    if (!supabase) return [];

    const friends = await friendsAPI.getFriends(dashId);
    const friendIds = friends.map(f => f.dash_id);
    if (friendIds.length === 0) return [];

    const { data } = await supabase
      .from('voyo_profiles')
      .select('dash_id, now_playing, portal_open, last_active')
      .in('dash_id', friendIds)
      .eq('portal_open', true)
      .not('now_playing', 'is', null);

    return data || [];
  },
};

// ============================================
// PLAYLISTS API
// ============================================

export const playlistsAPI = {
  async create(dashId: string, name: string): Promise<VoyoPlaylist | null> {
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('voyo_playlists')
      .insert({ dash_id: dashId, name })
      .select()
      .single();

    return error ? null : data;
  },

  async getAll(dashId: string): Promise<VoyoPlaylist[]> {
    if (!supabase) return [];

    const { data } = await supabase
      .from('voyo_playlists')
      .select('*')
      .eq('dash_id', dashId)
      .order('created_at', { ascending: false });

    return data || [];
  },

  async update(playlistId: string, updates: Partial<VoyoPlaylist>): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
      .from('voyo_playlists')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', playlistId);

    return !error;
  },

  async delete(playlistId: string): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
      .from('voyo_playlists')
      .delete()
      .eq('id', playlistId);

    return !error;
  },

  async getPublic(dashId: string): Promise<VoyoPlaylist[]> {
    if (!supabase) return [];

    const { data } = await supabase
      .from('voyo_playlists')
      .select('*')
      .eq('dash_id', dashId)
      .eq('is_public', true);

    return data || [];
  },
};

// ============================================
// HELPER: Format DASH ID for display
// ============================================

export function formatVoyoId(dashId: string): string {
  return `V${dashId}`;
}

export function parseDashId(voyoId: string): string {
  // "V0046AAD" → "0046AAD"
  return voyoId.startsWith('V') ? voyoId.slice(1) : voyoId;
}

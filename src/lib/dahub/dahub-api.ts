/**
 * DAHUB API for VOYO
 *
 * Connects to COMMAND CENTER's Supabase for social features
 * This ensures all apps share the same friends, messages, presence
 *
 * VOYO Supabase = Music data (playlists, likes, etc.)
 * Command Center Supabase = Social data (friends, messages, presence)
 */

import { createClient } from '@supabase/supabase-js';

// Command Center's Supabase credentials (social data)
// Check multiple env var names for compatibility
const CC_SUPABASE_URL = import.meta.env.VITE_COMMAND_CENTER_URL || import.meta.env.VITE_CC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || '';
const CC_SUPABASE_KEY = import.meta.env.VITE_COMMAND_CENTER_KEY || import.meta.env.VITE_CC_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Create Command Center Supabase client for social features
export const ccSupabase = CC_SUPABASE_URL && CC_SUPABASE_KEY
  ? createClient(CC_SUPABASE_URL, CC_SUPABASE_KEY)
  : null;

export const isDahubConfigured = Boolean(ccSupabase);

// ==============================================
// TYPES
// ==============================================

export interface Friend {
  dash_id: string;
  name: string;
  nickname?: string;
  avatar?: string;
  status: 'online' | 'offline' | 'away';
  current_app: string | null;
  activity?: string;
  activity_data?: Record<string, any>;
  last_seen?: string;
}

export interface Message {
  id: string;
  from_id: string;
  to_id: string;
  message: string;
  sent_from?: string;
  attachment_type?: 'track' | 'channel' | 'link' | 'image' | 'file';
  attachment_data?: Record<string, any>;
  read_at: string | null;
  created_at: string;
}

export interface Conversation {
  friend_id: string;
  friend_name: string;
  friend_avatar?: string;
  last_message: string;
  last_message_time: string;
  unread_count: number;
  sent_from?: string;
  is_online: boolean;
  current_app?: string;
}

export interface UserPresence {
  core_id: string;
  status: 'online' | 'offline' | 'away';
  current_app: string | null;
  activity: string | null;
  activity_data: Record<string, any> | null;
  last_seen: string;
}

export interface FriendActivity {
  dash_id: string;
  name: string;
  avatar?: string;
  app: string;
  activity: string;
  activity_data?: Record<string, any>;
  timestamp: string;
}

// Shared account member (people on same Netflix/Spotify/Prime accounts)
export interface SharedService {
  service_type: string;    // 'NF', 'SP', 'AP', etc.
  account_id: string;      // 'netflix-007'
  service_name: string;    // 'Netflix'
  service_color: string;   // '#E50914'
  service_icon: string;    // 'netflix'
}

export interface SharedAccountMember {
  dash_id: string;
  name: string;
  avatar?: string;
  shared_services: SharedService[];
  friend_status: 'suggested' | 'pending' | 'accepted';
  status?: 'online' | 'offline' | 'away';
  current_app?: string | null;
  activity?: string;
}

// Service display info
export const SERVICE_DISPLAY: Record<string, { name: string; color: string; icon: string }> = {
  NF: { name: 'Netflix', color: '#E50914', icon: 'netflix' },
  SP: { name: 'Spotify', color: '#1DB954', icon: 'spotify' },
  AP: { name: 'Prime', color: '#00A8E1', icon: 'prime' },
  CL: { name: 'Claude', color: '#D97757', icon: 'claude' },
  GP: { name: 'ChatGPT', color: '#10A37F', icon: 'chatgpt' },
  GR: { name: 'Grok', color: '#000000', icon: 'grok' },
  DZ: { name: 'Deezer', color: '#FF0092', icon: 'deezer' },
  YT: { name: 'YouTube', color: '#FF0000', icon: 'youtube' },
  DP: { name: 'Disney+', color: '#113CCF', icon: 'disney' },
};

// App codes
export const APP_CODES = {
  COMMAND_CENTER: 'CC',
  VOYO: 'V',
  DASH_EDU: 'E',
  TV_PLUS: 'TV',
  DA_CLUB: 'DC',
  DASH_FASHION: 'DF',
  DASH_TRAVEL: 'DT',
} as const;

export type AppCode = typeof APP_CODES[keyof typeof APP_CODES];

// ==============================================
// FRIENDS API
// ==============================================

export const friendsAPI = {
  async getFriends(userId: string, appFilter?: AppCode): Promise<Friend[]> {
    if (!ccSupabase) {
      console.warn('[DAHUB] Command Center Supabase not configured');
      return [];
    }

    try {
      const { data, error } = await ccSupabase.rpc('get_friends_with_presence', {
        p_user_id: userId
      });

      if (error) {
        console.error('[DAHUB] Error fetching friends:', error);
        return [];
      }

      let friends: Friend[] = (data || []).map((row: any) => ({
        dash_id: row.friend_id,
        name: row.full_name || row.friend_id,
        nickname: row.nickname,
        avatar: undefined,
        status: row.status || 'offline',
        current_app: row.current_app,
        activity: row.activity,
        activity_data: undefined,
        last_seen: row.last_seen
      }));

      // Filter by app if specified (VOYO only sees VOYO activity)
      if (appFilter && appFilter !== APP_CODES.COMMAND_CENTER) {
        friends = friends.filter(f => f.current_app === appFilter);
      }

      return friends;
    } catch (err) {
      console.error('[DAHUB] Failed to fetch friends:', err);
      return [];
    }
  },

  async addFriend(userId: string, friendId: string, nickname?: string): Promise<boolean> {
    if (!ccSupabase) return false;

    try {
      const { error } = await ccSupabase.rpc('add_friend', {
        p_user_id: userId,
        p_friend_id: friendId,
        p_nickname: nickname || null
      });

      return !error;
    } catch (err) {
      console.error('[DAHUB] Failed to add friend:', err);
      return false;
    }
  },

  async removeFriend(userId: string, friendId: string): Promise<boolean> {
    if (!ccSupabase) return false;

    try {
      const { error } = await ccSupabase.rpc('remove_friend', {
        p_user_id: userId,
        p_friend_id: friendId
      });

      return !error;
    } catch (err) {
      console.error('[DAHUB] Failed to remove friend:', err);
      return false;
    }
  },

  async searchUsers(query: string): Promise<{ dash_id: string; name: string }[]> {
    if (!ccSupabase) return [];

    try {
      const { data, error } = await ccSupabase
        .from('users')
        .select('core_id, full_name')
        .or(`core_id.ilike.%${query}%,full_name.ilike.%${query}%`)
        .limit(10);

      if (error) return [];

      return (data || []).map(u => ({
        dash_id: u.core_id,
        name: u.full_name
      }));
    } catch (err) {
      console.error('[DAHUB] Failed to search users:', err);
      return [];
    }
  },

  /**
   * Get shared account members - people on the same streaming accounts
   * Shows Netflix/Spotify/Prime etc. members as suggested friends
   */
  async getSharedAccountMembers(userId: string): Promise<SharedAccountMember[]> {
    if (!ccSupabase) return [];

    try {
      // Step 1: Get user's account_ids from user_services
      const { data: userServices, error: userServicesError } = await ccSupabase
        .from('user_services')
        .select('account_id, service_type')
        .eq('core_id', userId);

      if (userServicesError || !userServices?.length) {
        console.log('[DAHUB] No shared accounts found for user');
        return [];
      }

      const accountIds = userServices.map(s => s.account_id).filter(Boolean);
      if (accountIds.length === 0) return [];

      // Step 2: Find other users on the same accounts
      const { data: sharedMembers, error: membersError } = await ccSupabase
        .from('user_services')
        .select(`
          core_id,
          account_id,
          service_type,
          citizens!inner(core_id, full_name)
        `)
        .in('account_id', accountIds)
        .neq('core_id', userId);

      if (membersError || !sharedMembers?.length) return [];

      // Step 3: Get existing friend relationships to determine status
      const { data: friendships } = await ccSupabase
        .from('friendships')
        .select('friend_id, status')
        .eq('user_id', userId);

      const friendMap = new Map<string, string>();
      (friendships || []).forEach((f: any) => {
        friendMap.set(f.friend_id, f.status || 'accepted');
      });

      // Step 4: Group by user and aggregate services
      const memberMap = new Map<string, SharedAccountMember>();

      for (const row of sharedMembers) {
        const memberId = row.core_id;
        const citizen = row.citizens as any;
        const serviceType = row.service_type;
        const serviceInfo = SERVICE_DISPLAY[serviceType];

        if (!memberMap.has(memberId)) {
          // Determine friend status
          let friendStatus: 'suggested' | 'pending' | 'accepted' = 'suggested';
          const existingStatus = friendMap.get(memberId);
          if (existingStatus === 'accepted') friendStatus = 'accepted';
          else if (existingStatus === 'pending') friendStatus = 'pending';

          memberMap.set(memberId, {
            dash_id: memberId,
            name: citizen?.full_name || memberId,
            avatar: undefined,
            shared_services: [],
            friend_status: friendStatus,
            status: 'offline'
          });
        }

        // Add service if display info exists
        if (serviceInfo) {
          const member = memberMap.get(memberId)!;
          // Check if service already added
          if (!member.shared_services.find(s => s.account_id === row.account_id)) {
            member.shared_services.push({
              service_type: serviceType,
              account_id: row.account_id,
              service_name: serviceInfo.name,
              service_color: serviceInfo.color,
              service_icon: serviceInfo.icon
            });
          }
        }
      }

      // Step 5: Get presence for shared members
      const memberIds = Array.from(memberMap.keys());
      if (memberIds.length > 0) {
        const { data: presenceData } = await ccSupabase
          .from('user_presence')
          .select('core_id, status, current_app, activity')
          .in('core_id', memberIds);

        (presenceData || []).forEach((p: any) => {
          const member = memberMap.get(p.core_id);
          if (member) {
            member.status = p.status || 'offline';
            member.current_app = p.current_app;
            member.activity = p.activity;
          }
        });
      }

      return Array.from(memberMap.values());
    } catch (err) {
      console.error('[DAHUB] Failed to get shared account members:', err);
      return [];
    }
  },

  /**
   * Send friend request to a shared account member
   */
  async sendFriendRequest(userId: string, friendId: string): Promise<boolean> {
    if (!ccSupabase) return false;

    try {
      const { error } = await ccSupabase
        .from('friendships')
        .upsert({
          user_id: userId,
          friend_id: friendId,
          status: 'pending',
          created_at: new Date().toISOString()
        }, { onConflict: 'user_id,friend_id' });

      return !error;
    } catch (err) {
      console.error('[DAHUB] Failed to send friend request:', err);
      return false;
    }
  },

  /**
   * Accept a friend request (or upgrade suggested to accepted)
   */
  async acceptFriendRequest(userId: string, friendId: string): Promise<boolean> {
    if (!ccSupabase) return false;

    try {
      // Upsert both directions for mutual friendship
      const { error } = await ccSupabase
        .from('friendships')
        .upsert([
          { user_id: userId, friend_id: friendId, status: 'accepted', created_at: new Date().toISOString() },
          { user_id: friendId, friend_id: userId, status: 'accepted', created_at: new Date().toISOString() }
        ], { onConflict: 'user_id,friend_id' });

      return !error;
    } catch (err) {
      console.error('[DAHUB] Failed to accept friend request:', err);
      return false;
    }
  }
};

// ==============================================
// MESSAGES API
// ==============================================

export const messagesAPI = {
  async getConversations(userId: string): Promise<Conversation[]> {
    if (!ccSupabase) return [];

    try {
      const { data, error } = await ccSupabase.rpc('get_conversations', {
        p_user_id: userId
      });

      if (error) {
        console.error('[DAHUB] Error fetching conversations:', error);
        return [];
      }

      return (data || []).map((row: any) => ({
        friend_id: row.friend_id,
        friend_name: row.friend_name || row.friend_id,
        friend_avatar: undefined,
        last_message: row.last_message,
        last_message_time: row.last_message_at,
        unread_count: Number(row.unread_count) || 0,
        sent_from: row.sent_from,
        is_online: false,
        current_app: undefined
      }));
    } catch (err) {
      console.error('[DAHUB] Failed to fetch conversations:', err);
      return [];
    }
  },

  async getMessages(user1: string, user2: string, limit = 50): Promise<Message[]> {
    if (!ccSupabase) return [];

    try {
      const { data, error } = await ccSupabase.rpc('get_conversation', {
        p_user_1: user1,
        p_user_2: user2,
        p_limit: limit
      });

      if (error) return [];
      return (data || []) as Message[];
    } catch (err) {
      console.error('[DAHUB] Failed to fetch messages:', err);
      return [];
    }
  },

  async sendMessage(
    fromId: string,
    toId: string,
    message: string,
    sentFrom: AppCode = APP_CODES.VOYO,
    attachment?: { type: string; data: Record<string, any> }
  ): Promise<boolean> {
    if (!ccSupabase) return false;

    try {
      const { error } = await ccSupabase.from('messages').insert({
        from_id: fromId,
        to_id: toId,
        message: message.slice(0, 1000),
        sent_from: sentFrom,
        attachment_type: attachment?.type || null,
        attachment_data: attachment?.data || null
      });

      return !error;
    } catch (err) {
      console.error('[DAHUB] Failed to send message:', err);
      return false;
    }
  },

  async markAsRead(userId: string, friendId: string): Promise<boolean> {
    if (!ccSupabase) return false;

    try {
      const { error } = await ccSupabase.rpc('mark_messages_read', {
        p_user_id: userId,
        p_friend_id: friendId
      });

      return !error;
    } catch (err) {
      console.error('[DAHUB] Failed to mark messages read:', err);
      return false;
    }
  },

  async getUnreadCount(userId: string): Promise<number> {
    if (!ccSupabase) return 0;

    try {
      const { count, error } = await ccSupabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('to_id', userId)
        .is('read_at', null);

      if (error) return 0;
      return count || 0;
    } catch (err) {
      return 0;
    }
  },

  subscribeToMessages(userId: string, onMessage: (msg: Message) => void) {
    if (!ccSupabase) return () => {};

    const channel = ccSupabase
      .channel(`messages:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `to_id=eq.${userId}`
        },
        (payload) => {
          onMessage(payload.new as Message);
        }
      )
      .subscribe();

    return () => {
      ccSupabase.removeChannel(channel);
    };
  }
};

// ==============================================
// PRESENCE API
// ==============================================

export const presenceAPI = {
  async updatePresence(
    userId: string,
    status: 'online' | 'offline' | 'away',
    app: AppCode = APP_CODES.VOYO,
    activity?: string,
    activityData?: Record<string, any>
  ): Promise<boolean> {
    if (!ccSupabase) return false;

    try {
      const { error } = await ccSupabase.rpc('update_presence', {
        p_core_id: userId,
        p_status: status,
        p_app: app,
        p_activity: activity || null,
        p_activity_data: activityData || null
      });

      return !error;
    } catch (err) {
      console.error('[DAHUB] Failed to update presence:', err);
      return false;
    }
  },

  async getPresence(userId: string): Promise<UserPresence | null> {
    if (!ccSupabase) return null;

    try {
      const { data, error } = await ccSupabase
        .from('user_presence')
        .select('*')
        .eq('core_id', userId)
        .single();

      if (error) return null;
      return data as UserPresence;
    } catch (err) {
      return null;
    }
  },

  subscribeToPresence(friendIds: string[], onUpdate: (presence: UserPresence) => void) {
    if (!ccSupabase || friendIds.length === 0) return () => {};

    const channel = ccSupabase
      .channel('presence-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_presence',
          filter: `core_id=in.(${friendIds.join(',')})`
        },
        (payload) => {
          onUpdate(payload.new as UserPresence);
        }
      )
      .subscribe();

    return () => {
      ccSupabase.removeChannel(channel);
    };
  }
};

// ==============================================
// ACTIVITY API
// ==============================================

export const activityAPI = {
  async getFriendsActivity(userId: string, appFilter?: AppCode): Promise<FriendActivity[]> {
    try {
      const friends = await friendsAPI.getFriends(userId);

      const activities: FriendActivity[] = friends
        .filter(f => f.activity && f.status !== 'offline')
        .map(f => ({
          dash_id: f.dash_id,
          name: f.name,
          avatar: f.avatar,
          app: f.current_app || 'CC',
          activity: f.activity || '',
          activity_data: f.activity_data,
          timestamp: f.last_seen || new Date().toISOString()
        }));

      // VOYO only shows VOYO activity
      if (appFilter && appFilter !== APP_CODES.COMMAND_CENTER) {
        return activities.filter(a => a.app === appFilter);
      }

      return activities;
    } catch (err) {
      console.error('[DAHUB] Failed to get friends activity:', err);
      return [];
    }
  },

  async getOnlineByApp(userId: string): Promise<Record<string, number>> {
    try {
      const friends = await friendsAPI.getFriends(userId);

      const counts: Record<string, number> = {};
      friends
        .filter(f => f.status === 'online')
        .forEach(f => {
          const app = f.current_app || 'other';
          counts[app] = (counts[app] || 0) + 1;
        });

      return counts;
    } catch (err) {
      return {};
    }
  }
};

// ==============================================
// APP DISPLAY HELPERS
// ==============================================

export const APP_DISPLAY = {
  CC: { name: 'Command Center', color: '#8b5cf6', icon: 'command' },
  V: { name: 'VOYO', color: '#a855f7', icon: 'music' },
  E: { name: 'DASH EDU', color: '#3b82f6', icon: 'graduation-cap' },
  TV: { name: 'TV+', color: '#ef4444', icon: 'tv' },
  DC: { name: 'DaClub', color: '#f97316', icon: 'users' },
  DF: { name: 'Fashion', color: '#ec4899', icon: 'shirt' },
  DT: { name: 'Travel', color: '#14b8a6', icon: 'plane' },
} as Record<string, { name: string; color: string; icon: string }>;

export function getAppDisplay(appCode: string | null) {
  return APP_DISPLAY[appCode || 'CC'] || APP_DISPLAY.CC;
}

export function formatActivity(activity: string | undefined, appCode: string | null): string {
  if (!activity) return 'Online';
  const app = getAppDisplay(appCode);
  return `${activity} on ${app.name}`;
}

export default {
  friends: friendsAPI,
  messages: messagesAPI,
  presence: presenceAPI,
  activity: activityAPI,
  APP_CODES,
  APP_DISPLAY,
  SERVICE_DISPLAY,
  getAppDisplay,
  formatActivity
};

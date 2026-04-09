/**
 * VOYO Brain - Signal Emitter
 *
 * Central nervous system capturing ALL user signals.
 * 60+ signal types - nothing is missed.
 *
 * Philosophy: Capture everything, let the Brain decide what matters.
 *
 * Categories:
 * 1. Playback Signals - What they're doing with music
 * 2. Reaction Signals - How they feel about it
 * 3. MixBoard Signals - What vibe they want
 * 4. Queue Signals - What they're planning
 * 5. Discovery Signals - What they're exploring
 * 6. Social Signals - Who they're connecting with
 * 7. Context Signals - Environment and timing
 * 8. Boost Signals - Explicit preferences
 * 9. Mix Signals - Pre-curated mix interactions
 */

// ============================================
// SIGNAL TYPES
// ============================================

export type PlaybackSignal =
  | 'play'
  | 'pause'
  | 'resume'
  | 'skip'
  | 'complete'
  | 'replay'
  | 'seek'
  | 'seek_back'
  | 'volume_change'
  | 'rate_change';

export type ReactionSignal =
  | 'oye'           // Single tap
  | 'oye_hold'      // Long press
  | 'oye_position'  // Timed reaction
  | 'love'          // Explicit like
  | 'unlove'        // Remove like
  | 'dislike';      // Explicit dislike

export type MixBoardSignal =
  | 'bar_change'
  | 'drag_to_queue'
  | 'mode_tap'
  | 'mixboard_open'
  | 'mixboard_close';

export type QueueSignal =
  | 'queue_add'
  | 'queue_remove'
  | 'queue_reorder'
  | 'queue_clear'
  | 'play_from_queue';

export type DiscoverySignal =
  | 'search'
  | 'search_click'
  | 'search_cancel'
  | 'album_explore'
  | 'artist_explore'
  | 'related_click'
  | 'trending_click'
  | 'hot_click'
  | 'discovery_click';

export type SocialSignal =
  | 'portal_join'
  | 'portal_leave'
  | 'portal_create'
  | 'dm_send'
  | 'dm_about_track'
  | 'profile_view'
  | 'follow'
  | 'unfollow'
  | 'playlist_share';

export type ContextSignal =
  | 'time_of_day'
  | 'day_of_week'
  | 'session_start'
  | 'session_end'
  | 'session_length'
  | 'return_after'
  | 'device'
  | 'network'
  | 'battery'
  | 'headphones'
  | 'location_type';

export type EngagementPattern =
  | 'skip_streak'
  | 'complete_streak'
  | 'oye_streak'
  | 'mode_loyalty'
  | 'mode_hopping'
  | 'pace_change'
  | 'attention_drop';

export type BoostSignal =
  | 'boost_track'
  | 'boost_album'
  | 'boost_playlist'
  | 'unboost'
  | 'offline_play';

export type MixSignal =
  | 'mix_start'
  | 'mix_seek'
  | 'mix_exit'
  | 'mix_complete'
  | 'mix_replay'
  | 'mix_save';

export type YouTubeSignal =
  | 'youtube_recommendations'
  | 'youtube_recurring';

export type SignalType =
  | PlaybackSignal
  | ReactionSignal
  | MixBoardSignal
  | QueueSignal
  | DiscoverySignal
  | SocialSignal
  | ContextSignal
  | EngagementPattern
  | BoostSignal
  | MixSignal
  | YouTubeSignal;

// ============================================
// SIGNAL DATA STRUCTURES
// ============================================

export interface BaseSignal {
  type: SignalType;
  timestamp: string;
  sessionId: string;
}

export interface PlaybackPayload extends BaseSignal {
  type: PlaybackSignal;
  trackId: string;
  videoId: string;
  artist: string;
  title: string;
  duration?: number;
  position?: number;
  completionRate?: number;
  previousVolume?: number;
  newVolume?: number;
  previousRate?: number;
  newRate?: number;
}

export interface ReactionPayload extends BaseSignal {
  type: ReactionSignal;
  trackId: string;
  videoId: string;
  position?: number;       // Where in track (for oye_position)
  holdDuration?: number;   // For oye_hold
  intensity?: number;      // 1-5 scale for hold reactions
}

export interface MixBoardPayload extends BaseSignal {
  type: MixBoardSignal;
  modeId?: string;
  previousBars?: number;
  newBars?: number;
  trackDragged?: string;
}

export interface QueuePayload extends BaseSignal {
  type: QueueSignal;
  trackId?: string;
  videoId?: string;
  fromPosition?: number;
  toPosition?: number;
  queueLength?: number;
}

export interface DiscoveryPayload extends BaseSignal {
  type: DiscoverySignal;
  query?: string;
  resultCount?: number;
  clickedTrackId?: string;
  clickedArtist?: string;
  clickedAlbum?: string;
  source?: 'search' | 'trending' | 'hot' | 'discovery' | 'related';
}

export interface SocialPayload extends BaseSignal {
  type: SocialSignal;
  portalId?: string;
  userId?: string;
  trackShared?: string;
  playlistShared?: string;
}

export interface ContextPayload extends BaseSignal {
  type: ContextSignal;
  value: string | number;
  previousValue?: string | number;
}

export interface EngagementPayload extends BaseSignal {
  type: EngagementPattern;
  count: number;
  trackIds?: string[];
  modeId?: string;
  fromPace?: string;
  toPace?: string;
}

export interface BoostPayload extends BaseSignal {
  type: BoostSignal;
  targetId: string;
  targetType: 'track' | 'album' | 'playlist';
}

export interface MixPayload extends BaseSignal {
  type: MixSignal;
  mixId: string;
  mixTitle: string;
  mixDuration: number;
  position?: number;
  watchedDuration?: number;
}

export interface YouTubePayload extends BaseSignal {
  type: YouTubeSignal;
  sourceTrackId: string;
  recommendations?: Array<{
    videoId: string;
    title: string;
    duration?: number;
    detectedType: 'track' | 'mix' | 'live' | 'remix';
    detectedVibe?: string;
    position: number;
  }>;
  recurringIds?: Array<{
    videoId: string;
    count: number;
    positions: number[];
  }>;
}

export type SignalPayload =
  | PlaybackPayload
  | ReactionPayload
  | MixBoardPayload
  | QueuePayload
  | DiscoveryPayload
  | SocialPayload
  | ContextPayload
  | EngagementPayload
  | BoostPayload
  | MixPayload
  | YouTubePayload;

// ============================================
// SIGNAL EMITTER CLASS
// ============================================

type SignalListener = (signal: SignalPayload) => void;

class SignalEmitter {
  private listeners: Map<SignalType | '*', Set<SignalListener>> = new Map();
  private sessionId: string;
  private signalCount: number = 0;

  constructor() {
    this.sessionId = this.generateSessionId();
    console.log('[Brain] SignalEmitter initialized, session:', this.sessionId);
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  newSession(): string {
    this.sessionId = this.generateSessionId();
    this.signalCount = 0;
    this.emit('session_start', { value: this.sessionId });
    return this.sessionId;
  }

  getSignalCount(): number {
    return this.signalCount;
  }

  // ============================================
  // SUBSCRIPTION
  // ============================================

  on(type: SignalType | '*', listener: SignalListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(type)?.delete(listener);
    };
  }

  off(type: SignalType | '*', listener: SignalListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  // ============================================
  // EMISSION
  // ============================================

  emit<T extends Partial<SignalPayload>>(type: SignalType, payload: Omit<T, 'type' | 'timestamp' | 'sessionId'>): void {
    const fullPayload: SignalPayload = {
      ...payload,
      type,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
    } as SignalPayload;

    this.signalCount++;

    // Notify specific listeners
    this.listeners.get(type)?.forEach(listener => {
      try {
        listener(fullPayload);
      } catch (err) {
        console.error(`[Brain] Signal listener error for ${type}:`, err);
      }
    });

    // Notify wildcard listeners
    this.listeners.get('*')?.forEach(listener => {
      try {
        listener(fullPayload);
      } catch (err) {
        console.error(`[Brain] Wildcard listener error:`, err);
      }
    });
  }

  // ============================================
  // CONVENIENCE METHODS - PLAYBACK
  // ============================================

  play(track: { trackId: string; videoId: string; artist: string; title: string }): void {
    this.emit<PlaybackPayload>('play', track);
  }

  pause(track: { trackId: string; videoId: string; artist: string; title: string; position?: number }): void {
    this.emit<PlaybackPayload>('pause', track);
  }

  resume(track: { trackId: string; videoId: string; artist: string; title: string; position?: number }): void {
    this.emit<PlaybackPayload>('resume', track);
  }

  skip(track: { trackId: string; videoId: string; artist: string; title: string; position?: number; completionRate?: number }): void {
    this.emit<PlaybackPayload>('skip', track);
  }

  complete(track: { trackId: string; videoId: string; artist: string; title: string; duration?: number }): void {
    this.emit<PlaybackPayload>('complete', track);
  }

  replay(track: { trackId: string; videoId: string; artist: string; title: string }): void {
    this.emit<PlaybackPayload>('replay', track);
  }

  seek(track: { trackId: string; videoId: string; artist: string; title: string; position: number }): void {
    this.emit<PlaybackPayload>('seek', track);
  }

  seekBack(track: { trackId: string; videoId: string; artist: string; title: string; position: number }): void {
    this.emit<PlaybackPayload>('seek_back', track);
  }

  // ============================================
  // CONVENIENCE METHODS - REACTIONS
  // ============================================

  oye(track: { trackId: string; videoId: string }): void {
    this.emit<ReactionPayload>('oye', track);
  }

  oyeHold(track: { trackId: string; videoId: string; holdDuration: number; intensity: number }): void {
    this.emit<ReactionPayload>('oye_hold', track);
  }

  oyePosition(track: { trackId: string; videoId: string; position: number }): void {
    this.emit<ReactionPayload>('oye_position', track);
  }

  love(track: { trackId: string; videoId: string }): void {
    this.emit<ReactionPayload>('love', track);
  }

  unlove(track: { trackId: string; videoId: string }): void {
    this.emit<ReactionPayload>('unlove', track);
  }

  dislike(track: { trackId: string; videoId: string }): void {
    this.emit<ReactionPayload>('dislike', track);
  }

  // ============================================
  // CONVENIENCE METHODS - MIXBOARD
  // ============================================

  barChange(modeId: string, previousBars: number, newBars: number): void {
    this.emit<MixBoardPayload>('bar_change', { modeId, previousBars, newBars });
  }

  dragToQueue(modeId: string, trackDragged?: string): void {
    this.emit<MixBoardPayload>('drag_to_queue', { modeId, trackDragged });
  }

  modeTap(modeId: string): void {
    this.emit<MixBoardPayload>('mode_tap', { modeId });
  }

  mixboardOpen(): void {
    this.emit<MixBoardPayload>('mixboard_open', {});
  }

  mixboardClose(): void {
    this.emit<MixBoardPayload>('mixboard_close', {});
  }

  // ============================================
  // CONVENIENCE METHODS - QUEUE
  // ============================================

  queueAdd(track: { trackId: string; videoId: string; queueLength: number }): void {
    this.emit<QueuePayload>('queue_add', track);
  }

  queueRemove(track: { trackId: string; videoId: string; queueLength: number }): void {
    this.emit<QueuePayload>('queue_remove', track);
  }

  queueReorder(fromPosition: number, toPosition: number, queueLength: number): void {
    this.emit<QueuePayload>('queue_reorder', { fromPosition, toPosition, queueLength });
  }

  queueClear(previousLength: number): void {
    this.emit<QueuePayload>('queue_clear', { queueLength: 0, fromPosition: previousLength });
  }

  playFromQueue(track: { trackId: string; videoId: string; fromPosition: number }): void {
    this.emit<QueuePayload>('play_from_queue', track);
  }

  // ============================================
  // CONVENIENCE METHODS - DISCOVERY
  // ============================================

  search(query: string, resultCount: number): void {
    this.emit<DiscoveryPayload>('search', { query, resultCount, source: 'search' });
  }

  searchClick(track: { trackId: string; artist?: string; query?: string }): void {
    this.emit<DiscoveryPayload>('search_click', { clickedTrackId: track.trackId, clickedArtist: track.artist, query: track.query, source: 'search' });
  }

  searchCancel(): void {
    this.emit<DiscoveryPayload>('search_cancel', {});
  }

  artistExplore(artist: string): void {
    this.emit<DiscoveryPayload>('artist_explore', { clickedArtist: artist });
  }

  albumExplore(album: string, artist?: string): void {
    this.emit<DiscoveryPayload>('album_explore', { clickedAlbum: album, clickedArtist: artist });
  }

  hotClick(track: { trackId: string }): void {
    this.emit<DiscoveryPayload>('hot_click', { clickedTrackId: track.trackId, source: 'hot' });
  }

  discoveryClick(track: { trackId: string }): void {
    this.emit<DiscoveryPayload>('discovery_click', { clickedTrackId: track.trackId, source: 'discovery' });
  }

  relatedClick(track: { trackId: string }): void {
    this.emit<DiscoveryPayload>('related_click', { clickedTrackId: track.trackId, source: 'related' });
  }

  trendingClick(track: { trackId: string }): void {
    this.emit<DiscoveryPayload>('trending_click', { clickedTrackId: track.trackId, source: 'trending' });
  }

  // ============================================
  // CONVENIENCE METHODS - SOCIAL
  // ============================================

  portalJoin(portalId: string): void {
    this.emit<SocialPayload>('portal_join', { portalId });
  }

  portalLeave(portalId: string): void {
    this.emit<SocialPayload>('portal_leave', { portalId });
  }

  portalCreate(portalId: string): void {
    this.emit<SocialPayload>('portal_create', { portalId });
  }

  profileView(userId: string): void {
    this.emit<SocialPayload>('profile_view', { userId });
  }

  follow(userId: string): void {
    this.emit<SocialPayload>('follow', { userId });
  }

  unfollow(userId: string): void {
    this.emit<SocialPayload>('unfollow', { userId });
  }

  // ============================================
  // CONVENIENCE METHODS - CONTEXT
  // ============================================

  sessionStart(): void {
    this.emit<ContextPayload>('session_start', { value: this.sessionId });
  }

  sessionEnd(sessionLength: number): void {
    this.emit<ContextPayload>('session_end', { value: sessionLength });
  }

  contextChange(type: ContextSignal, value: string | number, previousValue?: string | number): void {
    this.emit<ContextPayload>(type, { value, previousValue });
  }

  // ============================================
  // CONVENIENCE METHODS - ENGAGEMENT PATTERNS
  // ============================================

  skipStreak(count: number, trackIds: string[]): void {
    this.emit<EngagementPayload>('skip_streak', { count, trackIds });
  }

  completeStreak(count: number, trackIds: string[]): void {
    this.emit<EngagementPayload>('complete_streak', { count, trackIds });
  }

  oyeStreak(count: number, trackIds: string[]): void {
    this.emit<EngagementPayload>('oye_streak', { count, trackIds });
  }

  modeLoyalty(modeId: string, count: number): void {
    this.emit<EngagementPayload>('mode_loyalty', { count, modeId });
  }

  modeHopping(count: number): void {
    this.emit<EngagementPayload>('mode_hopping', { count });
  }

  paceChange(fromPace: string, toPace: string): void {
    this.emit<EngagementPayload>('pace_change', { count: 1, fromPace, toPace });
  }

  attentionDrop(): void {
    this.emit<EngagementPayload>('attention_drop', { count: 1 });
  }

  // ============================================
  // CONVENIENCE METHODS - BOOST
  // ============================================

  boostTrack(trackId: string): void {
    this.emit<BoostPayload>('boost_track', { targetId: trackId, targetType: 'track' });
  }

  boostAlbum(albumId: string): void {
    this.emit<BoostPayload>('boost_album', { targetId: albumId, targetType: 'album' });
  }

  boostPlaylist(playlistId: string): void {
    this.emit<BoostPayload>('boost_playlist', { targetId: playlistId, targetType: 'playlist' });
  }

  unboost(targetId: string, targetType: 'track' | 'album' | 'playlist'): void {
    this.emit<BoostPayload>('unboost', { targetId, targetType });
  }

  offlinePlay(trackId: string): void {
    this.emit<BoostPayload>('offline_play', { targetId: trackId, targetType: 'track' });
  }

  // ============================================
  // CONVENIENCE METHODS - MIX
  // ============================================

  mixStart(mix: { mixId: string; mixTitle: string; mixDuration: number }): void {
    this.emit<MixPayload>('mix_start', mix);
  }

  mixSeek(mix: { mixId: string; mixTitle: string; mixDuration: number; position: number }): void {
    this.emit<MixPayload>('mix_seek', mix);
  }

  mixExit(mix: { mixId: string; mixTitle: string; mixDuration: number; watchedDuration: number }): void {
    this.emit<MixPayload>('mix_exit', mix);
  }

  mixComplete(mix: { mixId: string; mixTitle: string; mixDuration: number }): void {
    this.emit<MixPayload>('mix_complete', mix);
  }

  mixReplay(mix: { mixId: string; mixTitle: string; mixDuration: number }): void {
    this.emit<MixPayload>('mix_replay', mix);
  }

  mixSave(mix: { mixId: string; mixTitle: string; mixDuration: number }): void {
    this.emit<MixPayload>('mix_save', mix);
  }

  // ============================================
  // CONVENIENCE METHODS - YOUTUBE INTERCEPTOR
  // ============================================

  youtubeRecommendations(sourceTrackId: string, recommendations: YouTubePayload['recommendations']): void {
    this.emit<YouTubePayload>('youtube_recommendations', { sourceTrackId, recommendations });
  }

  youtubeRecurring(sourceTrackId: string, recurringIds: YouTubePayload['recurringIds']): void {
    this.emit<YouTubePayload>('youtube_recurring', { sourceTrackId, recurringIds });
  }
}

// Singleton instance
export const signals = new SignalEmitter();

export default signals;

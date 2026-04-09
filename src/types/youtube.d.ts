/**
 * YouTube IFrame API Type Definitions
 */

declare namespace YT {
  interface Player {
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    setVolume(volume: number): void;
    getVolume(): number;
    mute(): void;
    unMute(): void;
    isMuted(): boolean;
    getCurrentTime(): number;
    getDuration(): number;
    getVideoLoadedFraction(): number;
    getPlayerState(): number;
    destroy(): void;
  }

  interface PlayerOptions {
    height?: string | number;
    width?: string | number;
    videoId?: string;
    playerVars?: PlayerVars;
    events?: PlayerEvents;
  }

  interface PlayerVars {
    autoplay?: 0 | 1;
    cc_load_policy?: 0 | 1;
    color?: 'red' | 'white';
    controls?: 0 | 1 | 2;
    disablekb?: 0 | 1;
    enablejsapi?: 0 | 1;
    end?: number;
    fs?: 0 | 1;
    hl?: string;
    iv_load_policy?: 1 | 3;
    list?: string;
    listType?: 'playlist' | 'search' | 'user_uploads';
    loop?: 0 | 1;
    modestbranding?: 0 | 1;
    origin?: string;
    playlist?: string;
    playsinline?: 0 | 1;
    rel?: 0 | 1;
    showinfo?: 0 | 1;
    start?: number;
  }

  interface PlayerEvents {
    onReady?: (event: PlayerEvent) => void;
    onStateChange?: (event: OnStateChangeEvent) => void;
    onPlaybackQualityChange?: (event: OnPlaybackQualityChangeEvent) => void;
    onPlaybackRateChange?: (event: OnPlaybackRateChangeEvent) => void;
    onError?: (event: OnErrorEvent) => void;
    onApiChange?: (event: PlayerEvent) => void;
  }

  interface PlayerEvent {
    target: Player;
  }

  interface OnStateChangeEvent extends PlayerEvent {
    data: PlayerState;
  }

  interface OnPlaybackQualityChangeEvent extends PlayerEvent {
    data: string;
  }

  interface OnPlaybackRateChangeEvent extends PlayerEvent {
    data: number;
  }

  interface OnErrorEvent extends PlayerEvent {
    data: number;
  }

  enum PlayerState {
    UNSTARTED = -1,
    ENDED = 0,
    PLAYING = 1,
    PAUSED = 2,
    BUFFERING = 3,
    CUED = 5,
  }
}

interface Window {
  YT: {
    Player: new (elementId: string, options: YT.PlayerOptions) => YT.Player;
    PlayerState: typeof YT.PlayerState;
  };
  onYouTubeIframeAPIReady: () => void;
}

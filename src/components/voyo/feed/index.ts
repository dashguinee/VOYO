/**
 * VOYO Feed Components
 *
 * The Social Music Discovery Feed - TikTok meets Spotify
 *
 * Components:
 * - VoyoVerticalFeed: Main feed with snap scrolling
 * - FeedCard: Individual track card
 * - VideoSnippet: YouTube iframe embed
 * - AnimatedArtCard: Album art with visual effects
 * - ContentMixer: Chooses content type per track
 * - FloatingReactions: TikTok Live style rising reactions
 * - ContinuePlayingButton: Engagement hook to full player
 * - AudioVisualizer: Animated bars
 */

export { VoyoVerticalFeed } from './VoyoVerticalFeed';
export { VideoSnippet } from './VideoSnippet';
export { AnimatedArtCard, extractDominantColor, type ArtDisplayMode } from './AnimatedArtCard';
export { ContentMixer, type ContentType } from './ContentMixer';
export { DynamicVignette, useVignetteController, VignettePresets } from './DynamicVignette';
export { FloatingReactions, useFloatingReactions, useDoubleTap } from './FloatingReactions';
export { ContinuePlayingButton } from './ContinuePlayingButton';
export { AudioVisualizer, CircularVisualizer, WaveformVisualizer } from './AudioVisualizer';
export {
  ParallaxBackground,
  ScaleOnScroll,
  useSmoothSnapScroll,
  CrossfadeOverlay,
  PeekPreview,
  useEngagementTracker,
} from './FeedTransitions';

/**
 * player — the dumb playback layer.
 *
 * What UI imports:
 *   import { usePlayback } from '@/player'
 *
 * Internals (iframe bridge, hot-swap, cross-fade) stay private.
 */

export { usePlayback, type Playback } from './usePlayback';
export { useHotSwap } from './useHotSwap';
export { iframeBridge } from './iframeBridge';

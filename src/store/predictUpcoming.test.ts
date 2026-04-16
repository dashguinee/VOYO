/**
 * predictUpcoming — v214 unit tests.
 *
 * Covers: queue-first priority, discover-pool fallback, exclusion of
 * history + current + already-picked + blocklist, uniqueness, stops at
 * n tracks, returns empty when no candidates.
 *
 * Uses Zustand's direct state hydration rather than spinning up the full
 * store — we just need predictUpcoming's pure reducer-like behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the services that the store imports but we don't exercise.
vi.mock('../services/telemetry', () => ({
  trace: vi.fn(),
  logPlaybackEvent: vi.fn(),
}));
vi.mock('../services/poolStore', () => ({
  recordPoolEngagement: vi.fn(),
  prefetchTrack: vi.fn(),
}));
vi.mock('../services/oyoDJ', () => ({
  oyoOnTrackSkip: vi.fn(),
  oyoOnTrackComplete: vi.fn(),
}));
vi.mock('../services/trackBlocklist', () => ({
  isBlocked: (id: string) => BLOCKED.has(id),
  markBlocked: vi.fn(),
  isBlocklisted: (id: string) => BLOCKED.has(id),
  isKnownUnplayable: () => false,
}));
vi.mock('../services/artistDiscovery', () => ({
  recordArtistListen: vi.fn(),
}));
vi.mock('../services/persistentState', () => ({
  loadPersistedState: () => ({}),
  savePersistedState: vi.fn(),
}));
vi.mock('../data/tracks', () => ({
  TRACKS: [],
}));
vi.mock('../services/getThumb', () => ({
  getThumb: () => '',
}));
// Block-list set tests can populate.
const BLOCKED = new Set<string>();

import { usePlayerStore } from './playerStore';
import type { Track } from '../types';

function mkTrack(id: string, title = id): Track {
  return {
    id,
    trackId: id,
    title,
    artist: 'Test Artist',
    coverUrl: '',
    duration: 180,
  } as Track;
}

describe('predictUpcoming (v214)', () => {
  beforeEach(() => {
    BLOCKED.clear();
    usePlayerStore.setState({
      currentTrack: null,
      queue: [],
      history: [],
      discoverTracks: [],
      hotTracks: [],
    } as any);
  });

  it('returns queue items first when queue is populated', () => {
    usePlayerStore.setState({
      queue: [
        { track: mkTrack('q1'), addedAt: new Date().toISOString(), source: 'manual' },
        { track: mkTrack('q2'), addedAt: new Date().toISOString(), source: 'manual' },
      ],
    } as any);
    const got = usePlayerStore.getState().predictUpcoming(2);
    expect(got.map(t => t.trackId)).toEqual(['q1', 'q2']);
  });

  it('fills from discover pool when queue is shorter than n', () => {
    usePlayerStore.setState({
      queue: [
        { track: mkTrack('q1'), addedAt: new Date().toISOString(), source: 'manual' },
      ],
      discoverTracks: [mkTrack('d1'), mkTrack('d2'), mkTrack('d3')],
    } as any);
    const got = usePlayerStore.getState().predictUpcoming(3);
    expect(got.map(t => t.trackId)).toEqual(['q1', 'd1', 'd2']);
  });

  it('excludes current track', () => {
    usePlayerStore.setState({
      currentTrack: mkTrack('current'),
      discoverTracks: [mkTrack('current'), mkTrack('d1'), mkTrack('d2')],
    } as any);
    const got = usePlayerStore.getState().predictUpcoming(2);
    expect(got.map(t => t.trackId)).toEqual(['d1', 'd2']);
  });

  it('excludes recent history (last 20 plays)', () => {
    usePlayerStore.setState({
      history: [
        { track: mkTrack('h1'), playedAt: '', duration: 0 },
        { track: mkTrack('h2'), playedAt: '', duration: 0 },
      ],
      discoverTracks: [mkTrack('h1'), mkTrack('h2'), mkTrack('d1'), mkTrack('d2')],
    } as any);
    const got = usePlayerStore.getState().predictUpcoming(2);
    expect(got.map(t => t.trackId)).toEqual(['d1', 'd2']);
  });

  it('excludes blocklisted tracks', () => {
    BLOCKED.add('blocked1');
    BLOCKED.add('blocked2');
    usePlayerStore.setState({
      discoverTracks: [mkTrack('blocked1'), mkTrack('d1'), mkTrack('blocked2'), mkTrack('d2')],
    } as any);
    const got = usePlayerStore.getState().predictUpcoming(3);
    expect(got.map(t => t.trackId)).toEqual(['d1', 'd2']);
  });

  it('does not return duplicates across queue + pool', () => {
    usePlayerStore.setState({
      queue: [
        { track: mkTrack('shared'), addedAt: new Date().toISOString(), source: 'manual' },
      ],
      discoverTracks: [mkTrack('shared'), mkTrack('d1')],
    } as any);
    const got = usePlayerStore.getState().predictUpcoming(3);
    expect(got.map(t => t.trackId)).toEqual(['shared', 'd1']);
  });

  it('stops at n, does not over-fill', () => {
    usePlayerStore.setState({
      discoverTracks: [mkTrack('d1'), mkTrack('d2'), mkTrack('d3'), mkTrack('d4'), mkTrack('d5')],
    } as any);
    expect(usePlayerStore.getState().predictUpcoming(2).length).toBe(2);
    expect(usePlayerStore.getState().predictUpcoming(3).length).toBe(3);
    expect(usePlayerStore.getState().predictUpcoming(5).length).toBe(5);
  });

  it('returns empty when queue + pools are all exhausted by exclusions', () => {
    usePlayerStore.setState({
      currentTrack: mkTrack('current'),
      history: [{ track: mkTrack('h1'), playedAt: '', duration: 0 }],
      discoverTracks: [mkTrack('current'), mkTrack('h1')],
    } as any);
    const got = usePlayerStore.getState().predictUpcoming(3);
    expect(got).toEqual([]);
  });

  it('falls back to hotTracks when discoverTracks is empty', () => {
    usePlayerStore.setState({
      discoverTracks: [],
      hotTracks: [mkTrack('h1'), mkTrack('h2')],
    } as any);
    const got = usePlayerStore.getState().predictUpcoming(2);
    expect(got.map(t => t.trackId)).toEqual(['h1', 'h2']);
  });

  it('defaults to n=2 when no argument passed', () => {
    usePlayerStore.setState({
      discoverTracks: [mkTrack('d1'), mkTrack('d2'), mkTrack('d3')],
    } as any);
    const got = usePlayerStore.getState().predictUpcoming();
    expect(got.length).toBe(2);
  });
});

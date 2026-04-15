/**
 * Playback state machine tests — validates allowed transitions + the
 * guard that silently rejects illegal moves.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { playbackState } from './playbackState';

describe('playbackState', () => {
  beforeEach(() => {
    playbackState._reset();
  });

  it('starts at idle', () => {
    const s = playbackState.get();
    expect(s.state).toBe('idle');
    expect(s.trackId).toBeNull();
    expect(s.prev).toBeNull();
  });

  it('transitions idle → loading → playing', () => {
    playbackState.transition('loading', 'abc', 'load_start');
    expect(playbackState.get().state).toBe('loading');
    expect(playbackState.get().trackId).toBe('abc');
    expect(playbackState.get().prev).toBe('idle');

    playbackState.transition('playing', 'abc', 'canplay');
    expect(playbackState.get().state).toBe('playing');
    expect(playbackState.get().prev).toBe('loading');
  });

  it('transitions playing → paused → playing', () => {
    playbackState.transition('loading', 'abc');
    playbackState.transition('playing', 'abc');
    playbackState.transition('paused', 'abc', 'user_pause');
    expect(playbackState.get().state).toBe('paused');
    playbackState.transition('playing', 'abc', 'user_resume');
    expect(playbackState.get().state).toBe('playing');
  });

  it('transitions playing → advancing → loading (natural track end)', () => {
    playbackState.transition('loading', 'abc');
    playbackState.transition('playing', 'abc');
    playbackState.transition('advancing', 'abc', 'natural_ended');
    expect(playbackState.get().state).toBe('advancing');
    playbackState.transition('loading', 'def', 'load_enter');
    expect(playbackState.get().state).toBe('loading');
    expect(playbackState.get().trackId).toBe('def');
  });

  it('silently rejects illegal transitions', () => {
    playbackState.transition('loading', 'abc');
    playbackState.transition('playing', 'abc');
    // playing → idle is not in ALLOWED
    playbackState.transition('idle' as any, null, 'illegal');
    expect(playbackState.get().state).toBe('playing'); // unchanged
  });

  it('allows bridge during transitions', () => {
    playbackState.transition('loading', 'abc');
    playbackState.transition('playing', 'abc');
    playbackState.transition('bridge', 'abc', 'silent_wav_bg');
    expect(playbackState.get().state).toBe('bridge');
    playbackState.transition('loading', 'def', 'load_enter'); // bridge → loading legal
    expect(playbackState.get().state).toBe('loading');
  });

  it('allows user-pause from any active state (v213)', () => {
    // loading → paused (user taps pause mid-load)
    playbackState.transition('loading', 'abc');
    playbackState.transition('paused', 'abc', 'user_pause');
    expect(playbackState.get().state).toBe('paused');

    // bridge → paused (user taps pause during bridge)
    playbackState._reset();
    playbackState.transition('loading', 'abc');
    playbackState.transition('playing', 'abc');
    playbackState.transition('bridge', 'abc', 'silent_wav_bg');
    playbackState.transition('paused', 'abc', 'user_pause');
    expect(playbackState.get().state).toBe('paused');

    // advancing → paused (user taps pause right at track end)
    playbackState._reset();
    playbackState.transition('loading', 'abc');
    playbackState.transition('playing', 'abc');
    playbackState.transition('advancing', 'abc', 'natural_ended');
    playbackState.transition('paused', 'abc', 'user_pause');
    expect(playbackState.get().state).toBe('paused');
  });

  it('error state can recover to loading', () => {
    playbackState.transition('loading', 'abc');
    playbackState.transition('playing', 'abc');
    playbackState.transition('error', 'abc', 'audio_error');
    playbackState.transition('loading', 'abc', 'recovery_retry');
    expect(playbackState.get().state).toBe('loading');
  });

  it('self-transition is a no-op (but can update trackId)', () => {
    playbackState.transition('loading', 'abc');
    const first = playbackState.get();
    playbackState.transition('loading', 'abc', 'retry'); // same state + trackId
    const second = playbackState.get();
    expect(second.since).toBe(first.since); // no update
    playbackState.transition('loading', 'def', 'new_track'); // same state, new trackId
    expect(playbackState.get().trackId).toBe('def');
  });

  it('subscribers receive every transition', () => {
    const events: string[] = [];
    const unsub = playbackState.subscribe(s => events.push(s.state));
    playbackState.transition('loading', 'abc');
    playbackState.transition('playing', 'abc');
    playbackState.transition('paused', 'abc');
    expect(events).toEqual(['loading', 'playing', 'paused']);
    unsub();
    playbackState.transition('playing', 'abc');
    expect(events.length).toBe(3); // unsubbed, no more events
  });

  it('tracks dwell time via since + prev', () => {
    playbackState.transition('loading', 'abc');
    const loadingStart = playbackState.get().since;
    playbackState.transition('playing', 'abc');
    expect(playbackState.get().since).toBeGreaterThanOrEqual(loadingStart);
    expect(playbackState.get().prev).toBe('loading');
  });
});

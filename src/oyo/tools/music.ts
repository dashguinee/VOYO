/**
 * OYO Music Tools — The actions OYO can take inside VOYO Music.
 *
 * Each tool wraps an action the VOYO player already supports. When OYO
 * emits a <tool_call>, the registry dispatches to one of these handlers.
 * They are the only bridge from OYO's brain to the rest of the app — keeping
 * the intelligence layer cleanly decoupled from store implementation details.
 *
 * Tools are resilient: stores may not be available during SSR/build, so
 * every tool wraps its store access in try/catch and returns a ToolResult
 * with success=false on failure rather than throwing.
 */

import type { ToolDefinition, ToolResult } from './types';
import { usePlayerStore } from '../../store/playerStore';
import { useTrackPoolStore } from '../../store/trackPoolStore';
import { app } from '../../services/oyo';
import type { Track } from '../../types';
import { searchEssences, saveEssence } from '../memory';
import type { MemoryCategory } from '../schema';
import { currentTimeOfDay } from '../pattern';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(tool: string, data: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', tool, success: true, data, metadata };
}

function fail(tool: string, data: string): ToolResult {
  return { toolCallId: '', tool, success: false, data };
}

function findTrackById(trackId: string): Track | null {
  try {
    const pool = useTrackPoolStore.getState();
    const all = [...pool.hotPool, ...pool.coldPool];
    return all.find((t) => t.trackId === trackId || t.id === trackId) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// playTrack
// ---------------------------------------------------------------------------

const playTrackTool: ToolDefinition = {
  name: 'playTrack',
  description: 'Play a specific track immediately. Requires a trackId.',
  parameters: [
    { name: 'trackId', type: 'string', description: 'The VOYO track id', required: true },
    {
      name: 'andStartShuffle',
      type: 'boolean',
      description: 'If true, enable shuffle after playing',
      required: false,
    },
  ],
  execute: async (params) => {
    const { trackId, andStartShuffle } = params;
    if (!trackId) return fail('playTrack', 'Missing trackId');

    const track = findTrackById(trackId);
    if (!track) return fail('playTrack', `Track not found in pool: ${trackId}`);

    try {
      const player = usePlayerStore.getState();
      player.playTrack(track);
      if (andStartShuffle === 'true') {
        player.toggleShuffle();
      }
      return ok('playTrack', `Playing ${track.title} by ${track.artist}`);
    } catch (err) {
      return fail('playTrack', `Failed to play: ${String(err)}`);
    }
  },
};

// ---------------------------------------------------------------------------
// addToQueue
// ---------------------------------------------------------------------------

const addToQueueTool: ToolDefinition = {
  name: 'addToQueue',
  description: 'Add one track to the queue (by trackId). Optionally specify position.',
  parameters: [
    { name: 'trackId', type: 'string', description: 'The VOYO track id', required: true },
    {
      name: 'position',
      type: 'number',
      description: 'Queue position (default end)',
      required: false,
    },
  ],
  execute: async (params) => {
    const { trackId, position } = params;
    if (!trackId) return fail('addToQueue', 'Missing trackId');

    const track = findTrackById(trackId);
    if (!track) return fail('addToQueue', `Track not found in pool: ${trackId}`);

    try {
      const pos = position ? parseInt(position, 10) : undefined;
      // Routed through app.oyeCommit so every AI-driven queue action also
      // warms R2 + fires the OYE signal graph. Keeps the tool's observable
      // contract unchanged (name="addToQueue") while the underlying effect
      // is the unified Oye gesture.
      app.oyeCommit(track, { position: Number.isFinite(pos) ? pos : undefined });
      return ok('addToQueue', `Queued ${track.title} by ${track.artist}`);
    } catch (err) {
      return fail('addToQueue', `Failed to queue: ${String(err)}`);
    }
  },
};

// ---------------------------------------------------------------------------
// shuffleQueue
// ---------------------------------------------------------------------------

const shuffleQueueTool: ToolDefinition = {
  name: 'shuffleQueue',
  description: 'Toggle shuffle mode on the current queue.',
  parameters: [],
  execute: async () => {
    try {
      const player = usePlayerStore.getState();
      player.toggleShuffle();
      return ok('shuffleQueue', 'Shuffle toggled');
    } catch (err) {
      return fail('shuffleQueue', `Failed to shuffle: ${String(err)}`);
    }
  },
};

// ---------------------------------------------------------------------------
// searchByVibe
// ---------------------------------------------------------------------------

// Maps natural-language vibe keywords → VibeMode for mode-based scoring bonus
const VIBE_MODE_MAP: Array<{ keywords: string[]; mode: string; bonus: number }> = [
  { keywords: ['chill', 'relax', 'mellow', 'calm', 'soft', 'slow', 'quiet', 'easy', 'lofi', 'lo-fi', 'smooth', 'vibes'], mode: 'chill-vibes', bonus: 40 },
  { keywords: ['hype', 'fire', 'energy', 'heat', 'afro', 'hard', 'loud', 'afrobeats', 'intense', 'banger', 'lit'], mode: 'afro-heat', bonus: 40 },
  { keywords: ['party', 'dance', 'club', 'fun', 'turn up', 'turnt', 'celebration', 'groove'], mode: 'party-mode', bonus: 40 },
  { keywords: ['late night', 'midnight', 'dark', 'late', '2am', 'insomnia', 'night', 'moody', 'introspective'], mode: 'late-night', bonus: 40 },
  { keywords: ['workout', 'gym', 'run', 'training', 'sprint', 'pump', 'boost', 'motivation'], mode: 'workout', bonus: 40 },
];

const searchByVibeTool: ToolDefinition = {
  name: 'searchByVibe',
  description:
    'Search the track pool for tracks matching a vibe description (chill, hype, late-night, etc). Returns candidate tracks.',
  parameters: [
    { name: 'vibe', type: 'string', description: 'Vibe description', required: true },
  ],
  execute: async (params) => {
    const { vibe } = params;
    if (!vibe) return fail('searchByVibe', 'Missing vibe');

    try {
      const pool = useTrackPoolStore.getState();
      const lowered = vibe.toLowerCase();

      // Resolve which VibeMode(s) this vibe maps to
      const matchedModes = new Map<string, number>();
      for (const entry of VIBE_MODE_MAP) {
        for (const kw of entry.keywords) {
          if (lowered.includes(kw)) {
            matchedModes.set(entry.mode, Math.max(matchedModes.get(entry.mode) ?? 0, entry.bonus));
            break;
          }
        }
      }

      // Score tracks by text overlap + detectedMode bonus
      const candidates = pool.hotPool
        .map((t) => {
          let score = 0;
          const text = `${t.title} ${t.artist} ${(t.tags || []).join(' ')} ${t.mood || ''}`.toLowerCase();
          for (const word of lowered.split(/\s+/).filter((w) => w.length > 2)) {
            if (text.includes(word)) score += 10;
          }
          if (t.mood && lowered.includes(t.mood)) score += 25;
          // Mode-based bonus — big lift for tracks already classified into the matched mode
          if (matchedModes.has(t.detectedMode)) {
            score += matchedModes.get(t.detectedMode)!;
          }
          return { track: t, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

      if (candidates.length === 0) {
        return ok(
          'searchByVibe',
          `No pooled tracks match "${vibe}". Suggest user searches, then try again.`,
        );
      }

      const formatted = candidates
        .map((c) => `${c.track.trackId}: ${c.track.title} — ${c.track.artist}`)
        .join('\n');
      return ok('searchByVibe', `Matches for "${vibe}":\n${formatted}`, {
        trackIds: candidates.map((c) => c.track.trackId),
      });
    } catch (err) {
      return fail('searchByVibe', `Failed to search: ${String(err)}`);
    }
  },
};

// ---------------------------------------------------------------------------
// recallMemory
// ---------------------------------------------------------------------------

const recallMemoryTool: ToolDefinition = {
  name: 'recallMemory',
  description: 'Search OYO memory for facts about a topic (artist, mood, genre, preference).',
  parameters: [
    { name: 'topic', type: 'string', description: 'Topic to search', required: true },
  ],
  execute: async (params) => {
    const { topic } = params;
    if (!topic) return fail('recallMemory', 'Missing topic');

    try {
      const found = await searchEssences(topic, 6);
      if (found.length === 0) {
        return ok('recallMemory', `No memories about "${topic}" yet.`);
      }
      const formatted = found
        .map((m) => `- ${m.fact} (${m.category}, confidence ${m.confidence.toFixed(2)})`)
        .join('\n');
      return ok('recallMemory', `Remembered about "${topic}":\n${formatted}`);
    } catch (err) {
      return fail('recallMemory', `Recall failed: ${String(err)}`);
    }
  },
};

// ---------------------------------------------------------------------------
// saveMemory
// ---------------------------------------------------------------------------

const saveMemoryTool: ToolDefinition = {
  name: 'saveMemory',
  description: 'Save a new fact about the listener.',
  parameters: [
    { name: 'fact', type: 'string', description: 'The fact to remember', required: true },
    {
      name: 'category',
      type: 'string',
      description:
        'Category: preference, context, identity, mood, artist, genre, habit, cultural',
      required: false,
    },
  ],
  execute: async (params) => {
    const { fact, category } = params;
    if (!fact) return fail('saveMemory', 'Missing fact');

    const validCategories: MemoryCategory[] = [
      'preference',
      'context',
      'identity',
      'mood',
      'artist',
      'genre',
      'habit',
      'cultural',
    ];
    const cat = validCategories.includes(category as MemoryCategory)
      ? (category as MemoryCategory)
      : 'preference';

    try {
      const saved = await saveEssence(fact, cat, 'user-told');
      return ok('saveMemory', `Saved: ${saved.fact}`, { fact: saved.fact, category: cat });
    } catch (err) {
      return fail('saveMemory', `Save failed: ${String(err)}`);
    }
  },
};

// ---------------------------------------------------------------------------
// getCurrentContext
// ---------------------------------------------------------------------------

const getCurrentContextTool: ToolDefinition = {
  name: 'getCurrentContext',
  description: 'Get what is currently playing + time of day + recent plays.',
  parameters: [],
  execute: async () => {
    try {
      const player = usePlayerStore.getState();
      const current = player.currentTrack;
      const recent = player.history.slice(-5);
      const parts: string[] = [];

      parts.push(`Time of day: ${currentTimeOfDay()}`);
      if (current) {
        const genre = current.tags?.[0] ? ` [${current.tags[0]}]` : '';
        parts.push(`Now playing: ${current.title} — ${current.artist}${genre}`);
      } else {
        parts.push('Now playing: nothing');
      }
      if (recent.length > 0) {
        parts.push(
          `Recent:\n${recent.map((h) => {
            const g = h.track.tags?.[0] ? ` [${h.track.tags[0]}]` : '';
            return `  - ${h.track.title} — ${h.track.artist}${g}`;
          }).join('\n')}`,
        );
      }
      if (player.currentMood) {
        parts.push(`Current mood: ${player.currentMood}`);
      }

      return ok('getCurrentContext', parts.join('\n'));
    } catch (err) {
      return fail('getCurrentContext', `Context read failed: ${String(err)}`);
    }
  },
};

// ---------------------------------------------------------------------------
// PLAYBACK CONTROL — The OS-layer tools.
// Without these, OYO can pick music but can't CONTROL playback.
// With these, voice/chat can drive every playback action:
//   "pause" / "resume" / "skip" / "back" / "volume up" / "mute" / "jump ahead 30s"
// ---------------------------------------------------------------------------

const togglePlayTool: ToolDefinition = {
  name: 'togglePlay',
  description: 'Toggle play/pause. Use for "pause", "resume", "play" (when a track is loaded).',
  parameters: [],
  execute: async () => {
    try {
      const player = usePlayerStore.getState();
      const wasPlaying = player.isPlaying;
      player.togglePlay();
      return ok('togglePlay', wasPlaying ? 'Paused' : 'Playing');
    } catch (err) {
      return fail('togglePlay', `Failed: ${String(err)}`);
    }
  },
};

const nextTrackTool: ToolDefinition = {
  name: 'nextTrack',
  description: 'Skip to the next track. Use for "next", "skip", "forward".',
  parameters: [],
  execute: async () => {
    try {
      const player = usePlayerStore.getState();
      const before = player.currentTrack?.title;
      player.nextTrack();
      const after = usePlayerStore.getState().currentTrack?.title;
      return ok('nextTrack', after && after !== before ? `Skipped to: ${after}` : 'Advanced to next track');
    } catch (err) {
      return fail('nextTrack', `Failed: ${String(err)}`);
    }
  },
};

const prevTrackTool: ToolDefinition = {
  name: 'prevTrack',
  description: 'Go to the previous track. Use for "back", "previous", "last one".',
  parameters: [],
  execute: async () => {
    try {
      const player = usePlayerStore.getState();
      player.prevTrack();
      const after = usePlayerStore.getState().currentTrack?.title;
      return ok('prevTrack', after ? `Back to: ${after}` : 'Went back');
    } catch (err) {
      return fail('prevTrack', `Failed: ${String(err)}`);
    }
  },
};

const seekToTool: ToolDefinition = {
  name: 'seekTo',
  description: 'Jump to a specific time in the current track. Use for "skip to 2 minutes", "jump ahead 30 seconds", "restart".',
  parameters: [
    { name: 'seconds', type: 'number', description: 'Target time in seconds (absolute position)', required: true },
  ],
  execute: async (params) => {
    try {
      const seconds = Number(params.seconds);
      if (!Number.isFinite(seconds) || seconds < 0) {
        return fail('seekTo', `Invalid seconds: ${params.seconds}`);
      }
      const player = usePlayerStore.getState();
      player.seekTo(seconds);
      return ok('seekTo', `Jumped to ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`);
    } catch (err) {
      return fail('seekTo', `Failed: ${String(err)}`);
    }
  },
};

const setVolumeTool: ToolDefinition = {
  name: 'setVolume',
  description: 'Set playback volume (0-100). Use for "louder", "quieter", "mute", "full volume".',
  parameters: [
    { name: 'level', type: 'number', description: 'Volume 0-100. Use 0 for mute.', required: true },
  ],
  execute: async (params) => {
    try {
      const level = Math.max(0, Math.min(100, Math.round(Number(params.level))));
      if (!Number.isFinite(level)) return fail('setVolume', `Invalid level: ${params.level}`);
      const player = usePlayerStore.getState();
      player.setVolume(level);
      return ok('setVolume', level === 0 ? 'Muted' : `Volume: ${level}`);
    } catch (err) {
      return fail('setVolume', `Failed: ${String(err)}`);
    }
  },
};

const repeatTool: ToolDefinition = {
  name: 'cycleRepeat',
  description: 'Cycle repeat mode: off → all → one → off. Use for "repeat", "loop this", "stop repeating".',
  parameters: [],
  execute: async () => {
    try {
      const player = usePlayerStore.getState();
      player.cycleRepeat();
      const mode = usePlayerStore.getState().repeatMode;
      return ok('cycleRepeat', `Repeat: ${mode}`);
    } catch (err) {
      return fail('cycleRepeat', `Failed: ${String(err)}`);
    }
  },
};

// ---------------------------------------------------------------------------
// searchByGenre — genre-specific track discovery using primary_genre (tags[0])
// ---------------------------------------------------------------------------

function normalizeGenre(g: string): string {
  return g.toLowerCase().replace(/[\s\-&]+/g, '');
}

const searchByGenreTool: ToolDefinition = {
  name: 'searchByGenre',
  description:
    'Find tracks in the pool by genre (afrobeats, amapiano, r&b, hip-hop, etc). Uses primary_genre tag — more precise than searchByVibe for genre requests.',
  parameters: [
    { name: 'genre', type: 'string', description: 'Genre name (e.g. "afrobeats", "r&b", "amapiano")', required: true },
    { name: 'limit', type: 'number', description: 'Max results (default 6)', required: false },
  ],
  execute: async (params) => {
    const { genre, limit } = params;
    if (!genre) return fail('searchByGenre', 'Missing genre');

    try {
      const pool = useTrackPoolStore.getState();
      const normTarget = normalizeGenre(genre);
      const maxResults = Math.min(12, Math.max(1, Number(limit) || 6));

      const scored = pool.hotPool
        .map((t) => {
          const primary = t.tags?.[0];
          if (!primary) return null;
          const normPrimary = normalizeGenre(primary);
          // Exact normalized match = high score; partial containment = lower
          if (normPrimary === normTarget) return { track: t, score: 100 };
          if (normPrimary.includes(normTarget) || normTarget.includes(normPrimary)) return { track: t, score: 60 };
          // Secondary tags
          const anyTag = (t.tags || []).some((tag) => normalizeGenre(tag) === normTarget);
          if (anyTag) return { track: t, score: 40 };
          return null;
        })
        .filter((s): s is { track: typeof pool.hotPool[0]; score: number } => s !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);

      if (scored.length === 0) {
        return ok('searchByGenre', `No tracks found for genre "${genre}". Try searchByVibe instead.`);
      }

      const formatted = scored
        .map((s) => `${s.track.trackId}: ${s.track.title} — ${s.track.artist} [${s.track.tags?.[0] ?? ''}]`)
        .join('\n');
      return ok('searchByGenre', `${genre} tracks:\n${formatted}`, {
        trackIds: scored.map((s) => s.track.trackId),
      });
    } catch (err) {
      return fail('searchByGenre', `Failed: ${String(err)}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Export all tools
// ---------------------------------------------------------------------------

export const MUSIC_TOOLS: ToolDefinition[] = [
  playTrackTool,
  addToQueueTool,
  shuffleQueueTool,
  searchByVibeTool,
  searchByGenreTool,
  recallMemoryTool,
  saveMemoryTool,
  getCurrentContextTool,
  // Playback control (OS layer)
  togglePlayTool,
  nextTrackTool,
  prevTrackTool,
  seekToTool,
  setVolumeTool,
  repeatTool,
];

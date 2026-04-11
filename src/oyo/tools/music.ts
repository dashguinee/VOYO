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
      const player = usePlayerStore.getState();
      const pos = position ? parseInt(position, 10) : undefined;
      player.addToQueue(track, Number.isFinite(pos) ? pos : undefined);
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

      // Score tracks by tag/mood/title/artist overlap
      const candidates = pool.hotPool
        .map((t) => {
          let score = 0;
          const text = `${t.title} ${t.artist} ${(t.tags || []).join(' ')} ${t.mood || ''}`.toLowerCase();
          for (const word of lowered.split(/\s+/).filter((w) => w.length > 2)) {
            if (text.includes(word)) score += 10;
          }
          if (t.mood && lowered.includes(t.mood)) score += 25;
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
      return ok('saveMemory', `Saved: ${saved.fact}`);
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
        parts.push(`Now playing: ${current.title} — ${current.artist}`);
      } else {
        parts.push('Now playing: nothing');
      }
      if (recent.length > 0) {
        parts.push(
          `Recent:\n${recent.map((h) => `  - ${h.track.title} — ${h.track.artist}`).join('\n')}`,
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
// Export all tools
// ---------------------------------------------------------------------------

export const MUSIC_TOOLS: ToolDefinition[] = [
  playTrackTool,
  addToQueueTool,
  shuffleQueueTool,
  searchByVibeTool,
  recallMemoryTool,
  saveMemoryTool,
  getCurrentContextTool,
];

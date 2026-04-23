/**
 * Lyrics Engine
 *
 * Single-source pipeline: LRCLIB (free, crowd-verified, 3M+ songs, no API key).
 * If LRCLIB misses, the caller (VoyoPortraitPlayer) falls back to lyricsAgent (Gemini).
 *
 * Exports: fetchLyricsSimple, getCurrentSegment
 * Types:   EnrichedLyrics, TranslatedSegment, LyricsGenerationProgress
 */

import {
  getLyricsWithCache as getLRCLibLyrics,
  parseLRC,
  getCurrentLine,
  getLyricWindow,
  type LRCLibResult,
  type ParsedLyricLine,
} from './lrclib';

import {
  type PhoneticLyrics,
  type LyricSegment,
} from './whisperService';

import { type TranslationMatch } from './lexiconService';

import { lyricsAPI, isSupabaseConfigured, type LyricSegmentRow } from '../lib/supabase';
import { type Track } from '../types';
import { devLog, devWarn } from '../utils/logger';

// Re-export LRCLIB helpers used by the lyrics display UI
export type { LRCLibResult, ParsedLyricLine };
export { getCurrentLine, getLyricWindow, parseLRC };

// ============================================================================
// TYPES
// ============================================================================

export interface EnrichedLyrics {
  trackId: string;
  trackTitle: string;
  artist: string;
  phonetic: PhoneticLyrics;
  translated: TranslatedSegment[];
  language: string;
  confidence: number;
  generatedAt: Date;
  lastPolished?: Date;
  polishedBy: string[];
  approvedBy: string[];
  reportedIssues: LyricIssue[];
  translationCoverage: number;
  communityScore: number;
}

export interface TranslatedSegment {
  startTime: number;
  endTime: number;
  original: string;
  phonetic: string;
  translations: TranslationMatch[];
  english?: string;
  french?: string;
  culturalNote?: string;
  isVerified: boolean;
}

export interface LyricIssue {
  segmentIndex: number;
  type: 'wrong_word' | 'wrong_translation' | 'missing_word' | 'timing' | 'other';
  description: string;
  reportedBy: string;
  reportedAt: Date;
}

export interface LyricsGenerationProgress {
  stage: 'fetching' | 'transcribing' | 'translating' | 'enriching' | 'complete' | 'error';
  progress: number;
  message: string;
}

// ============================================================================
// PIPELINE
// ============================================================================

type ProgressCallback = (progress: LyricsGenerationProgress) => void;

/**
 * Fetch synced lyrics via LRCLIB. Returns enriched lyrics on hit; !found on miss.
 * Caches successful results to Supabase for offline access.
 */
export async function fetchLyricsSimple(
  track: Track,
  onProgress?: ProgressCallback
): Promise<LRCLibResult & { enriched?: EnrichedLyrics }> {
  const update = (stage: LyricsGenerationProgress['stage'], progress: number, message: string) => {
    onProgress?.({ stage, progress, message });
    devLog(`[LyricsEngine] ${stage}: ${message} (${progress}%)`);
  };

  update('fetching', 10, 'Checking LRCLIB...');

  const lrcResult = await getLRCLibLyrics(track.title, track.artist, track.duration);

  if (lrcResult.found && lrcResult.lines) {
    update('complete', 100, `Found! ${lrcResult.lines.length} synced lines`);

    const enriched = lrcResultToEnriched(lrcResult, track);

    if (isSupabaseConfigured) {
      const segments: LyricSegmentRow[] = enriched.translated.map(seg => ({
        start: seg.startTime,
        end: seg.endTime,
        text: seg.original,
        phonetic: seg.phonetic,
      }));

      lyricsAPI.save({
        track_id: track.id,
        title: track.title,
        artist: track.artist,
        phonetic_raw: lrcResult.plain || '',
        phonetic_clean: lrcResult.plain || '',
        language: 'en',
        confidence: 1.0,
        segments,
        translations: {},
        status: 'verified',
        polished_by: ['lrclib'],
        verified_by: 'lrclib',
      }).then(saved => {
        if (saved) devLog(`[LyricsEngine] Cached LRCLIB lyrics: ${track.title}`);
      }).catch((err) => {
        devWarn(`[LyricsEngine] Failed to cache LRCLIB lyrics: ${err?.message ?? err}`);
      });
    }

    return { ...lrcResult, enriched };
  }

  update('error', 0, 'Lyrics not found in LRCLIB');
  return lrcResult;
}

function lrcResultToEnriched(lrc: LRCLibResult, track: Track): EnrichedLyrics {
  const lines = lrc.lines || [];

  const translated: TranslatedSegment[] = lines.map((line, i) => {
    const nextLine = lines[i + 1];
    return {
      startTime: line.time,
      endTime: nextLine ? nextLine.time : line.time + 5,
      original: line.text,
      phonetic: line.text,
      translations: [],
      isVerified: true,
    };
  });

  const phonetic: PhoneticLyrics = {
    trackId: track.id,
    originalText: lrc.plain || lines.map(l => l.text).join('\n'),
    cleanedText: lrc.plain || lines.map(l => l.text).join('\n'),
    segments: lines.map((line, i) => {
      const nextLine = lines[i + 1];
      return {
        startTime: line.time,
        endTime: nextLine ? nextLine.time : line.time + 5,
        text: line.text,
        phonetic: line.text,
      };
    }),
    language: 'en',
    confidence: 1.0,
    generatedAt: new Date(),
    polishedBy: ['lrclib-community'],
  };

  return {
    trackId: track.id,
    trackTitle: track.title,
    artist: track.artist,
    phonetic,
    translated,
    language: 'en',
    confidence: 1.0,
    generatedAt: new Date(),
    polishedBy: ['lrclib-community'],
    approvedBy: [],
    reportedIssues: [],
    translationCoverage: 0,
    communityScore: 100,
  };
}

// ============================================================================
// DISPLAY
// ============================================================================

export function getCurrentSegment(
  lyrics: EnrichedLyrics,
  currentTime: number
): TranslatedSegment | null {
  return lyrics.translated.find(
    seg => currentTime >= seg.startTime && currentTime < seg.endTime
  ) || null;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

devLog('[LyricsEngine] Service loaded');

export type { PhoneticLyrics, LyricSegment } from './whisperService';
export type { TranslationMatch } from './lexiconService';

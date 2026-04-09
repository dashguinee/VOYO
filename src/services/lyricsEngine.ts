/**
 * VOYO Music - Lyrics Engine v2.0
 *
 * SMART LYRICS PIPELINE:
 *
 * 1. CHECK LRCLIB (free, 3M songs, synced lyrics) - NO API KEY NEEDED!
 * 2. CHECK LOCAL CACHE (localStorage/Supabase)
 * 3. FALLBACK TO WHISPER (only for truly obscure tracks)
 *
 * This is THE killer feature for African music discovery.
 * Users can finally understand what they're listening to.
 */

import {
  getLyricsWithCache as getLRCLibLyrics,
  parseLRC,
  getCurrentLine,
  getLyricWindow,
  type LRCLibResult,
  type ParsedLyricLine,
} from './lrclib';

import { getGeniusLyrics, type GeniusResult } from './geniusScraper';
import { fetchByYoutubeId as fetchSyncedLyrics, type SyncedLyricsResult } from './syncedLyricsService';

import {
  type PhoneticLyrics,
  type LyricSegment,
  transcribeAudio,
  saveLyrics as saveLocalLyrics,
  getLyrics as getLocalLyrics,
  polishLyrics as polishLocalLyrics,
  isConfigured as isWhisperConfigured,
  setOpenAIKey,
} from './whisperService';

import {
  translateLine,
  translateWord,
  addWord,
  getLexiconStats,
  type LyricTranslation,
  type TranslationMatch,
} from './lexiconService';

import { lyricsAPI, isSupabaseConfigured, type LyricsRow, type LyricSegmentRow } from '../lib/supabase';
import { type Track } from '../types';

// Re-export LRCLIB types for convenience
export type { LRCLibResult, ParsedLyricLine };
export { getCurrentLine, getLyricWindow, parseLRC };

// ============================================================================
// TYPES
// ============================================================================

export interface EnrichedLyrics {
  trackId: string;
  trackTitle: string;
  artist: string;

  // Raw transcription
  phonetic: PhoneticLyrics;

  // With translations
  translated: TranslatedSegment[];

  // Metadata
  language: string;
  confidence: number;
  generatedAt: Date;
  lastPolished?: Date;

  // Community
  polishedBy: string[];
  approvedBy: string[];
  reportedIssues: LyricIssue[];

  // Stats
  translationCoverage: number;  // % of words translated
  communityScore: number;       // Quality score from votes
}

export interface TranslatedSegment {
  startTime: number;
  endTime: number;
  original: string;
  phonetic: string;
  translations: TranslationMatch[];
  english?: string;             // Combined English translation
  french?: string;              // Combined French translation
  culturalNote?: string;        // Optional cultural context
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
  progress: number;  // 0-100
  message: string;
}

// ============================================================================
// MAIN PIPELINE
// ============================================================================

// Progress callback for UI updates
type ProgressCallback = (progress: LyricsGenerationProgress) => void;

/**
 * FAST LYRICS - Try LRCLIB first (free, instant, synced)
 * This is the NEW primary method - no API key needed!
 */
export async function fetchLyricsSimple(
  track: Track,
  onProgress?: ProgressCallback
): Promise<LRCLibResult & { enriched?: EnrichedLyrics }> {
  const updateProgress = (stage: LyricsGenerationProgress['stage'], progress: number, message: string) => {
    if (onProgress) {
      onProgress({ stage, progress, message });
    }
    console.log(`[LyricsEngine] ${stage}: ${message} (${progress}%)`);
  };

  updateProgress('fetching', 10, 'Checking LRCLIB...');

  // Try LRCLIB first - FREE, INSTANT, NO API KEY!
  const lrcResult = await getLRCLibLyrics(
    track.title,
    track.artist,
    track.duration
  );

  if (lrcResult.found && lrcResult.lines) {
    updateProgress('complete', 100, `Found! ${lrcResult.lines.length} synced lines`);

    // Convert to EnrichedLyrics format for compatibility
    const enriched = lrcResultToEnriched(lrcResult, track);

    return {
      ...lrcResult,
      enriched,
    };
  }

  updateProgress('error', 0, 'Lyrics not found in LRCLIB');
  return lrcResult;
}

/**
 * Convert SyncedLyrics backend result to EnrichedLyrics format
 */
function syncedResultToEnriched(synced: SyncedLyricsResult, track: Track): EnrichedLyrics {
  const translated: TranslatedSegment[] = synced.lines.map((line, i) => {
    const nextLine = synced.lines[i + 1];
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
    originalText: synced.plain || synced.lines.map(l => l.text).join('\n'),
    cleanedText: synced.plain || synced.lines.map(l => l.text).join('\n'),
    segments: synced.lines.map((line, i) => {
      const nextLine = synced.lines[i + 1];
      return {
        startTime: line.time,
        endTime: nextLine ? nextLine.time : line.time + 5,
        text: line.text,
        phonetic: line.text,
      };
    }),
    language: 'en',
    confidence: 0.95,
    generatedAt: new Date(),
    polishedBy: ['syncedlyrics-community'],
  };

  return {
    trackId: track.id,
    trackTitle: track.title,
    artist: track.artist,
    phonetic,
    translated,
    language: 'en',
    confidence: 0.95,
    generatedAt: new Date(),
    polishedBy: ['syncedlyrics-community'],
    approvedBy: [],
    reportedIssues: [],
    translationCoverage: 0,
    communityScore: 95,
  };
}

/**
 * Convert Genius result to EnrichedLyrics format (plain text, no sync)
 */
function geniusResultToEnriched(genius: GeniusResult, track: Track): EnrichedLyrics {
  const lines = (genius.lyrics || '').split('\n').filter(l => l.trim());

  // Create segments from lines (no timing, estimate 3s per line)
  const translated: TranslatedSegment[] = lines.map((line, i) => ({
    startTime: i * 3,
    endTime: (i + 1) * 3,
    original: line,
    phonetic: line,
    translations: [],
    isVerified: false,
  }));

  const phonetic: PhoneticLyrics = {
    trackId: track.id,
    originalText: genius.lyrics || '',
    cleanedText: genius.lyrics || '',
    segments: lines.map((line, i) => ({
      startTime: i * 3,
      endTime: (i + 1) * 3,
      text: line,
      phonetic: line,
    })),
    language: 'en',
    confidence: 0.9,
    generatedAt: new Date(),
    polishedBy: ['genius'],
  };

  return {
    trackId: track.id,
    trackTitle: track.title,
    artist: track.artist,
    phonetic,
    translated,
    language: 'en',
    confidence: 0.9,
    generatedAt: new Date(),
    polishedBy: ['genius'],
    approvedBy: [],
    reportedIssues: [],
    translationCoverage: 0,
    communityScore: 80,
  };
}

/**
 * Convert LRCLIB result to EnrichedLyrics format
 */
function lrcResultToEnriched(lrc: LRCLibResult, track: Track): EnrichedLyrics {
  const lines = lrc.lines || [];

  // Build translated segments from LRC lines
  const translated: TranslatedSegment[] = lines.map((line, i) => {
    const nextLine = lines[i + 1];
    const endTime = nextLine ? nextLine.time : line.time + 5;

    return {
      startTime: line.time,
      endTime,
      original: line.text,
      phonetic: line.text,
      translations: [],  // No translations yet
      isVerified: true,  // LRCLIB is crowd-verified
    };
  });

  // Build phonetic structure
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
    language: 'en',  // LRCLIB doesn't provide language
    confidence: 1.0,  // High confidence - crowd-sourced
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
    translationCoverage: 0,  // No translations
    communityScore: 100,  // High score - crowd-sourced
  };
}

/**
 * Generate full enriched lyrics for a track
 * UPDATED: Now tries LRCLIB first before falling back to Whisper
 *
 * This is the main entry point - give it a track, get back translated lyrics
 */
export async function generateLyrics(
  track: Track,
  audioUrl: string,
  onProgress?: ProgressCallback
): Promise<EnrichedLyrics> {
  const updateProgress = (stage: LyricsGenerationProgress['stage'], progress: number, message: string) => {
    if (onProgress) {
      onProgress({ stage, progress, message });
    }
    console.log(`[LyricsEngine] ${stage}: ${message} (${progress}%)`);
  };

  try {
    // =====================================
    // PRIORITY 0: SYNCED LYRICS BACKEND (Best African coverage)
    // =====================================
    updateProgress('fetching', 5, 'Checking syncedlyrics (community sources)...');
    const syncedResult = await fetchSyncedLyrics(track.id, track.title, track.artist);

    if (syncedResult.found && syncedResult.lines.length > 0) {
      updateProgress('complete', 100, `Found via syncedlyrics! ${syncedResult.lines.length} synced lines`);
      return syncedResultToEnriched(syncedResult, track);
    }

    // =====================================
    // PRIORITY 1: LRCLIB (FREE, INSTANT!)
    // =====================================
    updateProgress('fetching', 10, 'Checking LRCLIB (free lyrics database)...');
    const lrcResult = await getLRCLibLyrics(track.title, track.artist, track.duration);

    if (lrcResult.found && lrcResult.lines) {
      updateProgress('complete', 100, `Found in LRCLIB! ${lrcResult.lines.length} synced lines`);

      const enriched = lrcResultToEnriched(lrcResult, track);

      // Cache LRCLIB result to Supabase for future lookups
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
          status: 'verified',  // LRCLIB is community-verified
          polished_by: ['lrclib'],
          verified_by: 'lrclib',
        }).then(saved => {
          if (saved) console.log(`[LyricsEngine] ✅ Cached LRCLIB lyrics to Supabase: ${track.title}`);
        }).catch(() => {});  // Don't block on cache save
      }

      return enriched;
    }

    // =====================================
    // PRIORITY 2: GENIUS SCRAPER (Grey Zone - Best African coverage)
    // =====================================
    updateProgress('fetching', 20, 'Checking Genius (African music)...');
    const geniusResult = await getGeniusLyrics(track.title, track.artist);

    if (geniusResult.found && geniusResult.lyrics) {
      updateProgress('complete', 100, `Found on Genius! ${geniusResult.lyrics.length} chars`);

      const enriched = geniusResultToEnriched(geniusResult, track);

      // Cache to Supabase
      if (isSupabaseConfigured) {
        lyricsAPI.save({
          track_id: track.id,
          title: track.title,
          artist: track.artist,
          phonetic_raw: geniusResult.lyrics,
          phonetic_clean: geniusResult.lyrics,
          language: 'en',
          confidence: 0.9,
          segments: enriched.translated.map(seg => ({
            start: seg.startTime,
            end: seg.endTime,
            text: seg.original,
            phonetic: seg.phonetic,
          })),
          translations: {},
          status: 'raw',
          polished_by: ['genius'],
          verified_by: null,
        }).catch(() => {});
      }

      return enriched;
    }

    // =====================================
    // PRIORITY 3: LOCAL CACHE
    // =====================================
    // Check Supabase first (persistent cache), then localStorage (offline fallback)
    if (isSupabaseConfigured) {
      const supabaseExisting = await lyricsAPI.get(track.id);
      if (supabaseExisting) {
        updateProgress('complete', 100, 'Loaded from Supabase');
        // Record play for analytics
        lyricsAPI.recordPlay(track.id);
        return supabaseRowToEnriched(supabaseExisting, track);
      }
    }

    // Fallback to localStorage
    const localExisting = getLocalLyrics(track.id);
    if (localExisting) {
      updateProgress('complete', 100, 'Loaded from local cache');
      return enrichLyrics(localExisting, track);
    }

    // =====================================
    // PRIORITY 3: WHISPER (LAST RESORT)
    // =====================================
    // Check Whisper configuration
    if (!isWhisperConfigured()) {
      throw new Error('Lyrics not found. Track not in LRCLIB database.');
    }

    // Stage 1: Fetch audio
    updateProgress('fetching', 10, 'Fetching audio for Whisper transcription...');
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to fetch audio: ${audioResponse.statusText}`);
    }
    const audioBlob = await audioResponse.blob();
    updateProgress('fetching', 20, `Audio fetched (${(audioBlob.size / 1024 / 1024).toFixed(1)}MB)`);

    // Stage 2: Transcribe with Whisper
    updateProgress('transcribing', 30, 'Transcribing with Whisper...');
    const transcription = await transcribeAudio(audioBlob, {
      prompt: `Song lyrics for "${track.title}" by ${track.artist}. African music, Afrobeats, Soussou, Mandinka, Wolof, Yoruba. Phonetic transcription.`,
      timestamps: true,
    });
    updateProgress('transcribing', 60, `Transcribed ${transcription.segments?.length || 0} segments`);

    // Stage 3: Build phonetic lyrics structure
    updateProgress('translating', 70, 'Matching against lexicon...');
    const phoneticLyrics: PhoneticLyrics = {
      trackId: track.id,
      originalText: transcription.text,
      cleanedText: cleanLyrics(transcription.text),
      segments: (transcription.segments || []).map(seg => ({
        startTime: seg.start,
        endTime: seg.end,
        text: seg.text,
        phonetic: seg.text,  // Will be enhanced
      })),
      language: transcription.language,
      confidence: transcription.segments?.[0]?.confidence || 0.5,
      generatedAt: new Date(),
    };

    // Save to localStorage (immediate)
    saveLocalLyrics(phoneticLyrics);

    // Save to Supabase (persistent, async)
    if (isSupabaseConfigured) {
      const segments: LyricSegmentRow[] = phoneticLyrics.segments.map(seg => ({
        start: seg.startTime,
        end: seg.endTime,
        text: seg.text,
        phonetic: seg.phonetic || seg.text,
      }));

      await lyricsAPI.save({
        track_id: track.id,
        title: track.title,
        artist: track.artist,
        phonetic_raw: phoneticLyrics.originalText,
        phonetic_clean: phoneticLyrics.cleanedText,
        language: phoneticLyrics.language,
        confidence: phoneticLyrics.confidence,
        segments,
        translations: {},
        status: 'raw',
        polished_by: [],
        verified_by: null,
      });
      updateProgress('translating', 80, 'Saved to Supabase');
    } else {
      updateProgress('translating', 80, 'Saved locally (Supabase not configured)');
    }

    // Stage 4: Enrich with translations
    updateProgress('enriching', 90, 'Adding translations...');
    const enriched = enrichLyrics(phoneticLyrics, track);

    updateProgress('complete', 100, 'Lyrics generation complete!');
    return enriched;

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    updateProgress('error', 0, message);
    throw error;
  }
}

/**
 * Enrich phonetic lyrics with translations
 */
function enrichLyrics(phonetic: PhoneticLyrics, track: Track): EnrichedLyrics {
  const translated: TranslatedSegment[] = phonetic.segments.map(segment => {
    // Get translations for this line
    const lineTranslation = translateLine(segment.text);

    // Build combined translations
    const englishParts = lineTranslation.translations
      .filter(t => t.english)
      .map(t => t.english);

    const frenchParts = lineTranslation.translations
      .filter(t => t.french)
      .map(t => t.french);

    return {
      startTime: segment.startTime,
      endTime: segment.endTime,
      original: segment.text,
      phonetic: segment.phonetic || segment.text,
      translations: lineTranslation.translations,
      english: englishParts.length > 0 ? englishParts.join(' ') : undefined,
      french: frenchParts.length > 0 ? frenchParts.join(' ') : undefined,
      isVerified: false,
    };
  });

  // Calculate translation coverage
  const totalWords = phonetic.segments.reduce(
    (sum, seg) => sum + seg.text.split(/\s+/).length,
    0
  );
  const translatedWords = translated.reduce(
    (sum, seg) => sum + seg.translations.length,
    0
  );
  const coverage = totalWords > 0 ? (translatedWords / totalWords) * 100 : 0;

  return {
    trackId: track.id,
    trackTitle: track.title,
    artist: track.artist,
    phonetic,
    translated,
    language: phonetic.language,
    confidence: phonetic.confidence,
    generatedAt: phonetic.generatedAt,
    polishedBy: phonetic.polishedBy || [],
    approvedBy: [],
    reportedIssues: [],
    translationCoverage: coverage,
    communityScore: 0,
  };
}

/**
 * Convert Supabase row to EnrichedLyrics format
 */
function supabaseRowToEnriched(row: LyricsRow, track: Track): EnrichedLyrics {
  // Convert segments from Supabase format
  const translated: TranslatedSegment[] = (row.segments || []).map((seg: LyricSegmentRow) => {
    // Get fresh translations from lexicon
    const lineTranslation = translateLine(seg.text);

    return {
      startTime: seg.start,
      endTime: seg.end,
      original: seg.text,
      phonetic: seg.phonetic || seg.text,
      translations: lineTranslation.translations,
      english: seg.english || (lineTranslation.translations.filter(t => t.english).map(t => t.english).join(' ') || undefined),
      french: seg.french || (lineTranslation.translations.filter(t => t.french).map(t => t.french).join(' ') || undefined),
      culturalNote: seg.cultural_note,
      isVerified: row.status === 'verified',
    };
  });

  // Calculate coverage
  const totalWords = row.segments.reduce(
    (sum: number, seg: LyricSegmentRow) => sum + seg.text.split(/\s+/).length,
    0
  );
  const translatedWords = translated.reduce(
    (sum, seg) => sum + seg.translations.length,
    0
  );
  const coverage = totalWords > 0 ? (translatedWords / totalWords) * 100 : 0;

  // Build phonetic structure for compatibility
  const phonetic: PhoneticLyrics = {
    trackId: row.track_id,
    originalText: row.phonetic_raw,
    cleanedText: row.phonetic_clean || row.phonetic_raw,
    segments: row.segments.map((seg: LyricSegmentRow) => ({
      startTime: seg.start,
      endTime: seg.end,
      text: seg.text,
      phonetic: seg.phonetic,
    })),
    language: row.language,
    confidence: row.confidence,
    generatedAt: new Date(row.created_at),
    polishedBy: row.polished_by,
  };

  return {
    trackId: row.track_id,
    trackTitle: row.title || track.title,
    artist: row.artist || track.artist,
    phonetic,
    translated,
    language: row.language,
    confidence: row.confidence,
    generatedAt: new Date(row.created_at),
    lastPolished: row.updated_at !== row.created_at ? new Date(row.updated_at) : undefined,
    polishedBy: row.polished_by || [],
    approvedBy: row.verified_by ? [row.verified_by] : [],
    reportedIssues: [],
    translationCoverage: coverage,
    communityScore: row.play_count || 0,
  };
}

/**
 * Clean up lyrics text
 */
function cleanLyrics(text: string): string {
  return text
    .replace(/\[.*?\]/g, '')     // Remove [music], [applause] etc
    .replace(/\(.*?\)/g, '')     // Remove (inaudible) etc
    .replace(/♪+/g, '')          // Remove music notes
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// LYRICS DISPLAY (for UI)
// ============================================================================

/**
 * Get the current lyric segment for a given playback time
 */
export function getCurrentSegment(
  lyrics: EnrichedLyrics,
  currentTime: number
): TranslatedSegment | null {
  return lyrics.translated.find(
    seg => currentTime >= seg.startTime && currentTime < seg.endTime
  ) || null;
}

/**
 * Get upcoming segments for karaoke-style display
 */
export function getUpcomingSegments(
  lyrics: EnrichedLyrics,
  currentTime: number,
  count: number = 3
): TranslatedSegment[] {
  const currentIndex = lyrics.translated.findIndex(
    seg => currentTime >= seg.startTime && currentTime < seg.endTime
  );

  if (currentIndex === -1) {
    // Not in any segment, find next one
    const nextIndex = lyrics.translated.findIndex(seg => seg.startTime > currentTime);
    return nextIndex !== -1
      ? lyrics.translated.slice(nextIndex, nextIndex + count)
      : [];
  }

  return lyrics.translated.slice(currentIndex, currentIndex + count);
}

/**
 * Format segment for display with word-by-word translations
 */
export function formatSegmentDisplay(segment: TranslatedSegment): {
  original: string;
  transliteration: string;
  english: string;
  french: string;
  wordBreakdown: Array<{
    word: string;
    translation?: string;
    isTranslated: boolean;
  }>;
} {
  const words = segment.original.split(/\s+/);
  const breakdown = words.map(word => {
    const match = segment.translations.find(
      t => t.original.toLowerCase() === word.toLowerCase()
    );
    return {
      word,
      translation: match?.english || match?.french,
      isTranslated: !!match,
    };
  });

  return {
    original: segment.original,
    transliteration: segment.phonetic,
    english: segment.english || '',
    french: segment.french || '',
    wordBreakdown: breakdown,
  };
}

// ============================================================================
// COMMUNITY CONTRIBUTIONS
// ============================================================================

/**
 * Submit a correction to a lyric segment
 */
export function submitCorrection(
  trackId: string,
  segmentIndex: number,
  correction: {
    text?: string;
    phonetic?: string;
    translation?: string;
    culturalNote?: string;
  },
  userId: string
): boolean {
  // Apply to phonetic lyrics
  const success = polishLocalLyrics(
    trackId,
    segmentIndex,
    {
      text: correction.text,
      phonetic: correction.phonetic,
      translation: correction.translation,
    },
    userId
  );

  if (success) {
    console.log(`[LyricsEngine] Correction submitted by ${userId} for segment ${segmentIndex}`);
  }

  return success;
}

/**
 * Add a new word to the community lexicon
 */
export function contributeWord(
  word: string,
  englishTranslation: string,
  frenchTranslation: string,
  category: string,
  userId: string
): string {
  const id = addWord({
    base: word.toLowerCase(),
    variants: [word.toLowerCase()],
    english: englishTranslation,
    french: frenchTranslation,
    category,
    frequency: 1,
    sources: [`community:${userId}`],
  });

  console.log(`[LyricsEngine] Word "${word}" contributed by ${userId}`);
  return id;
}

/**
 * Report an issue with lyrics
 */
export function reportIssue(
  trackId: string,
  segmentIndex: number,
  type: LyricIssue['type'],
  description: string,
  userId: string
): void {
  // Store in localStorage for now
  const issuesKey = `voyo_lyrics_issues_${trackId}`;
  const existingData = localStorage.getItem(issuesKey);
  const issues: LyricIssue[] = existingData ? JSON.parse(existingData) : [];

  issues.push({
    segmentIndex,
    type,
    description,
    reportedBy: userId,
    reportedAt: new Date(),
  });

  localStorage.setItem(issuesKey, JSON.stringify(issues));
  console.log(`[LyricsEngine] Issue reported for ${trackId} segment ${segmentIndex}`);
}

// ============================================================================
// EXPORT & SHARE
// ============================================================================

/**
 * Export lyrics as plain text
 */
export function exportAsText(lyrics: EnrichedLyrics): string {
  const lines: string[] = [
    `${lyrics.trackTitle} - ${lyrics.artist}`,
    `Language: ${lyrics.language}`,
    '',
    '--- LYRICS ---',
    '',
  ];

  for (const segment of lyrics.translated) {
    lines.push(segment.original);
    if (segment.english) {
      lines.push(`  → ${segment.english}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`Generated by VOYO Music`);
  lines.push(`Translation coverage: ${lyrics.translationCoverage.toFixed(0)}%`);

  return lines.join('\n');
}

/**
 * Export lyrics as SRT subtitle format
 */
export function exportAsSRT(lyrics: EnrichedLyrics): string {
  const lines: string[] = [];

  lyrics.translated.forEach((segment, index) => {
    lines.push(`${index + 1}`);
    lines.push(`${formatSRTTime(segment.startTime)} --> ${formatSRTTime(segment.endTime)}`);
    lines.push(segment.original);
    if (segment.english) {
      lines.push(`[${segment.english}]`);
    }
    lines.push('');
  });

  return lines.join('\n');
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function pad(n: number, width: number = 2): string {
  return n.toString().padStart(width, '0');
}

/**
 * Export lyrics as JSON for sharing
 */
export function exportAsJSON(lyrics: EnrichedLyrics): string {
  return JSON.stringify({
    trackId: lyrics.trackId,
    trackTitle: lyrics.trackTitle,
    artist: lyrics.artist,
    language: lyrics.language,
    segments: lyrics.translated.map(seg => ({
      start: seg.startTime,
      end: seg.endTime,
      text: seg.original,
      english: seg.english,
      french: seg.french,
    })),
    metadata: {
      generatedAt: lyrics.generatedAt,
      coverage: lyrics.translationCoverage,
      confidence: lyrics.confidence,
    },
  }, null, 2);
}

// ============================================================================
// CONFIGURATION & STATS
// ============================================================================

/**
 * Configure the lyrics engine
 */
export function configure(config: {
  openaiApiKey?: string;
}): void {
  if (config.openaiApiKey) {
    setOpenAIKey(config.openaiApiKey);
  }
}

/**
 * Get lyrics engine statistics
 */
export function getLyricsStats(): {
  whisperConfigured: boolean;
  lexiconStats: ReturnType<typeof getLexiconStats>;
  cachedLyrics: number;
  totalSegments: number;
} {
  // Count cached lyrics
  let cachedCount = 0;
  let totalSegments = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('voyo_phonetic_lyrics')) {
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        cachedCount += Object.keys(data).length;
        for (const lyrics of Object.values(data) as PhoneticLyrics[]) {
          totalSegments += lyrics.segments?.length || 0;
        }
      } catch {
        // Ignore parsing errors
      }
    }
  }

  return {
    whisperConfigured: isWhisperConfigured(),
    lexiconStats: getLexiconStats(),
    cachedLyrics: cachedCount,
    totalSegments,
  };
}

// ============================================================================
// INITIALIZATION
// ============================================================================

console.log('[LyricsEngine] Service loaded');

// Export types
export type {
  PhoneticLyrics,
  LyricSegment,
} from './whisperService';

export type {
  LyricTranslation,
  TranslationMatch,
} from './lexiconService';

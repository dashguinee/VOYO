/**
 * VOYO Lyrics Agent — intelligent lyrics finder + timestamp matcher.
 *
 * Pipeline:
 *   1. Check Supabase voyo_lyrics table (instant cache)
 *   2. Miss → Ask Gemini for lyrics + timestamps + cultural context
 *   3. Save to Supabase (cached forever, community refines over time)
 *
 * Why Gemini and not lyrics APIs:
 *   - LRCLIB/Musixmatch/Genius have near-zero coverage for African music
 *   - YouTube auto-captions can't handle Soussou, Yoruba, Wolof, pidgin
 *   - Gemini has the lyrics in its training data for popular tracks
 *   - For unknown tracks, Gemini can search + approximate
 *   - One API call vs chaining 3-4 broken APIs
 *
 * Timestamp matching:
 *   - Gemini estimates timestamps based on song structure
 *   - Waveform data from VPS can refine (energy boundaries = line breaks)
 *   - Community corrections improve accuracy over time
 *   - Auto-sync in the UI handles imprecision gracefully
 */

import { callGemini, isGeminiAvailable } from '../oyo/providers/gemini';
import { lyricsAPI } from '../lib/supabase';
import { isSupabaseConfigured } from '../lib/supabase';
import type { EnrichedLyrics, TranslatedSegment } from './lyricsEngine';
import { devLog, devWarn } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

interface LyricsAgentResult {
  lyrics: EnrichedLyrics | null;
  source: 'cache' | 'gemini' | 'none';
  cached: boolean;
  durationMs: number;
}

interface GeminiLyricsResponse {
  lyrics: Array<{
    time: number;     // Start time in seconds
    text: string;     // Original lyrics line
    english?: string; // English translation (if not English)
    french?: string;  // French translation (if not French)
  }>;
  language: string;
  culturalNotes?: string;
  funFact?: string;
  meaning?: string;
}

// ============================================================================
// System prompt for Gemini lyrics generation
// ============================================================================

const LYRICS_SYSTEM_PROMPT = `You are OYO, the VOYO Music AI DJ. Your task is to find and return song lyrics with timestamps.

IMPORTANT: You specialize in African music — Afrobeats, Amapiano, Highlife, Mbalax, Soussou, Mandingue, Coupe-Decale, Afropop, and all African genres. You know lyrics in Yoruba, Pidgin English, Soussou, Wolof, French, Lingala, Swahili, Zulu, Twi, Igbo, and more.

Return a JSON object with this EXACT structure (no markdown, no explanation, ONLY the JSON):

{
  "lyrics": [
    { "time": 0, "text": "First line of lyrics", "english": "Translation if not English" },
    { "time": 5.2, "text": "Second line", "english": "Translation" },
    ...
  ],
  "language": "yoruba",
  "culturalNotes": "Brief cultural context about the song",
  "funFact": "One interesting fact about the track or artist",
  "meaning": "What the song is about in 1-2 sentences"
}

Rules:
- Timestamps should estimate when each line starts (in seconds from track start)
- Include ALL lyrics, not just the first verse
- For non-English tracks, provide English translations
- For non-French tracks with French-speaking audiences, provide French translations too
- If you don't know the exact lyrics, provide your best approximation and note it
- culturalNotes should explain slang, references, or cultural significance
- Return ONLY valid JSON, nothing else`;

// ============================================================================
// Main agent function
// ============================================================================

export async function findLyrics(
  trackId: string,
  title: string,
  artist: string,
  duration?: number,
): Promise<LyricsAgentResult> {
  const start = Date.now();

  // ── STEP 1: Check database cache ──
  if (isSupabaseConfigured) {
    try {
      const cached = await lyricsAPI.get(trackId);
      if (cached && cached.segments && cached.segments.length > 0) {
        devLog(`[LyricsAgent] Cache hit: ${title} (${cached.segments.length} lines)`);
        lyricsAPI.recordPlay(trackId).catch(() => {}); // fire-and-forget

        return {
          lyrics: dbRowToEnrichedLyrics(cached, trackId, title, artist),
          source: 'cache',
          cached: true,
          durationMs: Date.now() - start,
        };
      }
    } catch (e) {
      devWarn('[LyricsAgent] DB check failed:', e);
    }
  }

  // ── STEP 2: Ask Gemini ──
  if (!isGeminiAvailable()) {
    devWarn('[LyricsAgent] Gemini not available');
    return { lyrics: null, source: 'none', cached: false, durationMs: Date.now() - start };
  }

  try {
    const userMessage = `Find the complete lyrics for "${title}" by ${artist}.${
      duration ? ` The track is ${Math.round(duration)} seconds long.` : ''
    } Return timestamps for each line.`;

    const result = await callGemini({
      systemPrompt: LYRICS_SYSTEM_PROMPT,
      userMessage,
    });

    if (!result.text) {
      devWarn(`[LyricsAgent] Gemini returned no text: ${result.error}`);
      return { lyrics: null, source: 'none', cached: false, durationMs: Date.now() - start };
    }

    // Parse Gemini's JSON response
    const parsed = parseGeminiResponse(result.text);
    if (!parsed || !parsed.lyrics || parsed.lyrics.length === 0) {
      devWarn('[LyricsAgent] Failed to parse Gemini response');
      return { lyrics: null, source: 'none', cached: false, durationMs: Date.now() - start };
    }

    devLog(`[LyricsAgent] Gemini found ${parsed.lyrics.length} lines for "${title}"`);

    // Convert to EnrichedLyrics format
    const enriched = geminiToEnrichedLyrics(parsed, trackId, title, artist);

    // ── STEP 3: Save to database ──
    if (isSupabaseConfigured) {
      try {
        await lyricsAPI.save({
          track_id: trackId,
          title,
          artist,
          language: parsed.language || 'unknown',
          phonetic_raw: parsed.lyrics.map(l => l.text).join('\n'),
          phonetic_clean: parsed.lyrics.map(l => l.text).join('\n'),
          segments: parsed.lyrics.map((l, i) => ({
            start: l.time,
            end: parsed.lyrics[i + 1]?.time || l.time + 5,
            text: l.text,
            phonetic: l.text,
            english: l.english || '',
            french: l.french || '',
          })),
          translations: {},
          status: 'raw' as const,
          confidence: 0.8,
          polished_by: [],
          verified_by: null,
        });
        devLog(`[LyricsAgent] Saved to database: ${trackId}`);
      } catch (e) {
        devWarn('[LyricsAgent] DB save failed:', e);
      }
    }

    return {
      lyrics: enriched,
      source: 'gemini',
      cached: false,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    devWarn('[LyricsAgent] Gemini call failed:', e);
    return { lyrics: null, source: 'none', cached: false, durationMs: Date.now() - start };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function parseGeminiResponse(text: string): GeminiLyricsResponse | null {
  try {
    // Gemini sometimes wraps JSON in markdown code blocks
    let clean = text.trim();
    if (clean.startsWith('```json')) clean = clean.slice(7);
    if (clean.startsWith('```')) clean = clean.slice(3);
    if (clean.endsWith('```')) clean = clean.slice(0, -3);
    clean = clean.trim();

    return JSON.parse(clean);
  } catch (e) {
    // Try to extract JSON from mixed text
    const jsonMatch = text.match(/\{[\s\S]*"lyrics"[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch {}
    }
    return null;
  }
}

function geminiToEnrichedLyrics(
  parsed: GeminiLyricsResponse,
  trackId: string,
  title: string,
  artist: string,
): EnrichedLyrics {
  const translated: TranslatedSegment[] = parsed.lyrics.map((line, i) => {
    const next = parsed.lyrics[i + 1];
    return {
      startTime: line.time,
      endTime: next ? next.time : line.time + 5,
      original: line.text,
      phonetic: line.text,
      translations: [],
      english: line.english,
      french: line.french,
      culturalNote: i === 0 ? parsed.culturalNotes : undefined,
      isVerified: false,
    };
  });

  return {
    trackId,
    trackTitle: title,
    artist,
    phonetic: {
      trackId,
      originalText: parsed.lyrics.map(l => l.text).join('\n'),
      cleanedText: parsed.lyrics.map(l => l.text).join('\n'),
      segments: translated.map(t => ({
        startTime: t.startTime,
        endTime: t.endTime,
        text: t.original,
        phonetic: t.phonetic,
      })),
      language: parsed.language || 'unknown',
      confidence: 0.8,
      generatedAt: new Date(),
      polishedBy: ['gemini'],
    },
    translated,
    language: parsed.language || 'unknown',
    confidence: 0.8,
    generatedAt: new Date(),
    polishedBy: ['gemini'],
    approvedBy: [],
    reportedIssues: [],
    translationCoverage: parsed.lyrics.filter(l => l.english).length / parsed.lyrics.length,
    communityScore: 0,
  };
}

function dbRowToEnrichedLyrics(
  row: any,
  trackId: string,
  title: string,
  artist: string,
): EnrichedLyrics {
  const segments = (row.segments || []) as Array<{
    start: number;
    end: number;
    text: string;
    phonetic?: string;
    english?: string;
    french?: string;
  }>;

  const translated: TranslatedSegment[] = segments.map(s => ({
    startTime: s.start,
    endTime: s.end,
    original: s.text,
    phonetic: s.phonetic || s.text,
    translations: [],
    english: s.english,
    french: s.french,
    isVerified: true,
  }));

  return {
    trackId,
    trackTitle: title,
    artist,
    phonetic: {
      trackId,
      originalText: segments.map(s => s.text).join('\n'),
      cleanedText: segments.map(s => s.text).join('\n'),
      segments: segments.map(s => ({
        startTime: s.start,
        endTime: s.end,
        text: s.text,
        phonetic: s.phonetic || s.text,
      })),
      language: row.language || 'unknown',
      confidence: row.confidence || 0.9,
      generatedAt: new Date(row.created_at),
      polishedBy: row.polished_by || [],
    },
    translated,
    language: row.language || 'unknown',
    confidence: row.confidence || 0.9,
    generatedAt: new Date(row.created_at),
    lastPolished: row.updated_at ? new Date(row.updated_at) : undefined,
    polishedBy: row.polished_by || [],
    approvedBy: [],
    reportedIssues: [],
    translationCoverage: segments.filter(s => s.english).length / Math.max(1, segments.length),
    communityScore: row.play_count || 0,
  };
}

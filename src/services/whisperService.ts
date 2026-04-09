/**
 * VOYO Music - Whisper Service
 *
 * Powers two revolutionary features:
 * 1. VOICE SEARCH - Hum/sing to find songs (Shazam replacement)
 * 2. PHONETIC LYRICS - Transcribe any song phonetically for African languages
 *
 * Uses OpenAI Whisper API for:
 * - 99 language support
 * - Phonetic fallback for unrecognized languages (PERFECT for African music)
 * - Fast cloud processing
 *
 * Cost: $0.006/minute = basically free for our use case
 */

// Configuration - set via environment or directly
let OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || '';

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

// ============================================================================
// TYPES
// ============================================================================

export interface TranscriptionResult {
  text: string;
  language: string;
  duration: number;
  segments?: TranscriptionSegment[];
  words?: WordTimestamp[];
}

export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  confidence: number;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface VoiceSearchResult {
  query: string;           // What we'll search for
  confidence: number;      // How confident we are
  phonetics: string;       // Raw phonetic transcription
  possibleMatches: string[]; // Alternative interpretations
}

export interface PhoneticLyrics {
  trackId: string;
  originalText: string;    // Raw Whisper output
  cleanedText: string;     // Processed version
  segments: LyricSegment[];
  language: string;
  confidence: number;
  generatedAt: Date;
  polishedBy?: string[];   // Community editors
}

export interface LyricSegment {
  startTime: number;
  endTime: number;
  text: string;
  phonetic: string;        // IPA or phonetic spelling
  translation?: string;    // If we can translate (Soussou lexicon!)
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export function setOpenAIKey(key: string): void {
  OPENAI_API_KEY = key;
  console.log('[Whisper] API key configured');
}

export function isConfigured(): boolean {
  return !!OPENAI_API_KEY;
}

// ============================================================================
// CORE TRANSCRIPTION
// ============================================================================

/**
 * Transcribe audio to text using Whisper
 *
 * @param audioBlob - Audio file (mp3, wav, m4a, webm supported)
 * @param options - Transcription options
 */
export async function transcribeAudio(
  audioBlob: Blob,
  options: {
    language?: string;      // ISO 639-1 code, or omit for auto-detect
    prompt?: string;        // Guide transcription (e.g., "African music lyrics")
    responseFormat?: 'json' | 'verbose_json' | 'text';
    timestamps?: boolean;   // Get word-level timestamps
  } = {}
): Promise<TranscriptionResult> {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured. Call setOpenAIKey() first.');
  }

  const formData = new FormData();

  // Whisper accepts these formats: mp3, mp4, mpeg, mpga, m4a, wav, webm
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'whisper-1');

  // Response format
  const format = options.timestamps ? 'verbose_json' : (options.responseFormat || 'verbose_json');
  formData.append('response_format', format);

  // Language hint (optional - auto-detect is pretty good)
  if (options.language) {
    formData.append('language', options.language);
  }

  // Prompt to guide transcription
  // This is KEY for African music - helps Whisper understand context
  const defaultPrompt = 'Music lyrics transcription. Include phonetic spelling for non-English words. African music, Afrobeats, Highlife, Mbalax, Soukous.';
  formData.append('prompt', options.prompt || defaultPrompt);

  // Request timestamps for lyrics sync
  if (options.timestamps) {
    formData.append('timestamp_granularities[]', 'word');
    formData.append('timestamp_granularities[]', 'segment');
  }

  console.log('[Whisper] Transcribing audio...');
  const startTime = Date.now();

  const response = await fetch(WHISPER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(`Whisper API error: ${error.error?.message || response.statusText}`);
  }

  const result = await response.json();
  const duration = (Date.now() - startTime) / 1000;

  console.log(`[Whisper] Transcription complete in ${duration.toFixed(2)}s`);
  console.log(`[Whisper] Detected language: ${result.language}`);
  console.log(`[Whisper] Text: "${result.text?.substring(0, 100)}..."`);

  return {
    text: result.text,
    language: result.language || 'unknown',
    duration: result.duration || 0,
    segments: result.segments?.map((seg: any) => ({
      id: seg.id,
      start: seg.start,
      end: seg.end,
      text: seg.text,
      confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : 0.5,
    })),
    words: result.words?.map((w: any) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    })),
  };
}

// ============================================================================
// VOICE SEARCH (Shazam Replacement)
// ============================================================================

/**
 * Record audio from microphone
 */
export async function recordFromMicrophone(durationMs: number = 10000): Promise<Blob> {
  console.log(`[Whisper] Recording for ${durationMs / 1000}s...`);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 16000,  // Whisper likes 16kHz
    }
  });

  const mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus',
  });

  const chunks: Blob[] = [];

  return new Promise((resolve, reject) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());

      const blob = new Blob(chunks, { type: 'audio/webm' });
      console.log(`[Whisper] Recorded ${(blob.size / 1024).toFixed(1)}KB`);
      resolve(blob);
    };

    mediaRecorder.onerror = (e) => {
      stream.getTracks().forEach(track => track.stop());
      reject(e);
    };

    mediaRecorder.start();

    setTimeout(() => {
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }, durationMs);
  });
}

/**
 * Voice search - user hums/sings, we find the song
 *
 * Returns search queries to use with Piped API
 */
export async function voiceSearch(audioBlob?: Blob): Promise<VoiceSearchResult> {
  // Record if no audio provided
  const audio = audioBlob || await recordFromMicrophone(8000);

  // Transcribe with voice search optimization
  const result = await transcribeAudio(audio, {
    prompt: 'Song lyrics, melody humming, African music. Phonetic transcription of singing.',
  });

  // Clean up the transcription for search
  const cleaned = cleanForSearch(result.text);

  // Generate alternative interpretations
  const alternatives = generateAlternatives(result.text);

  return {
    query: cleaned,
    confidence: result.segments?.[0]?.confidence || 0.5,
    phonetics: result.text,
    possibleMatches: alternatives,
  };
}

/**
 * Clean transcription for search query
 */
function cleanForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove punctuation
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .replace(/\b(la|na|da|ba|mmm|hmm|oh|ah|yeah|uh)\b/g, '') // Remove filler sounds
    .trim();
}

/**
 * Generate alternative search queries from phonetic transcription
 */
function generateAlternatives(text: string): string[] {
  const alternatives: string[] = [];
  const words = text.toLowerCase().split(/\s+/);

  // Common phonetic confusions in African languages
  const phoneticMap: Record<string, string[]> = {
    'na': ['nya', 'la', 'ma'],
    'ko': ['go', 'kho', 'quo'],
    'la': ['ra', 'da', 'na'],
    'ba': ['pa', 'wa', 'ma'],
    'di': ['ti', 'ji', 'gi'],
    'fo': ['pho', 'ho', 'vo'],
    'we': ['ue', 'whe', 'way'],
    'yo': ['jo', 'io', 'yaw'],
  };

  // Generate variations
  for (let i = 0; i < Math.min(words.length, 5); i++) {
    const word = words[i];
    for (const [pattern, replacements] of Object.entries(phoneticMap)) {
      if (word.includes(pattern)) {
        for (const replacement of replacements) {
          alternatives.push(word.replace(pattern, replacement));
        }
      }
    }
  }

  // Also try partial phrase matches
  if (words.length >= 3) {
    alternatives.push(words.slice(0, 3).join(' '));
    alternatives.push(words.slice(-3).join(' '));
  }

  return [...new Set(alternatives)].slice(0, 5);
}

// ============================================================================
// PHONETIC LYRICS GENERATION
// ============================================================================

/**
 * Generate phonetic lyrics from a YouTube audio stream
 *
 * This is the KILLER FEATURE for African music:
 * - Captures phonetics even for languages Whisper doesn't "know"
 * - Community can polish and annotate
 * - Can integrate with Soussou lexicon for translations
 */
export async function generatePhoneticLyrics(
  trackId: string,
  audioUrl: string,
  trackTitle?: string
): Promise<PhoneticLyrics> {
  console.log(`[Whisper] Generating phonetic lyrics for: ${trackTitle || trackId}`);

  // Fetch audio from URL
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.statusText}`);
  }

  const audioBlob = await response.blob();

  // Transcribe with lyrics-optimized settings
  const result = await transcribeAudio(audioBlob, {
    prompt: `Song lyrics transcription for "${trackTitle || 'African song'}". Phonetic spelling for non-English words. Include Yoruba, Igbo, Hausa, Wolof, Mandinka, Soussou, Pidgin English lyrics.`,
    timestamps: true,
  });

  // Process into lyric segments
  const segments: LyricSegment[] = (result.segments || []).map(seg => ({
    startTime: seg.start,
    endTime: seg.end,
    text: seg.text,
    phonetic: toPhonetic(seg.text),
    // Translation added later by lexicon service
  }));

  return {
    trackId,
    originalText: result.text,
    cleanedText: cleanLyrics(result.text),
    segments,
    language: result.language,
    confidence: calculateOverallConfidence(result.segments || []),
    generatedAt: new Date(),
  };
}

/**
 * Convert text to phonetic representation
 * Basic IPA-like conversion for common patterns
 */
function toPhonetic(text: string): string {
  // This is a simplified phonetic conversion
  // For proper IPA, we'd need a more sophisticated system
  return text
    .toLowerCase()
    .replace(/ch/g, 'tʃ')
    .replace(/sh/g, 'ʃ')
    .replace(/th/g, 'θ')
    .replace(/ng/g, 'ŋ')
    .replace(/ny/g, 'ɲ')
    .replace(/gn/g, 'ɲ')
    .replace(/kh/g, 'x')
    .replace(/gh/g, 'ɣ')
    // Keep original for now - this would be enhanced with proper phonetic library
    ;
}

/**
 * Clean up lyrics text
 */
function cleanLyrics(text: string): string {
  return text
    .replace(/\[.*?\]/g, '')  // Remove [music], [applause] etc
    .replace(/\(.*?\)/g, '')  // Remove (inaudible) etc
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate overall confidence from segments
 */
function calculateOverallConfidence(segments: TranscriptionSegment[]): number {
  if (segments.length === 0) return 0.5;
  const total = segments.reduce((sum, seg) => sum + seg.confidence, 0);
  return total / segments.length;
}

// ============================================================================
// LYRICS STORAGE (localStorage for now, Supabase later)
// ============================================================================

const LYRICS_STORAGE_KEY = 'voyo_phonetic_lyrics';

/**
 * Save generated lyrics
 */
export function saveLyrics(lyrics: PhoneticLyrics): void {
  const stored = getLyricsStore();
  stored[lyrics.trackId] = lyrics;
  localStorage.setItem(LYRICS_STORAGE_KEY, JSON.stringify(stored));
  console.log(`[Whisper] Saved lyrics for ${lyrics.trackId}`);
}

/**
 * Get stored lyrics for a track
 */
export function getLyrics(trackId: string): PhoneticLyrics | null {
  const stored = getLyricsStore();
  return stored[trackId] || null;
}

/**
 * Get all stored lyrics
 */
function getLyricsStore(): Record<string, PhoneticLyrics> {
  try {
    const data = localStorage.getItem(LYRICS_STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

/**
 * Community polish - update lyrics with corrections
 */
export function polishLyrics(
  trackId: string,
  segmentIndex: number,
  corrections: {
    text?: string;
    phonetic?: string;
    translation?: string;
  },
  editorId: string
): boolean {
  const lyrics = getLyrics(trackId);
  if (!lyrics || !lyrics.segments[segmentIndex]) {
    return false;
  }

  const segment = lyrics.segments[segmentIndex];
  if (corrections.text) segment.text = corrections.text;
  if (corrections.phonetic) segment.phonetic = corrections.phonetic;
  if (corrections.translation) segment.translation = corrections.translation;

  // Track who polished it
  if (!lyrics.polishedBy) lyrics.polishedBy = [];
  if (!lyrics.polishedBy.includes(editorId)) {
    lyrics.polishedBy.push(editorId);
  }

  saveLyrics(lyrics);
  console.log(`[Whisper] Lyrics polished by ${editorId}`);
  return true;
}

// ============================================================================
// EXPORT STATE
// ============================================================================

export function getWhisperStats(): {
  isConfigured: boolean;
  lyricsCount: number;
  polishedCount: number;
} {
  const stored = getLyricsStore();
  const lyrics = Object.values(stored);

  return {
    isConfigured: isConfigured(),
    lyricsCount: lyrics.length,
    polishedCount: lyrics.filter(l => l.polishedBy && l.polishedBy.length > 0).length,
  };
}

console.log('[Whisper] Service loaded. Call setOpenAIKey() to enable.');

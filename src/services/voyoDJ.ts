/**
 * VOYO DJ - AI-Powered Radio DJ Experience
 *
 * REVOLUTIONARY FEATURE:
 * Gemini-powered DJ that actually UNDERSTANDS your listening journey
 * and narrates transitions like a real radio host.
 *
 * Features:
 * - Track introductions with context
 * - Mood-aware transitions ("You've been in your feels...")
 * - Time-of-day awareness ("Late night vibes coming at you...")
 * - Artist spotlights and fun facts
 * - Voice synthesis (speaks to you!)
 * - Multiple DJ personalities
 *
 * The DJ doesn't just announce - it UNDERSTANDS and CONNECTS.
 */

import { Track } from '../types';

// ============================================
// CONFIGURATION
// ============================================

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// DJ Personalities
export type DJPersonality = 'chill' | 'hype' | 'intellectual' | 'afrobeat-og' | 'late-night';

const DJ_PERSONALITIES: Record<DJPersonality, {
  name: string;
  style: string;
  voicePitch: number;
  voiceRate: number;
  catchphrases: string[];
}> = {
  'chill': {
    name: 'DJ Mellow',
    style: 'Laid-back, smooth, like a late-night radio host. Uses words like "vibes", "smooth", "easy". Never too loud or excited.',
    voicePitch: 0.9,
    voiceRate: 0.85,
    catchphrases: ['smooth vibes only', 'let it flow', 'ease into this one', 'feeling it'],
  },
  'hype': {
    name: 'DJ Blaze',
    style: 'High energy, hyped up, party starter! Uses exclamations, fire emojis in spirit, gets the crowd going. Think club DJ.',
    voicePitch: 1.1,
    voiceRate: 1.1,
    catchphrases: ['LETS GO!', 'turn it UP!', 'this one HITS different', 'are you ready?!'],
  },
  'intellectual': {
    name: 'DJ Sage',
    style: 'Thoughtful, drops knowledge about artists and music history. Like NPR meets hip-hop. Appreciates the artistry.',
    voicePitch: 1.0,
    voiceRate: 0.9,
    catchphrases: ['fascinating artist', 'the production here', 'notice how', 'musically speaking'],
  },
  'afrobeat-og': {
    name: 'DJ Naija',
    style: 'Authentic African vibe, drops Pidgin English, knows the Afrobeats scene inside out. Calls listeners "my people".',
    voicePitch: 1.0,
    voiceRate: 0.95,
    catchphrases: ['my people!', 'na so!', 'this one na banger', 'for the culture', 'wetin dey?'],
  },
  'late-night': {
    name: 'DJ Midnight',
    style: 'Intimate, reflective, perfect for 2am listening. Speaks softly, connects emotionally. Acknowledges the late hour.',
    voicePitch: 0.85,
    voiceRate: 0.8,
    catchphrases: ['for the night owls', 'while the world sleeps', 'just you and the music', 'in this moment'],
  },
};

// ============================================
// TYPES
// ============================================

export interface DJState {
  enabled: boolean;
  personality: DJPersonality;
  volume: number; // 0-100
  frequency: 'every-track' | 'every-3' | 'transitions-only';
  lastAnnouncement: number;
  totalAnnouncements: number;
}

export interface DJAnnouncement {
  text: string;
  type: 'intro' | 'transition' | 'outro' | 'commentary' | 'shoutout';
  mood: string;
  shouldSpeak: boolean;
}

interface ListeningContext {
  currentTrack: Track;
  previousTrack?: Track;
  recentTracks: Track[];
  sessionDuration: number; // minutes
  timeOfDay: string;
  skipCount: number;
  reactionCount: number;
  dominantMood: string;
}

// ============================================
// STATE
// ============================================

let djState: DJState = {
  enabled: false,
  personality: 'chill',
  volume: 80,
  frequency: 'every-3',
  lastAnnouncement: 0,
  totalAnnouncements: 0,
};

let recentTracks: Track[] = [];
let skipCount = 0;
let reactionCount = 0;
let sessionStart = Date.now();
let announcementQueue: DJAnnouncement[] = [];
let isSpeaking = false;

// Speech synthesis
let speechSynth: SpeechSynthesis | null = null;
let selectedVoice: SpeechSynthesisVoice | null = null;

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the DJ system
 */
export function initDJ(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    speechSynth = window.speechSynthesis;

    // Load voices (may be async)
    const loadVoices = () => {
      const voices = speechSynth!.getVoices();
      // Prefer a good English voice
      selectedVoice = voices.find(v =>
        v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Daniel') || v.name.includes('Samantha'))
      ) || voices.find(v => v.lang.startsWith('en')) || voices[0];

      console.log(`[VOYO DJ] Voice loaded: ${selectedVoice?.name}`);
    };

    if (speechSynth.getVoices().length > 0) {
      loadVoices();
    } else {
      speechSynth.onvoiceschanged = loadVoices;
    }
  }

  sessionStart = Date.now();
  console.log('[VOYO DJ] System initialized');
}

// ============================================
// DJ CONTROLS
// ============================================

/**
 * Enable/disable the DJ
 */
export function setDJEnabled(enabled: boolean): void {
  djState.enabled = enabled;
  console.log(`[VOYO DJ] ${enabled ? 'Enabled' : 'Disabled'}`);

  if (enabled && recentTracks.length > 0) {
    // Welcome back announcement
    generateAndSpeak({
      type: 'commentary',
      context: 'DJ just turned on, welcome the listener back',
    });
  }
}

/**
 * Set DJ personality
 */
export function setDJPersonality(personality: DJPersonality): void {
  djState.personality = personality;
  const dj = DJ_PERSONALITIES[personality];
  console.log(`[VOYO DJ] Switched to ${dj.name}`);
}

/**
 * Set announcement frequency
 */
export function setDJFrequency(frequency: DJState['frequency']): void {
  djState.frequency = frequency;
}

/**
 * Set DJ volume
 */
export function setDJVolume(volume: number): void {
  djState.volume = Math.max(0, Math.min(100, volume));
}

/**
 * Get current DJ state
 */
export function getDJState(): DJState {
  return { ...djState };
}

/**
 * Get available personalities
 */
export function getDJPersonalities(): typeof DJ_PERSONALITIES {
  return DJ_PERSONALITIES;
}

// ============================================
// TRACK EVENTS
// ============================================

/**
 * Record when a track starts playing
 */
export function onTrackStart(track: Track, previousTrack?: Track): void {
  recentTracks.push(track);
  if (recentTracks.length > 10) {
    recentTracks = recentTracks.slice(-10);
  }

  if (!djState.enabled) return;

  // Check if we should announce
  const shouldAnnounce = checkShouldAnnounce();

  if (shouldAnnounce) {
    generateAndSpeak({
      type: previousTrack ? 'transition' : 'intro',
      context: buildContext(track, previousTrack),
    });
  }
}

/**
 * Record when a track is skipped
 */
export function onTrackSkip(): void {
  skipCount++;

  if (!djState.enabled) return;

  // If multiple skips, DJ might comment
  if (skipCount >= 3 && skipCount % 3 === 0) {
    generateAndSpeak({
      type: 'commentary',
      context: 'User has been skipping tracks, acknowledge and adapt',
    });
  }
}

/**
 * Record when a track gets a reaction
 */
export function onTrackReaction(track: Track): void {
  reactionCount++;

  if (!djState.enabled) return;

  // DJ acknowledges the love!
  if (Math.random() < 0.5) { // 50% chance to comment on reaction
    generateAndSpeak({
      type: 'shoutout',
      context: `User just reacted/loved "${track.title}" by ${track.artist}`,
    });
  }
}

/**
 * Check if we should make an announcement
 */
function checkShouldAnnounce(): boolean {
  const now = Date.now();
  const timeSinceLast = now - djState.lastAnnouncement;
  const trackCount = recentTracks.length;

  switch (djState.frequency) {
    case 'every-track':
      return timeSinceLast > 10000; // At least 10s between
    case 'every-3':
      return trackCount % 3 === 0 && timeSinceLast > 30000;
    case 'transitions-only':
      return trackCount % 5 === 0 && timeSinceLast > 60000;
    default:
      return false;
  }
}

// ============================================
// CONTEXT BUILDING
// ============================================

/**
 * Build listening context for Gemini
 */
function buildContext(currentTrack: Track, previousTrack?: Track): ListeningContext {
  const now = new Date();
  const hour = now.getHours();

  let timeOfDay: string;
  if (hour >= 5 && hour < 12) timeOfDay = 'morning';
  else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
  else timeOfDay = 'late night';

  // Detect dominant mood from recent tracks
  const moods = recentTracks
    .filter(t => t.mood)
    .map(t => t.mood);
  const moodCounts = moods.reduce((acc, mood) => {
    acc[mood!] = (acc[mood!] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const dominantMood = Object.entries(moodCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'vibing';

  return {
    currentTrack,
    previousTrack,
    recentTracks: recentTracks.slice(-5),
    sessionDuration: Math.round((Date.now() - sessionStart) / 60000),
    timeOfDay,
    skipCount,
    reactionCount,
    dominantMood,
  };
}

// ============================================
// GEMINI INTEGRATION
// ============================================

interface GenerateOptions {
  type: DJAnnouncement['type'];
  context: string | ListeningContext;
}

/**
 * Generate DJ announcement using Gemini
 */
async function generateAnnouncement(options: GenerateOptions): Promise<DJAnnouncement | null> {
  const personality = DJ_PERSONALITIES[djState.personality];
  const ctx = typeof options.context === 'string'
    ? options.context
    : formatContextForPrompt(options.context);

  const prompt = `You are ${personality.name}, a radio DJ for VOYO Music, an African music streaming app.

YOUR PERSONALITY:
${personality.style}
Catchphrases you use: ${personality.catchphrases.join(', ')}

ANNOUNCEMENT TYPE: ${options.type}

CONTEXT:
${ctx}

TASK:
Generate a short, natural DJ announcement (1-3 sentences max).
- Sound like a REAL radio DJ, not an AI
- Be conversational and warm
- Reference the specific track/artist when relevant
- Match your personality style
- If it's late night, acknowledge it
- If user has been reacting, acknowledge the love

RESPOND WITH JSON ONLY:
{
  "text": "Your DJ announcement here",
  "mood": "one word describing the vibe"
}`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9, // More creative
          maxOutputTokens: 256,
        },
      }),
    });

    if (!response.ok) {
      console.error('[VOYO DJ] Gemini error:', response.status);
      return null;
    }

    const data = await response.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Strip markdown
    text = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

    const result = JSON.parse(text);

    return {
      text: result.text,
      type: options.type,
      mood: result.mood || 'vibing',
      shouldSpeak: true,
    };

  } catch (error) {
    console.error('[VOYO DJ] Generation error:', error);
    return getFallbackAnnouncement(options.type);
  }
}

/**
 * Format context object for prompt
 */
function formatContextForPrompt(ctx: ListeningContext): string {
  const trackList = ctx.recentTracks
    .map(t => `- ${t.artist} - ${t.title}`)
    .join('\n');

  return `
Current track: ${ctx.currentTrack.artist} - ${ctx.currentTrack.title}
${ctx.previousTrack ? `Previous track: ${ctx.previousTrack.artist} - ${ctx.previousTrack.title}` : ''}

Recent listening history:
${trackList}

Time: ${ctx.timeOfDay} (${new Date().toLocaleTimeString()})
Session duration: ${ctx.sessionDuration} minutes
Tracks skipped this session: ${ctx.skipCount}
Reactions given: ${ctx.reactionCount}
Dominant mood: ${ctx.dominantMood}
`;
}

/**
 * Fallback announcements when Gemini fails
 */
function getFallbackAnnouncement(type: DJAnnouncement['type']): DJAnnouncement {
  const personality = DJ_PERSONALITIES[djState.personality];
  const catchphrase = personality.catchphrases[Math.floor(Math.random() * personality.catchphrases.length)];

  const fallbacks: Record<string, string[]> = {
    intro: [
      `Welcome to VOYO Music... ${catchphrase}`,
      `Let's get into it... ${catchphrase}`,
    ],
    transition: [
      `And now... ${catchphrase}`,
      `Coming up next... ${catchphrase}`,
      `Here we go... ${catchphrase}`,
    ],
    commentary: [
      `Still here with you... ${catchphrase}`,
      `The vibes continue... ${catchphrase}`,
    ],
    shoutout: [
      `I see you feeling this one!`,
      `That's what I'm talking about!`,
    ],
    outro: [
      `Thanks for vibing with VOYO...`,
      `Until next time... ${catchphrase}`,
    ],
  };

  const options = fallbacks[type] || fallbacks.transition;
  const text = options[Math.floor(Math.random() * options.length)];

  return {
    text,
    type,
    mood: 'vibing',
    shouldSpeak: true,
  };
}

// ============================================
// SPEECH SYNTHESIS
// ============================================

/**
 * Generate and speak an announcement
 */
async function generateAndSpeak(options: GenerateOptions): Promise<void> {
  if (isSpeaking) {
    // Queue it
    const announcement = await generateAnnouncement(options);
    if (announcement) {
      announcementQueue.push(announcement);
    }
    return;
  }

  const announcement = await generateAnnouncement(options);
  if (announcement) {
    await speak(announcement);
  }
}

/**
 * Speak an announcement using Web Speech API
 */
export async function speak(announcement: DJAnnouncement): Promise<void> {
  if (!speechSynth || !selectedVoice || !announcement.shouldSpeak) {
    console.log(`[VOYO DJ] ${announcement.text}`);
    return;
  }

  return new Promise((resolve) => {
    isSpeaking = true;

    const utterance = new SpeechSynthesisUtterance(announcement.text);
    const personality = DJ_PERSONALITIES[djState.personality];

    utterance.voice = selectedVoice;
    utterance.pitch = personality.voicePitch;
    utterance.rate = personality.voiceRate;
    utterance.volume = djState.volume / 100;

    utterance.onend = () => {
      isSpeaking = false;
      djState.lastAnnouncement = Date.now();
      djState.totalAnnouncements++;

      console.log(`[VOYO DJ] 🎙️ "${announcement.text}"`);

      // Process queue
      if (announcementQueue.length > 0) {
        const next = announcementQueue.shift()!;
        speak(next);
      }

      resolve();
    };

    utterance.onerror = () => {
      isSpeaking = false;
      console.log(`[VOYO DJ] Speech error, text: "${announcement.text}"`);
      resolve();
    };

    speechSynth!.speak(utterance);
  });
}

/**
 * Stop current speech
 */
export function stopSpeaking(): void {
  if (speechSynth) {
    speechSynth.cancel();
    isSpeaking = false;
    announcementQueue = [];
  }
}

// ============================================
// MANUAL TRIGGERS
// ============================================

/**
 * Request DJ to say something specific
 */
export async function djSay(text: string): Promise<void> {
  await speak({
    text,
    type: 'commentary',
    mood: 'custom',
    shouldSpeak: true,
  });
}

/**
 * Request DJ to introduce current track
 */
export async function djIntroduceTrack(track: Track): Promise<void> {
  const announcement = await generateAnnouncement({
    type: 'intro',
    context: buildContext(track),
  });

  if (announcement) {
    await speak(announcement);
  }
}

/**
 * Request DJ to give a session summary
 */
export async function djSessionSummary(): Promise<string> {
  const personality = DJ_PERSONALITIES[djState.personality];
  const sessionMinutes = Math.round((Date.now() - sessionStart) / 60000);

  const prompt = `You are ${personality.name}, wrapping up a listening session on VOYO Music.

SESSION STATS:
- Duration: ${sessionMinutes} minutes
- Tracks played: ${recentTracks.length}
- Reactions given: ${reactionCount}
- Skips: ${skipCount}
- Recent artists: ${[...new Set(recentTracks.slice(-5).map(t => t.artist))].join(', ')}

Give a warm, personal 2-3 sentence goodbye that references their listening. Be genuine, not cheesy.

RESPOND WITH JSON: { "text": "your goodbye message" }`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 200 },
      }),
    });

    const data = await response.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(text);

    await speak({
      text: result.text,
      type: 'outro',
      mood: 'grateful',
      shouldSpeak: true,
    });

    return result.text;
  } catch (e) {
    const fallback = `Thanks for spending ${sessionMinutes} minutes with VOYO. Until next time!`;
    await speak({ text: fallback, type: 'outro', mood: 'grateful', shouldSpeak: true });
    return fallback;
  }
}

// ============================================
// SPECIAL ANNOUNCEMENTS
// ============================================

/**
 * DJ announces a mood shift detected
 */
export async function djAnnounceMoodShift(fromMood: string, toMood: string): Promise<void> {
  await generateAndSpeak({
    type: 'transition',
    context: `User's mood shifted from ${fromMood} to ${toMood}. Acknowledge this transition naturally.`,
  });
}

/**
 * DJ announces a new artist discovery
 */
export async function djAnnounceNewArtist(artist: string): Promise<void> {
  await generateAndSpeak({
    type: 'intro',
    context: `User is hearing ${artist} for the first time in this session. Introduce them!`,
  });
}

/**
 * DJ announces trending/hot track
 */
export async function djAnnounceTrending(track: Track): Promise<void> {
  await generateAndSpeak({
    type: 'shoutout',
    context: `"${track.title}" by ${track.artist} is trending/popular right now. Hype it up!`,
  });
}

// ============================================
// INITIALIZATION ON IMPORT
// ============================================

// Auto-init if in browser
if (typeof window !== 'undefined') {
  initDJ();
}

export default {
  initDJ,
  setDJEnabled,
  setDJPersonality,
  setDJFrequency,
  setDJVolume,
  getDJState,
  getDJPersonalities,
  onTrackStart,
  onTrackSkip,
  onTrackReaction,
  speak,
  stopSpeaking,
  djSay,
  djIntroduceTrack,
  djSessionSummary,
  djAnnounceMoodShift,
  djAnnounceNewArtist,
  djAnnounceTrending,
};

/**
 * OYO - Your Personal AI DJ & Virtual Music Friend
 *
 * OYO is not just a DJ - it's a companion that:
 * - LEARNS your taste over time
 * - REMEMBERS what you love and hate
 * - Has a PERSONALITY you define
 * - Can be RENAMED and CUSTOMIZED
 * - SHARES moments to DAHUB social
 * - Becomes your VIRTUAL FRIEND in the music journey
 *
 * Default name: OYO (Oh-Yo!)
 * Users can rename: "My DJ is called Zara"
 * Users can define: "She's chill, drops knowledge, calls me 'fam'"
 *
 * The more you use VOYO, the better OYO knows you.
 */

import { Track } from '../types';

// ============================================
// CONFIGURATION
// ============================================

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// ============================================
// DJ PROFILE (User customizable)
// ============================================

export interface DJProfile {
  // Identity
  name: string;                    // Default: "OYO"
  nickname: string;                // What DJ calls the user: "fam", "boss", "my G"
  pronouns: 'he' | 'she' | 'they'; // For consistent personality

  // Personality (user-defined or preset)
  personality: DJPersonalityTraits;

  // Voice settings
  voice: DJVoiceSettings;

  // Relationship
  relationship: DJRelationship;

  // Social
  social: DJSocial;

  // Timestamps
  createdAt: string;
  lastInteractionAt: string;
}

export interface DJPersonalityTraits {
  // Core traits (0-100 scale)
  energy: number;          // 0=chill, 100=hype
  humor: number;           // 0=serious, 100=jokey
  knowledge: number;       // 0=casual, 100=drops facts
  warmth: number;          // 0=professional, 100=friendly
  localFlavor: number;     // 0=neutral, 100=heavy slang/pidgin

  // Custom traits (user can add their own)
  customTraits: string[];  // e.g., ["philosophical", "nostalgic", "encouraging"]

  // Speech patterns
  catchphrases: string[];  // User can add custom catchphrases
  avoidPhrases: string[]; // Things DJ should never say

  // Description (for AI context)
  description: string;     // e.g., "A wise, chill DJ who drops gems about life"
}

export interface DJVoiceSettings {
  enabled: boolean;
  pitch: number;           // 0.5 - 2.0
  rate: number;            // 0.5 - 2.0
  volume: number;          // 0 - 100
  preferredVoice?: string; // Browser voice name if available
}

export interface DJRelationship {
  // Memory
  favoriteArtists: string[];      // Artists you've reacted to most
  dislikedArtists: string[];      // Artists you skip most
  favoriteMoods: string[];        // Moods you prefer
  peakListeningHours: number[];   // Hours you listen most
  totalTracksShared: number;
  totalSessionsStarted: number;
  totalTimeListened: number;      // Minutes

  // Learned preferences (AI fills these)
  learnedPreferences: LearnedPreference[];

  // Milestones
  milestones: DJMilestone[];
}

export interface LearnedPreference {
  type: 'like' | 'dislike' | 'neutral';
  subject: string;              // What it's about: "late night music", "upbeat mornings"
  confidence: number;           // 0-100 how sure
  learnedFrom: string;          // "skip patterns", "reactions", "time of day"
  learnedAt: string;
}

export interface DJMilestone {
  id: string;
  title: string;                // "First week together!"
  description: string;
  unlockedAt: string;
  celebrated: boolean;          // Has DJ announced this?
}

export interface DJSocial {
  isPublic: boolean;            // Can others see your DJ?
  sharedMoments: SharedMoment[];
  dahubProfileId?: string;      // Link to DAHUB profile
}

export interface SharedMoment {
  id: string;
  type: 'track-intro' | 'session-summary' | 'milestone' | 'vibe-check';
  content: string;              // What DJ said
  trackId?: string;             // If about a specific track
  sharedAt: string;
  reactions: number;            // Likes on DAHUB
}

// ============================================
// DEFAULT DJ PROFILE
// ============================================

const DEFAULT_DJ_PROFILE: DJProfile = {
  name: 'OYO',
  nickname: 'fam',
  pronouns: 'they',

  personality: {
    energy: 50,
    humor: 60,
    knowledge: 70,
    warmth: 80,
    localFlavor: 60,
    customTraits: ['encouraging', 'music-savvy', 'culturally-aware'],
    catchphrases: [
      'my people!',
      'let\'s go!',
      'this one hits different',
      'for the culture',
      'you know how we do',
    ],
    avoidPhrases: [],
    description: 'A warm, knowledgeable DJ who deeply loves African music and treats every listener like family. Drops music knowledge naturally, celebrates your wins, and always keeps the vibe right.',
  },

  voice: {
    enabled: true,
    pitch: 1.0,
    rate: 0.95,
    volume: 80,
  },

  relationship: {
    favoriteArtists: [],
    dislikedArtists: [],
    favoriteMoods: [],
    peakListeningHours: [],
    totalTracksShared: 0,
    totalSessionsStarted: 0,
    totalTimeListened: 0,
    learnedPreferences: [],
    milestones: [],
  },

  social: {
    isPublic: false,
    sharedMoments: [],
  },

  createdAt: new Date().toISOString(),
  lastInteractionAt: new Date().toISOString(),
};

// ============================================
// STATE
// ============================================

let djProfile: DJProfile = { ...DEFAULT_DJ_PROFILE };
let recentTracks: Track[] = [];
let sessionStart = Date.now();
let skipCount = 0;
let reactionCount = 0;
let announcementHistory: string[] = [];

// Speech synthesis
let speechSynth: SpeechSynthesis | null = null;
let selectedVoice: SpeechSynthesisVoice | null = null;
let isSpeaking = false;

// ============================================
// PERSISTENCE
// ============================================

const STORAGE_KEY = 'voyo-oyo-profile';

/**
 * Save DJ profile to localStorage
 */
function saveProfile(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(djProfile));
  } catch (e) {
    console.warn('[OYO] Failed to save profile:', e);
  }
}

/**
 * Load DJ profile from localStorage
 */
function loadProfile(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      djProfile = { ...DEFAULT_DJ_PROFILE, ...parsed };
      console.log(`[OYO] Profile loaded: ${djProfile.name}`);
    }
  } catch (e) {
    console.warn('[OYO] Failed to load profile:', e);
  }
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize OYO
 */
export function initOYO(): void {
  loadProfile();

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    speechSynth = window.speechSynthesis;

    const loadVoices = () => {
      const voices = speechSynth!.getVoices();
      selectedVoice = voices.find(v =>
        djProfile.voice.preferredVoice && v.name.includes(djProfile.voice.preferredVoice)
      ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
      console.log(`[OYO] Voice: ${selectedVoice?.name}`);
    };

    if (speechSynth.getVoices().length > 0) {
      loadVoices();
    } else {
      speechSynth.onvoiceschanged = loadVoices;
    }
  }

  sessionStart = Date.now();
  djProfile.relationship.totalSessionsStarted++;
  djProfile.lastInteractionAt = new Date().toISOString();
  saveProfile();

  console.log(`[OYO] 🎙️ ${djProfile.name} is ready!`);
}

// ============================================
// PROFILE MANAGEMENT
// ============================================

/**
 * Get current DJ profile
 */
export function getProfile(): DJProfile {
  return { ...djProfile };
}

/**
 * Update DJ name
 */
export function setDJName(name: string): void {
  djProfile.name = name;
  saveProfile();
  console.log(`[OYO] DJ renamed to: ${name}`);
}

/**
 * Update what DJ calls the user
 */
export function setUserNickname(nickname: string): void {
  djProfile.nickname = nickname;
  saveProfile();
}

/**
 * Update personality traits
 */
export function updatePersonality(updates: Partial<DJPersonalityTraits>): void {
  djProfile.personality = { ...djProfile.personality, ...updates };
  saveProfile();
}

/**
 * Add a custom catchphrase
 */
export function addCatchphrase(phrase: string): void {
  if (!djProfile.personality.catchphrases.includes(phrase)) {
    djProfile.personality.catchphrases.push(phrase);
    saveProfile();
  }
}

/**
 * Add a phrase to avoid
 */
export function addAvoidPhrase(phrase: string): void {
  if (!djProfile.personality.avoidPhrases.includes(phrase)) {
    djProfile.personality.avoidPhrases.push(phrase);
    saveProfile();
  }
}

/**
 * Update voice settings
 */
export function updateVoiceSettings(settings: Partial<DJVoiceSettings>): void {
  djProfile.voice = { ...djProfile.voice, ...settings };
  saveProfile();
}

/**
 * Reset DJ to defaults
 */
export function resetDJ(): void {
  djProfile = { ...DEFAULT_DJ_PROFILE, createdAt: new Date().toISOString() };
  saveProfile();
  console.log('[OYO] DJ reset to defaults');
}

// ============================================
// LEARNING SYSTEM
// ============================================

/**
 * Learn from user behavior
 */
function learnFromBehavior(behavior: {
  type: 'play' | 'skip' | 'reaction' | 'complete';
  track: Track;
  context?: Record<string, any>;
}): void {
  const { type, track, context } = behavior;

  // Update favorite/disliked artists
  if (type === 'reaction') {
    if (!djProfile.relationship.favoriteArtists.includes(track.artist)) {
      djProfile.relationship.favoriteArtists.push(track.artist);
      // Keep top 20
      if (djProfile.relationship.favoriteArtists.length > 20) {
        djProfile.relationship.favoriteArtists = djProfile.relationship.favoriteArtists.slice(-20);
      }
    }
  } else if (type === 'skip') {
    // Track skip patterns
    const skippedArtist = track.artist;
    const existingSkips = djProfile.relationship.learnedPreferences.filter(
      p => p.subject === skippedArtist && p.type === 'dislike'
    );

    if (existingSkips.length >= 3) {
      // Add to disliked if skipped 3+ times
      if (!djProfile.relationship.dislikedArtists.includes(skippedArtist)) {
        djProfile.relationship.dislikedArtists.push(skippedArtist);
      }
    }
  }

  // Track peak hours
  const hour = new Date().getHours();
  if (!djProfile.relationship.peakListeningHours.includes(hour)) {
    djProfile.relationship.peakListeningHours.push(hour);
  }

  // Track moods
  if (track.mood && type === 'complete') {
    if (!djProfile.relationship.favoriteMoods.includes(track.mood)) {
      djProfile.relationship.favoriteMoods.push(track.mood);
    }
  }

  saveProfile();
}

/**
 * Check and unlock milestones
 */
function checkMilestones(): DJMilestone | null {
  const rel = djProfile.relationship;
  const milestones = rel.milestones;

  // First track
  if (rel.totalTracksShared === 1 && !milestones.find(m => m.id === 'first-track')) {
    const milestone: DJMilestone = {
      id: 'first-track',
      title: 'First Vibe Together!',
      description: `${djProfile.name} played your first track. The journey begins!`,
      unlockedAt: new Date().toISOString(),
      celebrated: false,
    };
    milestones.push(milestone);
    saveProfile();
    return milestone;
  }

  // 10 tracks
  if (rel.totalTracksShared === 10 && !milestones.find(m => m.id === '10-tracks')) {
    const milestone: DJMilestone = {
      id: '10-tracks',
      title: 'Getting to Know You',
      description: `10 tracks in. ${djProfile.name} is learning your vibe!`,
      unlockedAt: new Date().toISOString(),
      celebrated: false,
    };
    milestones.push(milestone);
    saveProfile();
    return milestone;
  }

  // 100 tracks
  if (rel.totalTracksShared === 100 && !milestones.find(m => m.id === '100-tracks')) {
    const milestone: DJMilestone = {
      id: '100-tracks',
      title: 'Century Club',
      description: `100 tracks! ${djProfile.name} knows your taste now.`,
      unlockedAt: new Date().toISOString(),
      celebrated: false,
    };
    milestones.push(milestone);
    saveProfile();
    return milestone;
  }

  // First hour
  if (rel.totalTimeListened >= 60 && !milestones.find(m => m.id === 'first-hour')) {
    const milestone: DJMilestone = {
      id: 'first-hour',
      title: 'Hour of Vibes',
      description: `You've vibed with ${djProfile.name} for a whole hour!`,
      unlockedAt: new Date().toISOString(),
      celebrated: false,
    };
    milestones.push(milestone);
    saveProfile();
    return milestone;
  }

  return null;
}

// ============================================
// ANNOUNCEMENT GENERATION
// ============================================

interface AnnouncementContext {
  type: 'intro' | 'transition' | 'milestone' | 'vibe-check' | 'goodbye' | 'reaction';
  currentTrack?: Track;
  previousTrack?: Track;
  milestone?: DJMilestone;
  customContext?: string;
}

/**
 * Build personality context for Gemini
 */
function buildPersonalityPrompt(): string {
  const p = djProfile.personality;
  const rel = djProfile.relationship;

  // Convert numbers to descriptive terms
  const energyDesc = p.energy < 30 ? 'very chill and laid-back' :
    p.energy < 70 ? 'balanced energy' : 'high energy and hype';
  const humorDesc = p.humor < 30 ? 'serious and professional' :
    p.humor < 70 ? 'occasionally funny' : 'very humorous and playful';
  const knowledgeDesc = p.knowledge < 30 ? 'casual, doesn\'t drop facts' :
    p.knowledge < 70 ? 'sometimes shares music knowledge' : 'drops deep music knowledge and facts';
  const warmthDesc = p.warmth < 30 ? 'professional distance' :
    p.warmth < 70 ? 'friendly but not overly personal' : 'very warm, treats listener like close friend';
  const localDesc = p.localFlavor < 30 ? 'neutral accent, standard English' :
    p.localFlavor < 70 ? 'occasional slang and local flavor' : 'heavy pidgin/local slang';

  let prompt = `You are ${djProfile.name}, a personal AI DJ and music companion.

PERSONALITY:
- Energy: ${energyDesc}
- Humor: ${humorDesc}
- Knowledge: ${knowledgeDesc}
- Warmth: ${warmthDesc}
- Local flavor: ${localDesc}
- Custom traits: ${p.customTraits.join(', ')}

SPEECH PATTERNS:
- Call the user: "${djProfile.nickname}"
- Catchphrases to use naturally: ${p.catchphrases.join(', ')}
${p.avoidPhrases.length > 0 ? `- NEVER say: ${p.avoidPhrases.join(', ')}` : ''}

YOUR DESCRIPTION: ${p.description}

WHAT YOU KNOW ABOUT THIS USER:
- Favorite artists: ${rel.favoriteArtists.slice(0, 5).join(', ') || 'Still learning...'}
- Artists they skip: ${rel.dislikedArtists.slice(0, 3).join(', ') || 'None yet'}
- Preferred moods: ${rel.favoriteMoods.slice(0, 3).join(', ') || 'Exploring'}
- Tracks you've shared: ${rel.totalTracksShared}
- Sessions together: ${rel.totalSessionsStarted}
- Time listening: ${Math.round(rel.totalTimeListened / 60)} hours total

RULES:
- Sound like a REAL person, not AI
- Be conversational and natural
- Use your catchphrases NATURALLY, not forced
- 1-3 sentences MAX
- If you know their favorites, reference them occasionally
- NEVER be generic - be PERSONAL`;

  return prompt;
}

/**
 * Generate DJ announcement using Gemini
 */
async function generateAnnouncement(ctx: AnnouncementContext): Promise<string> {
  const personalityPrompt = buildPersonalityPrompt();

  let contextPrompt = '';
  switch (ctx.type) {
    case 'intro':
      contextPrompt = `Introduce the track "${ctx.currentTrack?.title}" by ${ctx.currentTrack?.artist}. Be excited but natural.`;
      break;
    case 'transition':
      contextPrompt = `Transition from "${ctx.previousTrack?.title}" by ${ctx.previousTrack?.artist} to "${ctx.currentTrack?.title}" by ${ctx.currentTrack?.artist}. Make the connection feel natural.`;
      break;
    case 'milestone':
      contextPrompt = `Celebrate this milestone: ${ctx.milestone?.title} - ${ctx.milestone?.description}. Be genuinely happy for the user!`;
      break;
    case 'vibe-check':
      contextPrompt = `Check in on the user's vibe after ${recentTracks.length} tracks. Recent artists: ${recentTracks.slice(-3).map(t => t.artist).join(', ')}. Time: ${new Date().toLocaleTimeString()}.`;
      break;
    case 'goodbye':
      contextPrompt = `Say goodbye for now. Session was ${Math.round((Date.now() - sessionStart) / 60000)} minutes. Be warm and leave them feeling good.`;
      break;
    case 'reaction':
      contextPrompt = `The user just LOVED "${ctx.currentTrack?.title}" by ${ctx.currentTrack?.artist}! Acknowledge their reaction enthusiastically.`;
      break;
    default:
      contextPrompt = ctx.customContext || 'Say something nice.';
  }

  const fullPrompt = `${personalityPrompt}

TASK: ${contextPrompt}

RESPOND WITH JSON ONLY:
{ "text": "Your announcement here" }`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 200 },
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(text);

    announcementHistory.push(result.text);
    if (announcementHistory.length > 50) {
      announcementHistory = announcementHistory.slice(-50);
    }

    return result.text;

  } catch (error) {
    console.error('[OYO] Generation error:', error);
    // Fallback
    const catchphrase = djProfile.personality.catchphrases[
      Math.floor(Math.random() * djProfile.personality.catchphrases.length)
    ];
    return `${catchphrase} Here comes ${ctx.currentTrack?.artist || 'a banger'}!`;
  }
}

// ============================================
// SPEECH
// ============================================

/**
 * Speak an announcement
 */
export async function speak(text: string): Promise<void> {
  console.log(`[OYO] 🎙️ "${text}"`);

  if (!speechSynth || !selectedVoice || !djProfile.voice.enabled) {
    return;
  }

  if (isSpeaking) {
    speechSynth.cancel();
  }

  return new Promise((resolve) => {
    isSpeaking = true;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = selectedVoice;
    utterance.pitch = djProfile.voice.pitch;
    utterance.rate = djProfile.voice.rate;
    utterance.volume = djProfile.voice.volume / 100;

    utterance.onend = () => {
      isSpeaking = false;
      resolve();
    };

    utterance.onerror = () => {
      isSpeaking = false;
      resolve();
    };

    speechSynth!.speak(utterance);
  });
}

/**
 * Stop speaking
 */
export function stopSpeaking(): void {
  if (speechSynth) {
    speechSynth.cancel();
    isSpeaking = false;
  }
}

// ============================================
// EVENT HANDLERS
// ============================================

let tracksSinceLastAnnouncement = 0;
const ANNOUNCE_EVERY_N_TRACKS = 3;

/**
 * Called when a track starts playing
 */
export async function onTrackPlay(track: Track, previousTrack?: Track): Promise<void> {
  recentTracks.push(track);
  if (recentTracks.length > 15) {
    recentTracks = recentTracks.slice(-15);
  }

  djProfile.relationship.totalTracksShared++;
  djProfile.lastInteractionAt = new Date().toISOString();

  learnFromBehavior({ type: 'play', track });

  // Check milestones
  const milestone = checkMilestones();
  if (milestone && !milestone.celebrated) {
    milestone.celebrated = true;
    saveProfile();
    const announcement = await generateAnnouncement({ type: 'milestone', milestone });
    await speak(announcement);
    return;
  }

  // Announce every N tracks
  tracksSinceLastAnnouncement++;
  if (tracksSinceLastAnnouncement >= ANNOUNCE_EVERY_N_TRACKS) {
    tracksSinceLastAnnouncement = 0;

    const type = previousTrack ? 'transition' : 'intro';
    const announcement = await generateAnnouncement({ type, currentTrack: track, previousTrack });
    await speak(announcement);
  }
}

/**
 * Called when a track is skipped
 */
export function onTrackSkip(track: Track): void {
  skipCount++;
  learnFromBehavior({ type: 'skip', track });

  // If many skips, maybe check in
  if (skipCount % 5 === 0) {
    generateAnnouncement({ type: 'vibe-check' }).then(speak);
  }
}

/**
 * Called when user reacts to a track
 */
export async function onTrackReaction(track: Track): Promise<void> {
  reactionCount++;
  learnFromBehavior({ type: 'reaction', track });

  // 50% chance to acknowledge reaction
  if (Math.random() < 0.5) {
    const announcement = await generateAnnouncement({ type: 'reaction', currentTrack: track });
    await speak(announcement);
  }
}

/**
 * Called when a track completes
 */
export function onTrackComplete(track: Track, listenDuration: number): void {
  djProfile.relationship.totalTimeListened += listenDuration / 60; // Convert to minutes
  learnFromBehavior({ type: 'complete', track });
  checkMilestones();
  saveProfile();
}

/**
 * Say goodbye and end session
 */
export async function endSession(): Promise<string> {
  const announcement = await generateAnnouncement({ type: 'goodbye' });
  await speak(announcement);
  saveProfile();
  return announcement;
}

// ============================================
// SOCIAL / SHARING
// ============================================

/**
 * Share a moment to DAHUB
 */
export function shareMoment(
  type: SharedMoment['type'],
  content: string,
  trackId?: string
): SharedMoment {
  const moment: SharedMoment = {
    id: `moment-${Date.now()}`,
    type,
    content,
    trackId,
    sharedAt: new Date().toISOString(),
    reactions: 0,
  };

  djProfile.social.sharedMoments.push(moment);
  if (djProfile.social.sharedMoments.length > 100) {
    djProfile.social.sharedMoments = djProfile.social.sharedMoments.slice(-100);
  }

  saveProfile();
  console.log(`[OYO] Shared to DAHUB: "${content.slice(0, 50)}..."`);

  return moment;
}

/**
 * Get shareable moments
 */
export function getSharedMoments(): SharedMoment[] {
  return djProfile.social.sharedMoments;
}

/**
 * Toggle public profile
 */
export function setPublicProfile(isPublic: boolean): void {
  djProfile.social.isPublic = isPublic;
  saveProfile();
}

// ============================================
// MANUAL CONTROLS
// ============================================

/**
 * Make DJ say something custom
 */
export async function say(text: string): Promise<void> {
  await speak(text);
}

/**
 * Ask DJ to introduce current track
 */
export async function introduce(track: Track): Promise<string> {
  const announcement = await generateAnnouncement({ type: 'intro', currentTrack: track });
  await speak(announcement);
  return announcement;
}

/**
 * Ask DJ for a vibe check
 */
export async function vibeCheck(): Promise<string> {
  const announcement = await generateAnnouncement({ type: 'vibe-check' });
  await speak(announcement);
  return announcement;
}

/**
 * Get DJ's learned insights about user
 */
export function getInsights(): {
  favoriteArtists: string[];
  favoriteMoods: string[];
  peakHours: number[];
  totalTime: number;
  milestones: DJMilestone[];
} {
  return {
    favoriteArtists: djProfile.relationship.favoriteArtists,
    favoriteMoods: djProfile.relationship.favoriteMoods,
    peakHours: djProfile.relationship.peakListeningHours,
    totalTime: djProfile.relationship.totalTimeListened,
    milestones: djProfile.relationship.milestones,
  };
}

// ============================================
// INITIALIZATION
// ============================================

if (typeof window !== 'undefined') {
  initOYO();
}

export default {
  // Profile
  getProfile,
  setDJName,
  setUserNickname,
  updatePersonality,
  addCatchphrase,
  addAvoidPhrase,
  updateVoiceSettings,
  resetDJ,

  // Events
  onTrackPlay,
  onTrackSkip,
  onTrackReaction,
  onTrackComplete,
  endSession,

  // Controls
  speak,
  stopSpeaking,
  say,
  introduce,
  vibeCheck,

  // Social
  shareMoment,
  getSharedMoments,
  setPublicProfile,

  // Insights
  getInsights,
};

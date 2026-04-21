// VOYO Music - Seed Data (African Bangers with REAL YouTube IDs)
import { Track, Playlist, MoodTunnel, Reaction } from '../types';
import { getThumb } from '../utils/thumbnail';

// Re-export thumbnail utilities for backward compatibility
export { getThumb as getThumbnailUrl, getThumb as getYouTubeThumbnail, getThumbWithFallback as getThumbnailWithFallback } from '../utils/thumbnail';

// Local alias for internal use
const getThumbnailUrl = getThumb;

// ============================================
// MOOD TUNNELS (legacy - for compatibility)
// ============================================

export const MOOD_TUNNELS: MoodTunnel[] = [
  {
    id: 'afro',
    name: 'AFRO',
    icon: '🌍',
    color: '#a855f7',
    gradient: 'from-purple-600 to-pink-600',
  },
  {
    id: 'feed',
    name: 'FEED',
    icon: '🔥',
    color: '#ef4444',
    gradient: 'from-red-500 to-orange-500',
  },
  {
    id: 'rnb',
    name: 'RNB',
    icon: '💜',
    color: '#8b5cf6',
    gradient: 'from-violet-600 to-purple-600',
  },
  {
    id: 'hype',
    name: 'HYPE',
    icon: '⚡',
    color: '#f59e0b',
    gradient: 'from-yellow-500 to-orange-500',
  },
  {
    id: 'chill',
    name: 'CHILL',
    icon: '🌙',
    color: '#06b6d4',
    gradient: 'from-cyan-500 to-blue-500',
  },
  {
    id: 'heartbreak',
    name: 'FEELS',
    icon: '💔',
    color: '#ec4899',
    gradient: 'from-pink-500 to-rose-500',
  },
];

// ============================================
// VIBES (matches MixBoard modes + database vibes)
// ============================================
export interface Vibe {
  id: string;           // Matches database vibe name (afro-heat, etc.)
  name: string;         // Display name
  icon: string;         // Emoji fallback
  lottie?: string;      // Lottie animation URL (optional)
  color: string;        // Primary color
  gradient: string;     // Tailwind gradient classes
  description: string;  // Short description
  image?: string;       // Optional background portrait/artwork
}

// Premium palette (April 2026): Heating Up RN is the ONLY non-purple —
// luxury bronze-orange close to the OYÉ button. Everything else lives in
// purple fades (light → mid → deep) so the shelf reads as one canvas with
// one hot moment. Only Heating Up RN keeps a lottie (fire); the rest drop
// their icons in favour of the faded big-title-over-artwork treatment.
export const VIBES: Vibe[] = [
  {
    id: 'afro-heat',
    name: 'HEATING UP RN',
    icon: '🔥',
    color: '#F4A23E',
    gradient: 'from-amber-500 via-orange-500 to-amber-700',
    description: 'Afrobeats • Amapiano',
    image: '/vibes/dash.png', // hero — Dash (central card)
  },
  {
    id: 'chill-vibes',
    name: 'CHILL',
    icon: '💜',
    color: '#c4b5fd',
    gradient: 'from-violet-300 via-violet-400 to-purple-500',
    description: 'Relax & Be',
    image: '/vibes/ai-chill.png', // AI — golden-hour cityscape dusk
  },
  {
    id: 'party-mode',
    name: 'PARTY',
    icon: '🪩',
    color: '#a78bfa',
    gradient: 'from-violet-400 via-purple-500 to-purple-600',
    description: 'Get on Da Dance Floor',
    image: '/vibes/ai-party.png', // AI — kinetic dance energy in gold light
  },
  {
    id: 'late-night',
    name: 'LATE NIGHT',
    icon: '🌙',
    color: '#8b5cf6',
    gradient: 'from-purple-500 via-purple-700 to-violet-900',
    description: 'City Lights • Vibes',
    image: '/vibes/ai-late-night.png', // AI — violet Lagos 3am skyline
  },
  {
    id: 'workout',
    name: 'WORKOUT',
    icon: '⚡',
    color: '#7c3aed',
    gradient: 'from-violet-600 via-purple-700 to-purple-900',
    description: 'Pump it UP',
    image: '/vibes/ai-workout.png', // AI — bronze sunburst power pattern
  },
];

// ============================================
// TRACKS (REAL YouTube Video IDs - African Bangers)
// ============================================

// REAL WORKING Video IDs (verified Dec 2025)
export const TRACKS: Track[] = [
  {
    id: '0',
    title: 'GINJA SESSIONS | Afrobeats, Dancehall, Amapiano Mix',
    artist: 'Ethan Tomas',
    album: 'GINJA SESSIONS',
    trackId: 'mhd0RcE6XC4',
    coverUrl: getThumbnailUrl('mhd0RcE6XC4'),
    duration: 4103,
    tags: ['afrobeats', 'dancehall', 'amapiano', 'mix', 'party'],
    mood: 'hype',
    region: 'NG',
    oyeScore: 999999999,
    createdAt: '2024-12-08',
  },
  {
    id: '1',
    title: 'UNAVAILABLE',
    artist: 'Davido ft. Musa Keys',
    album: 'Timeless',
    trackId: 'OSBan_sH_b8',
    coverUrl: getThumbnailUrl('OSBan_sH_b8'),
    duration: 190,
    tags: ['afrobeats', 'amapiano', 'party'],
    mood: 'hype',
    region: 'NG',
    oyeScore: 141223051,
    createdAt: '2024-01-15',
  },
  {
    id: '2',
    title: 'Calm Down',
    artist: 'Rema ft. Selena Gomez',
    album: 'Rave & Roses',
    trackId: 'WcIcVapfqXw',
    coverUrl: getThumbnailUrl('WcIcVapfqXw'),
    duration: 240,
    tags: ['afrobeats', 'pop', 'rnb'],
    mood: 'rnb',
    region: 'NG',
    oyeScore: 1267074719,
    createdAt: '2022-08-25',
  },
  {
    id: '3',
    title: 'City Boys',
    artist: 'Burna Boy',
    album: 'I Told Them...',
    trackId: 'hLDQ88vAhIs',
    coverUrl: getThumbnailUrl('hLDQ88vAhIs'),
    duration: 154,
    tags: ['afrobeats', 'street', 'hype'],
    mood: 'hype',
    region: 'NG',
    oyeScore: 104335746,
    createdAt: '2023-08-25',
  },
  {
    id: '4',
    title: 'Rush',
    artist: 'Ayra Starr',
    album: '19 & Dangerous',
    trackId: 'crtQSTYWtqE',
    coverUrl: getThumbnailUrl('crtQSTYWtqE'),
    duration: 186,
    tags: ['afrobeats', 'pop', 'dance'],
    mood: 'dance',
    region: 'NG',
    oyeScore: 513773557,
    createdAt: '2023-06-20',
  },
  {
    id: '5',
    title: 'Joha',
    artist: 'Asake',
    album: 'Work of Art',
    trackId: 'fXl5dPuiJa0',
    coverUrl: getThumbnailUrl('fXl5dPuiJa0'),
    duration: 153,
    tags: ['afrobeats', 'amapiano', 'party'],
    mood: 'hype',
    region: 'NG',
    oyeScore: 42280341,
    createdAt: '2023-09-15',
  },
  {
    id: '6',
    title: 'Essence',
    artist: 'Wizkid ft. Tems',
    album: 'Made in Lagos',
    trackId: 'jipQpjUA_o8',
    coverUrl: getThumbnailUrl('jipQpjUA_o8'),
    duration: 246,
    tags: ['afrobeats', 'rnb', 'chill'],
    mood: 'chill',
    region: 'NG',
    oyeScore: 236664390,
    createdAt: '2020-10-30',
  },
  {
    id: '7',
    title: 'Commas',
    artist: 'Ayra Starr',
    album: 'The Year I Turned 21',
    trackId: 'EhyzYPSHRQU',
    coverUrl: getThumbnailUrl('EhyzYPSHRQU'),
    duration: 157,
    tags: ['afrobeats', 'pop'],
    mood: 'afro',
    region: 'NG',
    oyeScore: 172897365,
    createdAt: '2024-08-14',
  },
  {
    id: '8',
    title: 'Last Last',
    artist: 'Burna Boy',
    album: 'Love, Damini',
    trackId: '421w1j87fEM',
    coverUrl: getThumbnailUrl('421w1j87fEM'),
    duration: 185,
    tags: ['afrobeats', 'heartbreak', 'party'],
    mood: 'heartbreak',
    region: 'NG',
    oyeScore: 95000000,
    createdAt: '2022-05-13',
  },
  {
    id: '9',
    title: 'Water',
    artist: 'Tyla',
    album: 'TYLA',
    trackId: 'XoiOOiuH8iI',
    coverUrl: getThumbnailUrl('XoiOOiuH8iI'),
    duration: 193,
    tags: ['amapiano', 'rnb', 'dance'],
    mood: 'dance',
    region: 'ZA',
    oyeScore: 200000000,
    createdAt: '2023-07-28',
  },
  {
    id: '10',
    title: 'Love Nwantiti (Remix)',
    artist: 'CKay ft. Joeboy & Kuami Eugene',
    album: 'CKay the First',
    trackId: 'D-YDEyuDxWU',
    coverUrl: getThumbnailUrl('D-YDEyuDxWU'),
    duration: 217,
    tags: ['afrobeats', 'rnb', 'chill'],
    mood: 'rnb',
    region: 'NG',
    oyeScore: 300000000,
    createdAt: '2021-07-26',
  },
  // MORE BANGERS - Dec 2025
  {
    id: '11',
    title: 'Ngozi',
    artist: 'Crayon & Ayra Starr',
    album: 'Ngozi',
    trackId: 'bzsSkarE4zw',
    coverUrl: getThumbnailUrl('bzsSkarE4zw'),
    duration: 180,
    tags: ['afrobeats', 'amapiano', 'party'],
    mood: 'hype',
    region: 'NG',
    oyeScore: 45000000,
    createdAt: '2024-08-01',
  },
  {
    id: '12',
    title: 'Terminator',
    artist: 'Asake & Olamide',
    album: 'Mr Money With The Vibe',
    trackId: 'qrIP_igi76U',
    coverUrl: getThumbnailUrl('qrIP_igi76U'),
    duration: 198,
    tags: ['afrobeats', 'street', 'party'],
    mood: 'hype',
    region: 'NG',
    oyeScore: 89000000,
    createdAt: '2022-09-08',
  },
  {
    id: '13',
    title: 'Peru',
    artist: 'Fireboy DML',
    album: 'Playboy',
    trackId: 'pekzpzNCNDQ',
    coverUrl: getThumbnailUrl('pekzpzNCNDQ'),
    duration: 195,
    tags: ['afrobeats', 'pop', 'party'],
    mood: 'afro',
    region: 'NG',
    oyeScore: 210000000,
    createdAt: '2021-07-20',
  },
  {
    id: '14',
    title: 'Kolomental',
    artist: 'Victony',
    album: 'Stubborn',
    trackId: 'DFDyUpU-0uY',
    coverUrl: getThumbnailUrl('DFDyUpU-0uY'),
    duration: 165,
    tags: ['afrobeats', 'amapiano'],
    mood: 'hype',
    region: 'NG',
    oyeScore: 35000000,
    createdAt: '2024-02-15',
  },
  {
    id: '15',
    title: 'Jaye Lo',
    artist: 'Logos Olori',
    album: 'Jaye Lo',
    trackId: '7ESXnD4KBXs',
    coverUrl: getThumbnailUrl('7ESXnD4KBXs'),
    duration: 172,
    tags: ['afrobeats', 'street', 'hype'],
    mood: 'hype',
    region: 'NG',
    oyeScore: 28000000,
    createdAt: '2024-03-10',
  },
  {
    id: '16',
    title: 'Mnike',
    artist: 'Tyler ICU & Tumelo.za ft. DJ Maphorisa',
    album: 'Mnike',
    trackId: 'g_hgm2Mf6Ag',
    coverUrl: getThumbnailUrl('g_hgm2Mf6Ag'),
    duration: 245,
    tags: ['amapiano', 'dance', 'party'],
    mood: 'dance',
    region: 'ZA',
    oyeScore: 180000000,
    createdAt: '2023-06-01',
  },
  {
    id: '17',
    title: 'Sability',
    artist: 'Ayra Starr',
    album: '19 & Dangerous',
    trackId: 'KYn3k8dpRJI',
    coverUrl: getThumbnailUrl('KYn3k8dpRJI'),
    duration: 178,
    tags: ['afrobeats', 'pop', 'chill'],
    mood: 'chill',
    region: 'NG',
    oyeScore: 95000000,
    createdAt: '2022-08-06',
  },
  {
    id: '18',
    title: 'Soweto Baby',
    artist: 'DJ Maphorisa & Wizkid ft. DJ Buckz',
    album: 'Soweto Baby',
    trackId: 'oaYJbNkIrNk',
    coverUrl: getThumbnailUrl('oaYJbNkIrNk'),
    duration: 285,
    tags: ['amapiano', 'afrobeats', 'party'],
    mood: 'hype',
    region: 'ZA',
    oyeScore: 120000000,
    createdAt: '2017-03-15',
  },
  {
    id: '19',
    title: 'Organise',
    artist: 'Asake',
    album: 'Mr Money With The Vibe',
    trackId: '_u4_iWCvZ5c',
    coverUrl: getThumbnailUrl('_u4_iWCvZ5c'),
    duration: 186,
    tags: ['afrobeats', 'amapiano', 'party'],
    mood: 'hype',
    region: 'NG',
    oyeScore: 72000000,
    createdAt: '2022-09-08',
  },
  {
    id: '20',
    title: 'Ye',
    artist: 'Burna Boy',
    album: 'Outside',
    trackId: 'lPe09eE6Xio',
    coverUrl: getThumbnailUrl('lPe09eE6Xio'),
    duration: 211,
    tags: ['afrobeats', 'chill', 'rnb'],
    mood: 'chill',
    region: 'NG',
    oyeScore: 250000000,
    createdAt: '2018-01-26',
  },
  {
    id: '21',
    title: 'Kilometre',
    artist: 'Burna Boy',
    album: 'Twice As Tall',
    trackId: 'eKv5CBr-kKo',
    coverUrl: getThumbnailUrl('eKv5CBr-kKo'),
    duration: 234,
    tags: ['afrobeats', 'party', 'hype'],
    mood: 'hype',
    region: 'NG',
    oyeScore: 88000000,
    createdAt: '2021-05-14',
  },
  {
    id: '22',
    title: 'Joro',
    artist: 'Wizkid',
    album: 'Made In Lagos',
    trackId: 'FCUk7rIBBAE',
    coverUrl: getThumbnailUrl('FCUk7rIBBAE'),
    duration: 208,
    tags: ['afrobeats', 'rnb', 'chill'],
    mood: 'chill',
    region: 'NG',
    oyeScore: 145000000,
    createdAt: '2019-09-05',
  },
  {
    id: '23',
    title: 'Gobe',
    artist: 'L.A.X ft. 2Baba',
    album: 'Gobe',
    trackId: 'uxch7uz3TeY',
    coverUrl: getThumbnailUrl('uxch7uz3TeY'),
    duration: 226,
    tags: ['afrobeats', 'classic', 'party'],
    mood: 'afro',
    region: 'NG',
    oyeScore: 55000000,
    createdAt: '2013-05-20',
  },
  {
    id: '24',
    title: 'Kolo (Kolomental II)',
    artist: 'Victony',
    album: 'Stubborn',
    trackId: 'r3qRpPErqsU',
    coverUrl: getThumbnailUrl('r3qRpPErqsU'),
    duration: 167,
    tags: ['afrobeats', 'amapiano', 'hype'],
    mood: 'hype',
    region: 'NG',
    oyeScore: 42000000,
    createdAt: '2024-06-15',
  },
  {
    id: '25',
    title: '49-99',
    artist: 'Tiwa Savage',
    album: 'Celia',
    trackId: 'IOoNEi8BlgM',
    coverUrl: getThumbnailUrl('IOoNEi8BlgM'),
    duration: 195,
    tags: ['afrobeats', 'rnb', 'chill'],
    mood: 'afro',
    region: 'NG',
    oyeScore: 38000000,
    createdAt: '2019-09-05',
  },
  // ============================================
  // PODCASTS / TALKS
  // ============================================
  {
    id: 'podcast-1',
    title: 'The Universal S',
    artist: 'LEMMiNO',
    album: 'VOYO Podcasts',
    trackId: 'RQdxHi4_Pvc',
    coverUrl: getThumbnailUrl('RQdxHi4_Pvc'),
    duration: 1128,
    tags: ['podcast', 'documentary', 'mystery', 'design'],
    mood: 'chill',
    region: 'GLOBAL',
    oyeScore: 1000,
    createdAt: '2024-12-25',
  },
];

// ============================================
// PLAYLISTS
// ============================================

export const PLAYLISTS: Playlist[] = [
  {
    id: 'pl1',
    title: 'Afro Bangers 2024',
    coverUrl: getThumbnailUrl('OSBan_sH_b8'),  // UNAVAILABLE track
    trackIds: ['1', '2', '3', '7', '10'],
    type: 'CURATED',
    mood: 'afro',
    createdAt: '2024-01-01',
  },
  {
    id: 'pl2',
    title: 'Amapiano Vibes',
    coverUrl: getThumbnailUrl('XoiOOiuH8iI'),  // Water by Tyla
    trackIds: ['6', '9'],
    type: 'CURATED',
    mood: 'dance',
    createdAt: '2024-01-05',
  },
  {
    id: 'pl3',
    title: 'Late Night Feels',
    coverUrl: getThumbnailUrl('jipQpjUA_o8'),  // Essence
    trackIds: ['4', '5', '8', '10'],
    type: 'CURATED',
    mood: 'chill',
    createdAt: '2024-01-10',
  },
];

// ============================================
// DEFAULT REACTIONS (DA Language Pack)
// ============================================

export const DEFAULT_REACTIONS = [
  { type: 'oyo', text: 'OYO', emoji: '👋' },
  { type: 'oye', text: 'OYÉÉ', emoji: '🔥' },
  { type: 'wazzguan', text: 'Wazzguán!', emoji: '✨' },
  { type: 'yoooo', text: 'Yooooo!', emoji: '🚀' },
  { type: 'mad_oh', text: 'Mad oh!', emoji: '🤯' },
  { type: 'eyyy', text: 'Eyyy!', emoji: '💫' },
  { type: 'fire', text: '🔥🔥🔥', emoji: '🔥' },
  { type: 'we_move', text: 'WE MOVE!', emoji: '💪' },
] as const;

// ============================================
// HELPER FUNCTIONS
// ============================================

export const getTrackById = (id: string): Track | undefined => {
  return TRACKS.find((t) => t.id === id);
};

export const getTracksByMood = (mood: string): Track[] => {
  return TRACKS.filter((t) => t.mood === mood);
};

export const getTracksByTag = (tag: string): Track[] => {
  return TRACKS.filter((t) => t.tags.includes(tag));
};

export const getRandomTracks = (count: number): Track[] => {
  const shuffled = [...TRACKS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
};

export const getHotTracks = (): Track[] => {
  return [...TRACKS].sort((a, b) => b.oyeScore - a.oyeScore).slice(0, 5);
};

export const getDiscoverTracks = (excludeIds: string[]): Track[] => {
  return TRACKS.filter((t) => !excludeIds.includes(t.id))
    .sort(() => Math.random() - 0.5)
    .slice(0, 5);
};

// ============================================
// SMART DISCOVERY - Adaptive Recommendations
// ============================================

/**
 * Get tracks by artist
 */
export const getTracksByArtist = (artist: string): Track[] => {
  return TRACKS.filter((t) => t.artist.toLowerCase() === artist.toLowerCase());
};

/**
 * Get tracks by multiple tags (OR logic - matches any tag)
 */
export const getTracksByTags = (tags: string[]): Track[] => {
  if (!tags || tags.length === 0) return [];
  const lowerTags = tags.map((t) => t.toLowerCase());
  return TRACKS.filter((track) =>
    track.tags.some((tag) => lowerTags.includes(tag.toLowerCase()))
  );
};

/**
 * Smart scoring algorithm for track similarity
 * Returns tracks sorted by relevance to the reference track
 */
export const getRelatedTracks = (track: Track, limit: number = 5, excludeIds: string[] = []): Track[] => {
  if (!track) return getRandomTracks(limit);

  // Score each track based on similarity
  const scored = TRACKS.filter((t) => t.id !== track.id && !excludeIds.includes(t.id))
    .map((t) => {
      let score = 0;

      // +50 points: Same artist (strongest signal)
      if (t.artist.toLowerCase() === track.artist.toLowerCase()) {
        score += 50;
      }

      // +30 points: Same mood
      if (t.mood && track.mood && t.mood === track.mood) {
        score += 30;
      }

      // +10 points per matching tag
      const matchingTags = t.tags.filter((tag) =>
        track.tags.map((t) => t.toLowerCase()).includes(tag.toLowerCase())
      );
      score += matchingTags.length * 10;

      // +5 points: Same region
      if (t.region && track.region && t.region === track.region) {
        score += 5;
      }

      // Bonus: Popular tracks get slight boost (oyeScore / 1M)
      score += t.oyeScore / 1000000;

      return { track: t, score };
    });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // If we have enough high-scoring tracks (score > 20), use them
  const highScorers = scored.filter((s) => s.score > 20);
  if (highScorers.length >= limit) {
    return highScorers.slice(0, limit).map((s) => s.track);
  }

  // Otherwise mix high scorers with hot tracks to fill the gap
  const needed = limit - highScorers.length;
  const hotTracks = getHotTracks().filter(
    (t) => t.id !== track.id &&
    !excludeIds.includes(t.id) &&
    !highScorers.some((s) => s.track.id === t.id)
  );

  return [
    ...highScorers.map((s) => s.track),
    ...hotTracks.slice(0, needed),
  ].slice(0, limit);
};

// ============================================
// PIPED ALBUM INTEGRATION
// ============================================

import type { PipedTrack } from '../services/piped';
import { encodeVoyoId } from '../utils/voyoId';

/**
 * Convert Piped track to VOYO Track format
 * Used when playing albums from YouTube playlists
 */
export function pipedTrackToVoyoTrack(pipedTrack: PipedTrack, albumName?: string): Track {
  // Generate VOYO ID from YouTube ID
  const voyoId = encodeVoyoId(pipedTrack.videoId);

  return {
    id: `piped_${pipedTrack.videoId}`,
    title: pipedTrack.title,
    artist: pipedTrack.artist,
    album: albumName || 'Unknown Album',
    trackId: voyoId, // Use encoded VOYO ID for consistency
    coverUrl: pipedTrack.thumbnail || getThumbnailUrl(pipedTrack.videoId),
    duration: pipedTrack.duration,
    tags: inferTagsFromTitle(pipedTrack.title, pipedTrack.artist),
    mood: inferMoodFromTags(pipedTrack.title),
    region: inferRegionFromArtist(pipedTrack.artist),
    oyeScore: 0, // New tracks start at 0
    createdAt: new Date().toISOString(),
  };
}

/**
 * Infer tags from track title and artist
 */
function inferTagsFromTitle(title: string, artist: string): string[] {
  const tags: string[] = [];
  const lowerTitle = title.toLowerCase();
  const lowerArtist = artist.toLowerCase();

  // Genre indicators
  if (lowerTitle.includes('afrobeat') || lowerArtist.includes('burna') || lowerArtist.includes('wizkid')) {
    tags.push('afrobeats');
  }
  if (lowerTitle.includes('amapiano') || lowerTitle.includes('piano')) {
    tags.push('amapiano');
  }
  if (lowerTitle.includes('dancehall') || lowerTitle.includes('reggae')) {
    tags.push('dancehall');
  }
  if (lowerTitle.includes('rnb') || lowerTitle.includes('r&b')) {
    tags.push('rnb');
  }
  if (lowerTitle.includes('hip hop') || lowerTitle.includes('rap')) {
    tags.push('hiphop');
  }

  // Mood indicators
  if (lowerTitle.includes('love') || lowerTitle.includes('heart')) {
    tags.push('love');
  }
  if (lowerTitle.includes('party') || lowerTitle.includes('club')) {
    tags.push('party');
  }
  if (lowerTitle.includes('chill') || lowerTitle.includes('relax')) {
    tags.push('chill');
  }

  // Default to afrobeats if no genre found
  if (tags.length === 0) {
    tags.push('afrobeats');
  }

  return tags;
}

/**
 * Infer mood from title
 */
function inferMoodFromTags(title: string): Track['mood'] {
  const lower = title.toLowerCase();

  if (lower.includes('party') || lower.includes('dance') || lower.includes('club')) {
    return 'party';
  }
  if (lower.includes('chill') || lower.includes('relax') || lower.includes('smooth')) {
    return 'chill';
  }
  if (lower.includes('love') || lower.includes('heart') || lower.includes('feel')) {
    return 'heartbreak';
  }
  if (lower.includes('hype') || lower.includes('energy') || lower.includes('fire')) {
    return 'hype';
  }

  // Default to afro for African music
  return 'afro';
}

/**
 * Infer region from artist name
 */
function inferRegionFromArtist(artist: string): string | undefined {
  const lower = artist.toLowerCase();

  // Nigerian artists
  if (lower.includes('burna') || lower.includes('wizkid') || lower.includes('davido') ||
      lower.includes('rema') || lower.includes('tems') || lower.includes('asake')) {
    return 'NG';
  }

  // South African artists
  if (lower.includes('kabza') || lower.includes('dj maphorisa') || lower.includes('focalistic')) {
    return 'ZA';
  }

  // Ghanaian artists
  if (lower.includes('stonebwoy') || lower.includes('shatta') || lower.includes('sarkodie')) {
    return 'GH';
  }

  return undefined;
}

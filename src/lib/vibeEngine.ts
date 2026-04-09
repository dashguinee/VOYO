/**
 * VOYO VIBE ENGINE v1.0
 *
 * The soul of the DJ. Transforms 72 vibes into smart queries.
 * "Music is memory. Music is medicine. Music is movement."
 *
 * Built by ZION SYNAPSE for DASH
 */

import { supabase, isSupabaseConfigured } from './supabase';

// ============================================
// VIBE TYPES
// ============================================

export type VibeCategory = 'regional' | 'mood' | 'activity' | 'era' | 'genre' | 'cultural';

export interface Vibe {
  id: string;
  name: string;
  description: string;
  category: VibeCategory;
  energy_level: number;  // 1-5
  query_rules: VibeQueryRules;
  connected_vibes: string[];
}

export interface VibeQueryRules {
  // Tier filtering
  min_tier?: 'A' | 'B' | 'C' | 'D';
  prefer_tiers?: ('A' | 'B' | 'C' | 'D')[];

  // Era filtering
  eras?: string[];

  // Region/country
  regions?: string[];
  countries?: string[];

  // Cultural/aesthetic tags
  cultural_tags?: string[];
  aesthetic_tags?: string[];

  // Matched artist patterns
  matched_artist_patterns?: string[];

  // Title patterns (for unmatched tracks)
  title_patterns?: string[];

  // Sort preferences
  sort_by?: 'play_count' | 'random' | 'canon_level' | 'recent';
}

export interface VibeTrack {
  youtube_id: string;
  title: string;
  artist: string;
  thumbnail_url: string;
  artist_tier: string | null;
  matched_artist: string | null;
  era: string | null;
}

// ============================================
// VIBE DEFINITIONS (Compact for runtime)
// ============================================

export const VIBES: Record<string, Vibe> = {
  // ========== REGIONAL VIBES ==========

  'conakry-nights': {
    id: 'conakry-nights',
    name: 'Conakry Nights',
    description: 'The electric energy of Conakry after dark',
    category: 'regional',
    energy_level: 4,
    query_rules: {
      countries: ['GN'],
      regions: ['west-africa'],
      matched_artist_patterns: ['mory', 'sekouba', 'balla', 'bembeya'],
      title_patterns: ['guinee', 'guinea', 'conakry'],
      sort_by: 'play_count'
    },
    connected_vibes: ['kaloum-memories', 'maquis-vibes', 'after-midnight']
  },

  'kaloum-memories': {
    id: 'kaloum-memories',
    name: 'Kaloum Memories',
    description: 'The golden era sound of Guineas heart',
    category: 'regional',
    energy_level: 3,
    query_rules: {
      countries: ['GN'],
      eras: ['1970s', '1980s', '1990s', 'pre-1990'],
      matched_artist_patterns: ['bembeya', 'balla', 'keletigui'],
      prefer_tiers: ['A', 'B'],
      sort_by: 'canon_level'
    },
    connected_vibes: ['conakry-nights', 'golden-era', 'african-pride']
  },

  'guinea-romance': {
    id: 'guinea-romance',
    name: 'Guinea Romance',
    description: 'Love songs in Susu, Malinke, and Pular',
    category: 'regional',
    energy_level: 2,
    query_rules: {
      countries: ['GN'],
      title_patterns: ['amour', 'love', 'mariage', 'woman'],
      aesthetic_tags: ['romantic', 'tender'],
      sort_by: 'play_count'
    },
    connected_vibes: ['first-love', 'slow-wine', 'african-love-letters']
  },

  'lagos-nights': {
    id: 'lagos-nights',
    name: 'Lagos Nights',
    description: 'When the sun sets on Eko, the real city wakes up',
    category: 'regional',
    energy_level: 5,
    query_rules: {
      countries: ['NG'],
      prefer_tiers: ['A', 'B'],
      eras: ['2010s', '2020s'],
      matched_artist_patterns: ['burna', 'wizkid', 'davido', 'asake', 'rema', 'ayra'],
      sort_by: 'play_count'
    },
    connected_vibes: ['naija-party', 'afrobeats-central', 'club-banger']
  },

  'naija-party': {
    id: 'naija-party',
    name: 'Naija Party',
    description: 'Owambe energy in audio form',
    category: 'regional',
    energy_level: 5,
    query_rules: {
      countries: ['NG'],
      prefer_tiers: ['A', 'B'],
      title_patterns: ['party', 'dance', 'celebration', 'turn up'],
      cultural_tags: ['celebration', 'party'],
      sort_by: 'play_count'
    },
    connected_vibes: ['lagos-nights', 'wedding-vibes', 'african-festival']
  },

  'accra-highlife': {
    id: 'accra-highlife',
    name: 'Accra Highlife',
    description: 'The original African pop music',
    category: 'regional',
    energy_level: 3,
    query_rules: {
      countries: ['GH'],
      matched_artist_patterns: ['sarkodie', 'stonebwoy', 'black sherif', 'shatta'],
      aesthetic_tags: ['classic', 'jazzy'],
      sort_by: 'play_count'
    },
    connected_vibes: ['ghana-groove', 'west-african-classics']
  },

  'johannesburg-heat': {
    id: 'johannesburg-heat',
    name: 'Johannesburg Heat',
    description: 'Amapiano and SA House at its finest',
    category: 'regional',
    energy_level: 4,
    query_rules: {
      countries: ['ZA'],
      regions: ['south-africa'],
      matched_artist_patterns: ['kabza', 'maphorisa', 'tyla', 'black coffee'],
      title_patterns: ['amapiano', 'piano'],
      prefer_tiers: ['A', 'B'],
      sort_by: 'play_count'
    },
    connected_vibes: ['amapiano-movement', 'late-night', 'club-banger']
  },

  // ========== MOOD VIBES ==========

  'chill-vibes': {
    id: 'chill-vibes',
    name: 'Chill Vibes',
    description: 'Laid back, relaxed, smooth',
    category: 'mood',
    energy_level: 2,
    query_rules: {
      aesthetic_tags: ['smooth', 'mellow', 'relaxed'],
      matched_artist_patterns: ['asa', 'simi', 'tems', 'omah'],
      sort_by: 'random'
    },
    connected_vibes: ['late-night', 'bedroom-vibes', 'slow-wine']
  },

  'afro-heat': {
    id: 'afro-heat',
    name: 'Afro Heat',
    description: 'High energy African bangers',
    category: 'mood',
    energy_level: 5,
    query_rules: {
      prefer_tiers: ['A', 'B'],
      eras: ['2020s', '2010s'],
      sort_by: 'play_count'
    },
    connected_vibes: ['lagos-nights', 'naija-party', 'workout']
  },

  'late-night': {
    id: 'late-night',
    name: 'Late Night',
    description: 'After midnight mood',
    category: 'mood',
    energy_level: 3,
    query_rules: {
      aesthetic_tags: ['smooth', 'intimate'],
      title_patterns: ['night', 'midnight', 'late'],
      sort_by: 'random'
    },
    connected_vibes: ['chill-vibes', 'bedroom-vibes', 'slow-wine']
  },

  'workout': {
    id: 'workout',
    name: 'Workout',
    description: 'Energy to push through',
    category: 'mood',
    energy_level: 5,
    query_rules: {
      prefer_tiers: ['A', 'B'],
      title_patterns: ['run', 'go', 'up', 'energy'],
      sort_by: 'play_count'
    },
    connected_vibes: ['afro-heat', 'naija-party', 'club-banger']
  },

  // ========== ERA VIBES ==========

  'golden-era': {
    id: 'golden-era',
    name: 'Golden Era',
    description: 'Classic African music from the golden age',
    category: 'era',
    energy_level: 3,
    query_rules: {
      eras: ['1970s', '1980s', '1990s', 'pre-1990'],
      prefer_tiers: ['A', 'B'],
      sort_by: 'canon_level'
    },
    connected_vibes: ['kaloum-memories', 'naija-old-school', 'throwback']
  },

  'throwback': {
    id: 'throwback',
    name: 'Throwback Thursday',
    description: '2000s and early 2010s hits',
    category: 'era',
    energy_level: 4,
    query_rules: {
      eras: ['2000s', '2010s'],
      prefer_tiers: ['A', 'B'],
      sort_by: 'play_count'
    },
    connected_vibes: ['golden-era', 'naija-old-school', 'nostalgia']
  },

  'new-wave': {
    id: 'new-wave',
    name: 'New Wave',
    description: 'The latest and freshest sounds',
    category: 'era',
    energy_level: 4,
    query_rules: {
      eras: ['2020s'],
      prefer_tiers: ['A', 'B', 'C'],
      sort_by: 'recent'
    },
    connected_vibes: ['afrobeats-central', 'lagos-nights', 'trending']
  },

  // ========== ACTIVITY VIBES ==========

  'party-mode': {
    id: 'party-mode',
    name: 'Party Mode',
    description: 'Maximum celebration energy',
    category: 'activity',
    energy_level: 5,
    query_rules: {
      prefer_tiers: ['A', 'B'],
      cultural_tags: ['celebration', 'party', 'festival'],
      sort_by: 'play_count'
    },
    connected_vibes: ['naija-party', 'club-banger', 'wedding-vibes']
  },

  'study-flow': {
    id: 'study-flow',
    name: 'Study Flow',
    description: 'Focus-friendly instrumentals and chill tracks',
    category: 'activity',
    energy_level: 2,
    query_rules: {
      aesthetic_tags: ['smooth', 'instrumental', 'mellow'],
      sort_by: 'random'
    },
    connected_vibes: ['chill-vibes', 'late-night', 'focus']
  },

  'morning-rise': {
    id: 'morning-rise',
    name: 'Morning Rise',
    description: 'Start your day right',
    category: 'activity',
    energy_level: 3,
    query_rules: {
      aesthetic_tags: ['uplifting', 'positive'],
      title_patterns: ['morning', 'day', 'sun', 'rise'],
      sort_by: 'random'
    },
    connected_vibes: ['african-gospel', 'spiritual-awakening', 'gratitude']
  },

  // ========== CULTURAL VIBES ==========

  'motherland-roots': {
    id: 'motherland-roots',
    name: 'Motherland Roots',
    description: 'Deep traditional African sounds',
    category: 'cultural',
    energy_level: 3,
    query_rules: {
      cultural_tags: ['tradition', 'roots', 'motherland', 'heritage'],
      prefer_tiers: ['A', 'B'],
      sort_by: 'canon_level'
    },
    connected_vibes: ['golden-era', 'kaloum-memories', 'african-pride']
  },

  'diaspora-connection': {
    id: 'diaspora-connection',
    name: 'Diaspora Connection',
    description: 'Bridging Africa and the diaspora',
    category: 'cultural',
    energy_level: 4,
    query_rules: {
      cultural_tags: ['diaspora', 'bridge', 'homecoming'],
      matched_artist_patterns: ['burna', 'tems', 'wizkid'],
      sort_by: 'play_count'
    },
    connected_vibes: ['afrobeats-central', 'lagos-nights', 'global-african']
  },

  'african-gospel': {
    id: 'african-gospel',
    name: 'African Gospel',
    description: 'Spiritual upliftment and praise',
    category: 'cultural',
    energy_level: 3,
    query_rules: {
      cultural_tags: ['spiritual', 'gospel', 'worship'],
      title_patterns: ['god', 'lord', 'praise', 'worship', 'hallelujah'],
      sort_by: 'play_count'
    },
    connected_vibes: ['spiritual-awakening', 'sunday-morning', 'gratitude']
  }
};

// ============================================
// VIBE QUERY ENGINE
// ============================================

export const vibeEngine = {
  /**
   * Get all available vibes
   */
  getAllVibes(): Vibe[] {
    return Object.values(VIBES);
  },

  /**
   * Get vibes by category
   */
  getVibesByCategory(category: VibeCategory): Vibe[] {
    return Object.values(VIBES).filter(v => v.category === category);
  },

  /**
   * Get a specific vibe
   */
  getVibe(vibeId: string): Vibe | null {
    return VIBES[vibeId] || null;
  },

  /**
   * Get connected vibes (for exploration)
   */
  getConnectedVibes(vibeId: string): Vibe[] {
    const vibe = VIBES[vibeId];
    if (!vibe) return [];

    return vibe.connected_vibes
      .map(id => VIBES[id])
      .filter(Boolean);
  },

  /**
   * Query tracks for a vibe - THE CORE FUNCTION
   */
  async getTracksForVibe(vibeId: string, limit = 50): Promise<VibeTrack[]> {
    if (!isSupabaseConfigured || !supabase) {
      console.log('[VibeEngine] Supabase not configured');
      return [];
    }

    const vibe = VIBES[vibeId];
    if (!vibe) {
      console.log(`[VibeEngine] Unknown vibe: ${vibeId}`);
      return [];
    }

    const rules = vibe.query_rules;
    let query = supabase
      .from('video_intelligence')
      .select('youtube_id, title, artist, thumbnail_url, artist_tier, matched_artist, era');

    // Apply tier filter
    if (rules.prefer_tiers && rules.prefer_tiers.length > 0) {
      query = query.in('artist_tier', rules.prefer_tiers);
    } else if (rules.min_tier) {
      // Map tier to array of acceptable tiers
      const tierOrder = ['A', 'B', 'C', 'D'];
      const minIndex = tierOrder.indexOf(rules.min_tier);
      const acceptableTiers = tierOrder.slice(0, minIndex + 1);
      query = query.in('artist_tier', acceptableTiers);
    }

    // Apply era filter
    if (rules.eras && rules.eras.length > 0) {
      query = query.in('era', rules.eras);
    }

    // Apply sorting
    switch (rules.sort_by) {
      case 'play_count':
        query = query.order('play_count', { ascending: false, nullsFirst: false });
        break;
      case 'recent':
        query = query.order('first_seen', { ascending: false, nullsFirst: false });
        break;
      case 'canon_level':
        // Order by tier (A first)
        query = query.order('artist_tier', { ascending: true });
        break;
      case 'random':
      default:
        // We'll shuffle client-side for true randomness
        break;
    }

    query = query.limit(limit * 2); // Get extra for filtering

    const { data, error } = await query;

    if (error) {
      console.error(`[VibeEngine] Query error for ${vibeId}:`, error.message);
      return [];
    }

    let tracks = (data || []) as VibeTrack[];

    // Client-side filtering for pattern matching
    if (rules.matched_artist_patterns && rules.matched_artist_patterns.length > 0) {
      const patterns = rules.matched_artist_patterns.map(p => p.toLowerCase());
      tracks = tracks.filter(t => {
        const artist = (t.matched_artist || t.artist || '').toLowerCase();
        return patterns.some(p => artist.includes(p));
      });
    }

    if (rules.title_patterns && rules.title_patterns.length > 0) {
      const patterns = rules.title_patterns.map(p => p.toLowerCase());
      const patternFiltered = tracks.filter(t => {
        const title = (t.title || '').toLowerCase();
        return patterns.some(p => title.includes(p));
      });
      // Merge pattern-filtered with artist-filtered
      if (patternFiltered.length > 0) {
        const existingIds = new Set(tracks.map(t => t.youtube_id));
        for (const t of patternFiltered) {
          if (!existingIds.has(t.youtube_id)) {
            tracks.push(t);
          }
        }
      }
    }

    // Shuffle if random sort requested
    if (rules.sort_by === 'random') {
      tracks = shuffleArray(tracks);
    }

    // Limit to requested count
    return tracks.slice(0, limit);
  },

  /**
   * Get curated mix for a vibe (includes connected vibes)
   */
  async getCuratedMix(vibeId: string, limit = 100): Promise<VibeTrack[]> {
    const mainTracks = await this.getTracksForVibe(vibeId, Math.floor(limit * 0.6));

    // Get tracks from connected vibes
    const vibe = VIBES[vibeId];
    if (!vibe) return mainTracks;

    const connectedTracks: VibeTrack[] = [];
    for (const connectedId of vibe.connected_vibes.slice(0, 2)) {
      const tracks = await this.getTracksForVibe(connectedId, Math.floor(limit * 0.2));
      connectedTracks.push(...tracks);
    }

    // Merge and deduplicate
    const seen = new Set<string>();
    const merged: VibeTrack[] = [];

    for (const track of [...mainTracks, ...connectedTracks]) {
      if (!seen.has(track.youtube_id)) {
        seen.add(track.youtube_id);
        merged.push(track);
      }
    }

    return shuffleArray(merged).slice(0, limit);
  },

  /**
   * Discover vibes based on a track
   */
  suggestVibesForTrack(track: VibeTrack): string[] {
    const suggestions: string[] = [];
    const artist = (track.matched_artist || track.artist || '').toLowerCase();
    const title = (track.title || '').toLowerCase();
    const tier = track.artist_tier;
    const era = track.era;

    for (const [vibeId, vibe] of Object.entries(VIBES)) {
      const rules = vibe.query_rules;
      let score = 0;

      // Check artist patterns
      if (rules.matched_artist_patterns) {
        for (const pattern of rules.matched_artist_patterns) {
          if (artist.includes(pattern.toLowerCase())) {
            score += 3;
            break;
          }
        }
      }

      // Check title patterns
      if (rules.title_patterns) {
        for (const pattern of rules.title_patterns) {
          if (title.includes(pattern.toLowerCase())) {
            score += 2;
            break;
          }
        }
      }

      // Check era
      if (rules.eras && era && rules.eras.includes(era)) {
        score += 2;
      }

      // Check tier
      if (rules.prefer_tiers && tier && rules.prefer_tiers.includes(tier as any)) {
        score += 1;
      }

      if (score >= 2) {
        suggestions.push(vibeId);
      }
    }

    return suggestions.slice(0, 5);
  }
};

// ============================================
// UTILS
// ============================================

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export default vibeEngine;

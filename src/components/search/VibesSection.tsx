/**
 * VOYO Music - Vibes Section Component
 * Shows community vibes powered by vibeEngine
 * Queries enriched video_intelligence table with 122K+ tracks
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { devWarn } from '../../utils/logger';
import { Play, ChevronLeft, Music2, Zap } from 'lucide-react';
import { VoyoIcon } from '../ui/VoyoIcon';
import { usePlayerStore } from '../../store/playerStore';
import { app } from '../../services/oyo';
import { Track } from '../../types';
import { getThumb } from '../../utils/thumbnail';
import { vibeEngine, VIBES, Vibe as VibeDefinition, VibeTrack as EngineTrack } from '../../lib/vibeEngine';
import { useBackGuard } from '../../hooks/useBackGuard';

// Vibe category colors
const CATEGORY_COLORS: Record<string, string> = {
  regional: '#a78bfa',   // Violet-400
  mood: '#8b5cf6',       // Purple (brand)
  activity: '#7c3aed',   // Violet-600
  era: '#a78bfa',        // Violet-400
  cultural: '#c4b5fd',   // Violet-300
  genre: '#8b5cf6',      // Purple (brand)
};

// Energy level to color intensity
const ENERGY_COLORS: Record<number, string> = {
  1: '33',
  2: '44',
  3: '55',
  4: '66',
  5: '77',
};

interface VibeTrack {
  youtube_id: string;
  title: string;
  artist: string;
  thumbnail_url: string | null;
  artist_tier: string | null;
  matched_artist: string | null;
  era: string | null;
}

interface VibesSectionProps {
  query: string;
  isVisible: boolean;
}

// Get vibe color based on category
function getVibeColor(vibe: VibeDefinition): string {
  return CATEGORY_COLORS[vibe.category] || CATEGORY_COLORS.mood;
}

// African-vibe detection — matches name/description/category against the
// continent's music vocabulary. Used to apply the signature "diaspora gold +
// VOYO platform purple" overlay on those cards specifically.
const AFRICAN_PATTERN = /\b(afric|afro|afri|naija|amapiano|afrobeat|bongo|coup[eé]|kwaito|kompa|soukous|highlife|gqom|kuduro|gengeton|ndombolo|makossa|zouglou|raï|rai|mbalax|mande|sahel|maghreb|sw[aé]ngu|alt[eé])/i;
function isAfricanVibe(vibe: VibeDefinition): boolean {
  const text = `${vibe.name || ''} ${vibe.description || ''} ${vibe.category || ''}`;
  return AFRICAN_PATTERN.test(text);
}

// Layered overlay for African vibes — golden-bronze leading, platform purple
// as the second wash (card reads as "VOYO surface, not generic"), base
// category color as the closing hint. Diaspora-meets-platform handshake.
function getAfricanCardStyle(vibe: VibeDefinition) {
  const base = getVibeColor(vibe);
  return {
    background: [
      'linear-gradient(135deg,',
      'rgba(212, 175, 110, 0.22) 0%,',     // gold-bronze opening (warm, dominant)
      'rgba(232, 208, 158, 0.13) 32%,',    // pale-gold midtone — keeps it luminous
      'rgba(139, 92, 246, 0.10) 68%,',     // platform purple wash (subtle)
      `${base}12 100%`,                     // base color closing hint
      ')',
    ].join(' '),
    border: '1px solid rgba(212, 175, 110, 0.32)',
    boxShadow: 'inset 0 0 28px rgba(212, 175, 110, 0.07), inset 0 0 40px rgba(139, 92, 246, 0.05)',
  };
}

// Format energy level
function getEnergyBars(level: number): string {
  return '▪'.repeat(level) + '▫'.repeat(5 - level);
}

export const VibesSection = ({ query, isVisible }: VibesSectionProps) => {
  const [selectedVibe, setSelectedVibe] = useState<VibeDefinition | null>(null);
  const [vibeTracks, setVibeTracks] = useState<VibeTrack[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const addToQueue = usePlayerStore(s => s.addToQueue);

  // Back gesture peels the vibe detail view back to the grid.
  useBackGuard(!!selectedVibe, () => setSelectedVibe(null), 'vibe-detail');

  // Get all vibes from vibeEngine, filtered by query
  const vibes = useMemo(() => {
    const allVibes = vibeEngine.getAllVibes();

    if (!query || query.trim().length < 2) {
      return allVibes;
    }

    const q = query.toLowerCase();
    return allVibes.filter(v =>
      v.name.toLowerCase().includes(q) ||
      v.description.toLowerCase().includes(q) ||
      v.category.toLowerCase().includes(q)
    );
  }, [query]);

  // Group vibes by category
  const vibesByCategory = useMemo(() => {
    const grouped: Record<string, VibeDefinition[]> = {};
    for (const vibe of vibes) {
      if (!grouped[vibe.category]) {
        grouped[vibe.category] = [];
      }
      grouped[vibe.category].push(vibe);
    }
    return grouped;
  }, [vibes]);

  const categories = Object.keys(vibesByCategory);

  // Load tracks for a vibe using vibeEngine
  const handleVibeClick = useCallback(async (vibe: VibeDefinition) => {
    setSelectedVibe(vibe);
    setIsLoadingTracks(true);

    try {
      // Use vibeEngine to get tracks from enriched video_intelligence table
      const tracks = await vibeEngine.getTracksForVibe(vibe.id, 30);
      setVibeTracks(tracks as VibeTrack[]);
    } catch (error) {
      devWarn('Failed to load vibe tracks:', error);
      setVibeTracks([]);
    } finally {
      setIsLoadingTracks(false);
    }
  }, []);

  // Play entire vibe
  const handlePlayVibe = useCallback(async () => {
    if (vibeTracks.length === 0 || !selectedVibe) return;

    const tracks: Track[] = vibeTracks.map(t => ({
      id: t.youtube_id,
      title: t.title,
      artist: t.artist || t.matched_artist || 'Unknown Artist',
      album: selectedVibe.name,
      trackId: t.youtube_id,
      coverUrl: t.thumbnail_url || getThumb(t.youtube_id),
      tags: [selectedVibe.category, t.era || ''].filter(Boolean),
      mood: 'afro',
      region: 'NG',
      oyeScore: selectedVibe.energy_level * 20,
      duration: 0,
      createdAt: new Date().toISOString(),
    }));

    // Play first (registers with lanes via app.playTrack), queue rest
    app.playTrack(tracks[0], 'vibe');
    tracks.slice(1).forEach(track => app.addToQueue(track));
  }, [vibeTracks, selectedVibe, addToQueue]);

  // Play individual track
  const handleTrackClick = useCallback((track: VibeTrack) => {
    const voyoTrack: Track = {
      id: track.youtube_id,
      title: track.title,
      artist: track.artist || track.matched_artist || 'Unknown Artist',
      album: selectedVibe?.name || 'VOYO Vibes',
      trackId: track.youtube_id,
      coverUrl: track.thumbnail_url || getThumb(track.youtube_id),
      tags: [selectedVibe?.category || 'vibe', track.era || ''].filter(Boolean),
      mood: 'afro',
      region: 'NG',
      oyeScore: 0,
      duration: 0,
      createdAt: new Date().toISOString(),
    };
    app.playTrack(voyoTrack, 'vibe');
  }, [selectedVibe]);

  // Get tier badge color
  const getTierColor = (tier: string | null): string => {
    switch (tier) {
      case 'A': return '#a78bfa';  // Violet-400
      case 'B': return '#8b5cf6';  // Purple (brand)
      case 'C': return '#7c3aed';  // Violet-600
      case 'D': return '#6b7280';
      default: return '#6b7280';
    }
  };

  if (!isVisible) return null;

  return (
    <div className="space-y-4 py-4">
      {/* Header — VOYO 3D radio-vibes icon, glowing */}
      <div className="flex items-center gap-2 px-3">
        <VoyoIcon name="radio-vibes" size={22} glow />
        <h3 className="text-white text-base font-bold font-display tracking-tight"
            style={{ color: 'rgba(232,208,158,0.97)' }}>Vibes</h3>
        <span className="text-white/30 text-xs">{vibes.length} moods</span>
      </div>

      {/* Category Pills */}
      <div className="flex gap-2.5 overflow-x-auto pb-2 px-3 scrollbar-hide">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition-all ${
            activeCategory === null
              ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
              : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
          }`}
        >
          All
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition-all capitalize ${
              activeCategory === cat
                ? 'text-white border'
                : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
            }`}
            style={activeCategory === cat ? {
              background: `${CATEGORY_COLORS[cat]}33`,
              borderColor: `${CATEGORY_COLORS[cat]}66`,
              color: CATEGORY_COLORS[cat]
            } : {}}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Vibe Browser View */}
      
        {selectedVibe ? (
          // Vibe Detail View
          <div
            key="vibe-detail"
            className="space-y-4 px-2"
          >
            {/* Back button */}
            <button
              onClick={() => setSelectedVibe(null)}
              className="flex items-center gap-2 text-white/60 hover:text-white/90 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="text-xs">Back to vibes</span>
            </button>

            {/* Vibe Header */}
            <div
              className="p-4 rounded-xl relative overflow-hidden"
              style={{
                background: `linear-gradient(135deg, ${getVibeColor(selectedVibe)}33 0%, ${getVibeColor(selectedVibe)}11 100%)`,
                border: `1px solid ${getVibeColor(selectedVibe)}44`,
                }}
            >
              <div className="flex items-center gap-4">
                {/* Vibe Icon */}
                <div
                  className="w-16 h-16 rounded-xl flex items-center justify-center"
                  style={{ background: `${getVibeColor(selectedVibe)}44` }}
                >
                  <Music2 className="w-8 h-8" style={{ color: getVibeColor(selectedVibe) }} />
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="text-white/90 font-semibold text-lg truncate">
                    {selectedVibe.name}
                  </h4>
                  <p className="text-white/50 text-sm truncate">{selectedVibe.description}</p>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-white/40">
                    <span className="flex items-center gap-1 capitalize">
                      <Music2 className="w-3 h-3" />
                      {selectedVibe.category}
                    </span>
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      {getEnergyBars(selectedVibe.energy_level)}
                    </span>
                  </div>
                </div>

                <button
                  className="p-3 rounded-full transition-colors"
                  style={{ background: getVibeColor(selectedVibe) }}
                  onClick={handlePlayVibe}
                  disabled={isLoadingTracks || vibeTracks.length === 0}
                >
                  <Play className="w-5 h-5 text-white" fill="white" />
                </button>
              </div>
            </div>

            {/* Track List */}
            <div className="space-y-1">
              {isLoadingTracks ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-2 rounded-lg animate-pulse"
                      style={{ background: 'rgba(255,255,255,0.03)' }}
                    >
                      <div className="w-10 h-10 rounded bg-white/5" />
                      <div className="flex-1">
                        <div className="h-3 w-3/4 bg-white/5 rounded mb-1" />
                        <div className="h-2 w-1/2 bg-white/5 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : vibeTracks.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-white/40 text-sm">No tracks match this vibe</p>
                  <p className="text-white/30 text-xs mt-1">Try a different vibe or add more music</p>
                </div>
              ) : (
                vibeTracks.map((track, index) => (
                  <div
                    key={track.youtube_id}
                    className="flex items-center gap-3 p-2 rounded-lg cursor-pointer group"
                    style={{ background: 'rgba(255,255,255,0.03)' }}
                    onClick={() => handleTrackClick(track)}
                  >
                    {/* Thumbnail */}
                    <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-white/5">
                      <img
                        src={track.thumbnail_url || getThumb(track.youtube_id)}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Track info */}
                    <div className="flex-1 min-w-0">
                      <h5 className="text-white/80 text-xs truncate">{track.title}</h5>
                      <p className="text-white/40 text-[10px] truncate">
                        {track.matched_artist || track.artist || 'Unknown Artist'}
                      </p>
                    </div>

                    {/* Tier Badge */}
                    {track.artist_tier && (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                        style={{
                          background: `${getTierColor(track.artist_tier)}22`,
                          color: getTierColor(track.artist_tier),
                          border: `1px solid ${getTierColor(track.artist_tier)}44`
                          }}
                      >
                        {track.artist_tier}
                      </span>
                    )}

                    {/* Era Badge */}
                    {track.era && (
                      <span className="text-[9px] text-white/30 px-1.5 py-0.5 rounded bg-white/5">
                        {track.era}
                      </span>
                    )}

                    {/* Play on hover */}
                    <div
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Play className="w-4 h-4 text-white/60" />
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Connected Vibes */}
            {selectedVibe.connected_vibes.length > 0 && (
              <div className="pt-4 mt-2 border-t border-white/10">
                <p className="text-white/30 text-[10px] mb-3">Related Vibes</p>
                <div className="flex gap-2.5 flex-wrap">
                  {selectedVibe.connected_vibes.slice(0, 4).map(connectedId => {
                    const connected = VIBES[connectedId];
                    if (!connected) return null;
                    return (
                      <button
                        key={connectedId}
                        onClick={() => handleVibeClick(connected)}
                        className="px-2 py-1 rounded-full text-[10px] transition-all hover:scale-105"
                        style={{
                          background: `${getVibeColor(connected)}22`,
                          border: `1px solid ${getVibeColor(connected)}44`,
                          color: getVibeColor(connected)
                          }}
                      >
                        {connected.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          // Vibes Grid View
          <div
            key="vibes-grid"
            className="grid grid-cols-1 gap-3 px-2"
          >
            {vibes.length === 0 && (
              <div className="text-center py-4">
                <p className="text-white/40 text-xs">No vibes found</p>
              </div>
            )}

            {(activeCategory ? vibesByCategory[activeCategory] || [] : vibes).map((vibe, index) => (
              <div
                key={vibe.id}
                className="relative cursor-pointer group"
                onClick={() => handleVibeClick(vibe)}
              >
                <div
                  className="flex items-center gap-3 p-3 rounded-xl transition-all hover:scale-[1.01]"
                  style={
                    isAfricanVibe(vibe)
                      ? getAfricanCardStyle(vibe)
                      : {
                          background: `linear-gradient(135deg, ${getVibeColor(vibe)}22 0%, ${getVibeColor(vibe)}08 100%)`,
                          border: `1px solid ${getVibeColor(vibe)}33`,
                        }
                  }
                >
                  {/* Vibe Icon — African vibes get the bronze-gold backdrop +
                      VOYO 3D vinyl-disc icon. Other vibes keep the lucide
                      Music2 in their category color (lighter visual weight). */}
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={
                      isAfricanVibe(vibe)
                        ? {
                            background: 'linear-gradient(135deg, rgba(212,175,110,0.30) 0%, rgba(232,208,158,0.18) 60%, rgba(139,92,246,0.18) 100%)',
                            border: '1px solid rgba(212,175,110,0.30)',
                            boxShadow: '0 0 14px rgba(212,175,110,0.18), inset 0 0 8px rgba(139,92,246,0.10)',
                          }
                        : { background: `${getVibeColor(vibe)}33` }
                    }
                  >
                    {isAfricanVibe(vibe) ? (
                      <VoyoIcon name="vinyl-disc" size={36} />
                    ) : (
                      <Music2 className="w-6 h-6" style={{ color: getVibeColor(vibe) }} />
                    )}
                  </div>

                  {/* Vibe Info — Space Grotesk display, weight bumped from
                      medium to bold, and pulled to bright white so multi-word
                      names like "African Heat" actually read on the dark card. */}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white text-[15px] font-bold tracking-tight truncate font-display"
                        style={{ letterSpacing: '-0.005em' }}>
                      {vibe.name}
                    </h4>
                    <p className="text-white/55 text-[11px] truncate mt-0.5">{vibe.description}</p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-white/40">
                      <span className="capitalize font-medium">{vibe.category}</span>
                      <span className="text-white/20">•</span>
                      <span>{getEnergyBars(vibe.energy_level)}</span>
                    </div>
                  </div>

                  {/* Play button on hover */}
                  <div
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ background: getVibeColor(vibe) }}
                    >
                      <Play className="w-4 h-4 text-white" fill="white" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      
    </div>
  );
};

export default VibesSection;

/**
 * ArtistPage - Full-screen artist profile overlay
 *
 * Shows artist avatar, metadata, library tracks, moments,
 * and a "Discover More" YouTube search section.
 *
 * Mobile-first, dark theme, inline CSS-in-JS styles.
 */

import { useState } from 'react';
import { X, ArrowLeft, Play, Search, Loader2, Music2, ExternalLink } from 'lucide-react';
import { VoyoCloseX } from '../ui/VoyoCloseX';
import { useArtist, ArtistTrack, ArtistMoment } from '../../hooks/useArtist';
import { useBackGuard } from '../../hooks/useBackGuard';
import { formatTime as formatDuration } from '../../utils/format';

// ============================================
// TYPES
// ============================================

interface ArtistPageProps {
  artistName: string;
  onClose: () => void;
  onPlayTrack: (trackId: string, title: string, artist: string) => void;
}

// ============================================
// CONSTANTS
// ============================================

const COUNTRY_FLAGS: Record<string, string> = {
  NG: '\u{1F1F3}\u{1F1EC}',
  GH: '\u{1F1EC}\u{1F1ED}',
  KE: '\u{1F1F0}\u{1F1EA}',
  ZA: '\u{1F1FF}\u{1F1E6}',
  SN: '\u{1F1F8}\u{1F1F3}',
  DZ: '\u{1F1E9}\u{1F1FF}',
  GN: '\u{1F1EC}\u{1F1F3}',
  CI: '\u{1F1E8}\u{1F1EE}',
  CD: '\u{1F1E8}\u{1F1E9}',
  CM: '\u{1F1E8}\u{1F1F2}',
  TZ: '\u{1F1F9}\u{1F1FF}',
  GB: '\u{1F1EC}\u{1F1E7}',
  US: '\u{1F1FA}\u{1F1F8}',
  FR: '\u{1F1EB}\u{1F1F7}',
  JM: '\u{1F1EF}\u{1F1F2}',
};

const REGION_GRADIENTS: Record<string, string> = {
  'west-africa': 'linear-gradient(135deg, #e8b230, #d4770a)',
  'east-africa': 'linear-gradient(135deg, #4a9e4a, #2d7d2d)',
  'southern-africa': 'linear-gradient(135deg, #cc4444, #993333)',
  'diaspora': 'linear-gradient(135deg, #7b68ee, #5b4ecc)',
};

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #555, #333)';

// Country code to readable name
const COUNTRY_NAMES: Record<string, string> = {
  NG: 'Nigeria',
  GH: 'Ghana',
  KE: 'Kenya',
  ZA: 'South Africa',
  SN: 'Senegal',
  DZ: 'Algeria',
  GN: 'Guinea',
  CI: 'Ivory Coast',
  CD: 'DR Congo',
  CM: 'Cameroon',
  TZ: 'Tanzania',
  GB: 'United Kingdom',
  US: 'United States',
  FR: 'France',
  JM: 'Jamaica',
};

// ============================================
// HELPERS
// ============================================

const css = (obj: Record<string, unknown>) => obj as React.CSSProperties;

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function getAvatarGradient(region: string | undefined): string {
  if (!region) return DEFAULT_GRADIENT;
  return REGION_GRADIENTS[region] || DEFAULT_GRADIENT;
}

// ============================================
// STYLES
// ============================================

const S = {
  overlay: css({
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    backgroundColor: '#0a0a0a',
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
  }),

  header: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 16px 0',
    paddingTop: 'max(16px, env(safe-area-inset-top, 16px))',
  }),

  headerBtn: css({
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.08)',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#fff',
  }),

  profileSection: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '24px 16px 16px',
    textAlign: 'center',
  }),

  avatar: css({
    width: 80,
    height: 80,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    fontWeight: 800,
    color: '#fff',
    marginBottom: 16,
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
  }),

  name: css({
    fontSize: 28,
    fontWeight: 800,
    color: '#fff',
    marginBottom: 8,
    lineHeight: 1.2,
  }),

  meta: css({
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  }),

  stats: css({
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 4,
  }),

  sectionHeader: css({
    fontSize: 11,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 3,
    textTransform: 'uppercase',
    padding: '24px 16px 12px',
  }),

  divider: css({
    height: 1,
    background: 'rgba(255,255,255,0.06)',
    margin: '8px 16px',
  }),

  scrollRow: css({
    display: 'flex',
    gap: 12,
    overflowX: 'auto',
    overflowY: 'hidden',
    padding: '0 16px 8px',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
  }),

  trackCard: css({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 10,
    minWidth: 280,
    maxWidth: 320,
    flexShrink: 0,
    cursor: 'pointer',
  }),

  trackThumb: css({
    width: 48,
    height: 48,
    borderRadius: 8,
    objectFit: 'cover',
    backgroundColor: 'rgba(255,255,255,0.08)',
    flexShrink: 0,
  }),

  trackThumbPlaceholder: css({
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),

  trackInfo: css({
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  }),

  trackTitle: css({
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    lineHeight: 1.3,
  }),

  trackSub: css({
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    marginTop: 2,
  }),

  playBtn: css({
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.12)',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    color: '#fff',
  }),

  momentCard: css({
    width: 120,
    flexShrink: 0,
    cursor: 'pointer',
  }),

  momentThumb: css({
    width: 120,
    height: 160,
    borderRadius: 10,
    objectFit: 'cover',
    backgroundColor: 'rgba(255,255,255,0.08)',
    display: 'block',
  }),

  momentThumbPlaceholder: css({
    width: 120,
    height: 160,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),

  momentTitle: css({
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 6,
    lineHeight: 1.3,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  } as Record<string, unknown>),

  momentMeta: css({
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 2,
  }),

  discoverSection: css({
    padding: '0 16px 32px',
    paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))',
  }),

  discoverBtn: css({
    width: '100%',
    padding: '14px 20px',
    borderRadius: 14,
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  }),

  discoverResults: css({
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginTop: 12,
  }),

  listTrackCard: css({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 10,
    cursor: 'pointer',
  }),

  emptyState: css({
    textAlign: 'center',
    padding: '32px 16px',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
  }),

  tierBadge: css({
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 6,
    background: 'rgba(251,191,36,0.15)',
    color: '#FBBF24',
    letterSpacing: 1,
  }),

  loadingContainer: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 16px',
    gap: 12,
  }),

  errorText: css({
    color: 'rgba(255,100,100,0.8)',
    fontSize: 13,
    textAlign: 'center',
    padding: '16px',
  }),
};

// ============================================
// SUB-COMPONENTS (inline)
// ============================================

function TrackCardHorizontal({
  track,
  onPlay,
}: {
  track: ArtistTrack;
  onPlay: () => void;
}) {
  return (
    <div
      style={S.trackCard}
      onClick={onPlay}
    >
      {track.thumbnail_url ? (
        <img
          src={track.thumbnail_url}
          alt=""
          style={S.trackThumb}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : (
        <div style={S.trackThumbPlaceholder}>
          <Music2 size={20} style={{ color: 'rgba(255,255,255,0.3)' }} />
        </div>
      )}
      <div style={S.trackInfo}>
        <div style={S.trackTitle}>{track.title}</div>
        <div style={S.trackSub}>
          {track.artist || 'Unknown Artist'}
          {track.duration_seconds ? ` \u00B7 ${formatDuration(track.duration_seconds)}` : ''}
        </div>
      </div>
      <button style={S.playBtn} onClick={(e) => { e.stopPropagation(); onPlay(); }}>
        <Play size={16} fill="#fff" />
      </button>
    </div>
  );
}

function TrackCardVertical({
  track,
  onPlay,
}: {
  track: ArtistTrack;
  onPlay: () => void;
}) {
  return (
    <div
      style={S.listTrackCard}
      onClick={onPlay}
    >
      {track.thumbnail_url ? (
        <img
          src={track.thumbnail_url}
          alt=""
          style={S.trackThumb}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : (
        <div style={S.trackThumbPlaceholder}>
          <Music2 size={20} style={{ color: 'rgba(255,255,255,0.3)' }} />
        </div>
      )}
      <div style={S.trackInfo}>
        <div style={S.trackTitle}>{track.title}</div>
        <div style={S.trackSub}>
          {track.artist || 'Unknown Artist'}
          {track.duration_seconds ? ` \u00B7 ${formatDuration(track.duration_seconds)}` : ''}
        </div>
      </div>
      <button style={S.playBtn} onClick={(e) => { e.stopPropagation(); onPlay(); }}>
        <Play size={16} fill="#fff" />
      </button>
    </div>
  );
}

function MomentCardSmall({ moment }: { moment: ArtistMoment }) {
  return (
    <div style={S.momentCard}>
      {moment.thumbnail_url ? (
        <img
          src={moment.thumbnail_url}
          alt=""
          style={S.momentThumb}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : (
        <div style={S.momentThumbPlaceholder}>
          <ExternalLink size={20} style={{ color: 'rgba(255,255,255,0.3)' }} />
        </div>
      )}
      <div style={S.momentTitle as React.CSSProperties}>{moment.title}</div>
      <div style={S.momentMeta}>
        {formatCount(moment.view_count)} views
        {moment.heat_score > 0 ? ` \u00B7 ${moment.heat_score.toFixed(0)} heat` : ''}
      </div>
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export const ArtistPage: React.FC<ArtistPageProps> = ({
  artistName,
  onClose,
  onPlayTrack,
}) => {
  const {
    profile,
    tracks,
    moments,
    trackCount,
    momentCount,
    totalPlays,
    isLoading,
    error,
    searchResults,
    isSearching,
    discoverMore,
  } = useArtist(artistName);

  const [showDiscover, setShowDiscover] = useState(false);

  // System back gesture peels artist → search → home. ArtistPage is rendered
  // only when artistPageName is truthy (App.tsx), so `open` = true here; the
  // parent unmounts this component when onClose fires. The hook pushes a
  // history entry tagged 'artist-page' so popstate maps to onClose.
  useBackGuard(true, onClose, 'artist-page');

  const handleDiscover = async () => {
    setShowDiscover(true);
    await discoverMore();
  };

  const handlePlayTrack = (track: ArtistTrack) => {
    onPlayTrack(
      track.youtube_id,
      track.title,
      track.artist || artistName
    );
  };

  // Display values
  const displayName = profile?.canonical_name || artistName;
  const country = profile?.country || '';
  const countryFlag = COUNTRY_FLAGS[country] || '';
  const countryName = COUNTRY_NAMES[country] || country;
  const genre = profile?.primary_genre || '';
  const tier = profile?.tier || '';
  const region = profile?.region;
  const avatarGradient = getAvatarGradient(region);

  // Build metadata line
  const metaParts: string[] = [];
  if (countryName) metaParts.push(countryName);
  if (genre) metaParts.push(genre.charAt(0).toUpperCase() + genre.slice(1));

  // Build stats line
  const statParts: string[] = [];
  if (trackCount > 0) statParts.push(`${trackCount} track${trackCount !== 1 ? 's' : ''}`);
  if (momentCount > 0) statParts.push(`${momentCount} moment${momentCount !== 1 ? 's' : ''}`);
  if (totalPlays > 0) statParts.push(`${formatCount(totalPlays)} plays`);

  return (
    <>
      <div
        style={{ ...S.overlay, animation: 'voyo-slide-up 0.4s ease forwards' }}
      >
        {/* HEADER BAR */}
        <div style={S.header}>
          <button
            style={S.headerBtn}
            onClick={onClose}
          >
            <ArrowLeft size={20} />
          </button>
          <VoyoCloseX onClose={onClose} size="md" />

        </div>

        {/* PROFILE SECTION */}
        <div style={S.profileSection}>
          <div
            style={{ ...S.avatar, background: avatarGradient, animation: 'voyo-scale-in 0.3s ease 0.1s both' }}
          >
            {getInitials(displayName)}
          </div>

          <div
            style={{ ...S.name, animation: 'voyo-fade-in 0.3s ease 0.15s both' }}
          >
            {displayName}
          </div>

          <div
            style={{ ...S.meta, animation: 'voyo-fade-in 0.3s ease 0.2s both' }}
          >
            {countryFlag && <span>{countryFlag}</span>}
            {metaParts.join(' \u00B7 ')}
            {tier && <span style={S.tierBadge}>Tier {tier}</span>}
          </div>

          {statParts.length > 0 && (
            <div
              style={{ ...S.stats, animation: 'voyo-fade-in 0.3s ease 0.25s both' }}
            >
              {statParts.join(' \u00B7 ')}
            </div>
          )}

          {isLoading && (
            <div
              style={{ ...S.stats, animation: 'voyo-fade-in 0.3s ease both' }}
            >
              <div className="h-3 w-32 rounded bg-white/5 animate-pulse" />
            </div>
          )}
        </div>

        {/* ERROR */}
        {error && !isLoading && (
          <div style={S.errorText as React.CSSProperties}>{error}</div>
        )}

        {/* LOADING STATE — skeleton cards */}
        {isLoading && (
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="w-12 h-12 rounded-lg bg-white/5 voyo-skeleton-shimmer flex-shrink-0" />
                <div className="flex-1">
                  <div className="h-3 w-3/4 bg-white/5 rounded voyo-skeleton-shimmer mb-2" />
                  <div className="h-2 w-1/2 bg-white/5 rounded voyo-skeleton-shimmer" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* OUR LIBRARY */}
        {!isLoading && (
          <>
            <div style={S.divider} />
            <div style={S.sectionHeader}>OUR LIBRARY</div>

            {tracks.length > 0 ? (
              <div
                style={S.scrollRow}
                // Hide scrollbar cross-browser
                ref={(el) => {
                  if (el) {
                    el.style.setProperty('scrollbar-width', 'none');
                    el.style.setProperty('-ms-overflow-style', 'none');
                  }
                }}
              >
                {tracks.map((track) => (
                  <TrackCardHorizontal
                    key={track.youtube_id}
                    track={track}
                    onPlay={() => handlePlayTrack(track)}
                  />
                ))}
              </div>
            ) : (
              <div style={S.emptyState}>
                No tracks found in our library yet.
              </div>
            )}
          </>
        )}

        {/* MOMENTS */}
        {!isLoading && moments.length > 0 && (
          <>
            <div style={S.divider} />
            <div style={S.sectionHeader}>MOMENTS</div>

            <div
              style={S.scrollRow}
              ref={(el) => {
                if (el) {
                  el.style.setProperty('scrollbar-width', 'none');
                  el.style.setProperty('-ms-overflow-style', 'none');
                }
              }}
            >
              {moments.map((moment) => (
                <MomentCardSmall key={moment.id} moment={moment} />
              ))}
            </div>
          </>
        )}

        {/* DISCOVER MORE */}
        {!isLoading && (
          <>
            <div style={S.divider} />
            <div style={S.sectionHeader}>DISCOVER MORE</div>

            <div style={S.discoverSection}>
              {!showDiscover ? (
                <button
                  style={S.discoverBtn}
                  onClick={handleDiscover}
                >
                  <Search size={16} />
                  Search YouTube for more {displayName} tracks
                </button>
              ) : (
                <>
                  {isSearching && (
                    <div style={S.loadingContainer}>
                      <div className="animate-spin">
                        <Loader2 size={20} style={{ color: 'rgba(255,255,255,0.4)' }} />
                      </div>
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                        Searching YouTube...
                      </span>
                    </div>
                  )}

                  {!isSearching && searchResults.length === 0 && (
                    <div style={S.emptyState}>
                      No additional results found.
                    </div>
                  )}

                  {searchResults.length > 0 && (
                    <div style={S.discoverResults}>
                      {searchResults.map((track) => (
                        <TrackCardVertical
                          key={track.youtube_id}
                          track={track}
                          onPlay={() => handlePlayTrack(track)}
                        />
                      ))}
                    </div>
                  )}

                  {!isSearching && searchResults.length > 0 && (
                    <button
                      style={{ ...S.discoverBtn, marginTop: 12 }}
                      onClick={discoverMore}
                    >
                      <Search size={16} />
                      Search again
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* Bottom safe area spacer */}
        <div style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
      </div>
    </>
  );
};

export default ArtistPage;

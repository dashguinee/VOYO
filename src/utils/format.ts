export const formatTime = (seconds: number | null | undefined): string => {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const formatDuration = formatTime;

export const formatViews = (views: number): string => {
  if (!views || isNaN(views)) return '0';
  if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B`;
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(0)}K`;
  return views.toString();
};

export const formatOyeScore = formatViews;

const GENRE_LABELS: Record<string, string> = {
  afrobeats: 'Afrobeats', afropop: 'Afropop', amapiano: 'Amapiano',
  afrobeat: 'Afrobeat', afrofusion: 'Afro Fusion', 'afro-fusion': 'Afro Fusion',
  afrohouse: 'Afro House', 'afro-house': 'Afro House', gqom: 'Gqom',
  kwaito: 'Kwaito', fuji: 'Fuji', afrojuju: 'Afro Juju',
  hiphop: 'Hip-Hop', 'hip-hop': 'Hip-Hop', trap: 'Trap', drill: 'Drill', grime: 'Grime',
  rnb: 'R&B', 'r&b': 'R&B', soul: 'Soul', gospel: 'Gospel', jazz: 'Jazz',
  reggae: 'Reggae', dancehall: 'Dancehall', soca: 'Soca', reggaeton: 'Reggaeton',
  kizomba: 'Kizomba', zouk: 'Zouk', afrofolk: 'Afro Folk',
  highlife: 'Highlife', hiplife: 'Hiplife', mbalax: 'Mbalax',
  bikutsi: 'Bikutsi', makossa: 'Makossa', soukous: 'Soukous',
  congolese: 'Congolese', ndombolo: 'Ndombolo', 'bongo-flava': 'Bongo Flava',
  gengetone: 'Gengetone', rumba: 'Rumba', funk: 'Funk', pop: 'Pop',
  rock: 'Rock', electronic: 'Electronic', classical: 'Classical', other: 'World',
};

export const fmtGenre = (g: string | null | undefined): string => {
  if (!g) return '';
  const key = g.toLowerCase();
  return GENRE_LABELS[key] ?? GENRE_LABELS[key.replace(/[-\s]+/g, '')] ?? (g.charAt(0).toUpperCase() + g.slice(1));
};

export const formatRelativeDate = (dateString: string): string => {
  const date = new Date(dateString);
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
};

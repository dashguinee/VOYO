/**
 * TrackThumbnail — 3-tier fallback image with session+persistent failure memory.
 *
 *   Tier 1: YouTube `hqdefault.jpg` (primary)
 *   Tier 2: `communityUrl` — caller-provided alternate source
 *           (Supabase voyo_tracks.thumbnail_url for real tracks, a local
 *           /vibes/ asset for hand-picked mocks)
 *   Tier 3: DASH-branded generated placeholder SVG
 *
 * Why a dedicated component: plain `<img>` inside a keyed wrapper (see
 * VoyoLiveCard's friend rotation) remounts every 5s, which re-fires any
 * previously-404'd YouTube thumbnail every time. Chrome's devtools captured
 * the resulting React commit-phase loop (jy → Ly → Vt → Ly → Vt …) firing
 * the Image error hundreds of times. Fix: remember failed URLs in a
 * module-level Set (persisted to localStorage) so the chain skips dead
 * URLs on subsequent mounts instead of re-requesting.
 */

import { memo, useRef, useState, useCallback } from 'react';
import { generatePlaceholder } from '../../utils/thumbnail';

const FAILED_KEY = 'voyo_thumb_failures_v1';
const FAILED_CAP = 500; // cap size so localStorage never balloons

function loadFailures(): Set<string> {
  try {
    const raw = localStorage.getItem(FAILED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.slice(-FAILED_CAP) : []);
  } catch {
    return new Set();
  }
}

const failedUrls: Set<string> = loadFailures();

function persistFailures(): void {
  try {
    const arr = Array.from(failedUrls).slice(-FAILED_CAP);
    localStorage.setItem(FAILED_KEY, JSON.stringify(arr));
  } catch {
    /* quota full / private mode — session-only memory still holds */
  }
}

export function markThumbnailFailed(url: string): void {
  if (!url || url.startsWith('data:')) return;
  if (failedUrls.has(url)) return;
  failedUrls.add(url);
  persistFailures();
}

function extractYoutubeId(urlOrId: string | undefined): string | null {
  if (!urlOrId) return null;
  if (!urlOrId.includes('/')) return urlOrId; // raw ID
  const m = urlOrId.match(/\/vi\/([^/]+)\//);
  return m ? m[1] : null;
}

interface TrackThumbnailProps {
  /** YouTube video ID or full ytimg URL — tier 1 */
  youtubeId?: string;
  /** Alternate community source (Supabase thumbnail_url, local /vibes/ art, etc.) — tier 2 */
  communityUrl?: string;
  /** Track title — used to generate the tier-3 placeholder */
  title?: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  draggable?: boolean;
}

const TrackThumbnailInner: React.FC<TrackThumbnailProps> = ({
  youtubeId,
  communityUrl,
  title,
  alt = '',
  className,
  style,
  draggable = false,
}) => {
  // Build the chain ONCE per mount (stable across parent re-renders).
  // Skip URLs already known to have failed this session — that's the
  // whole point of this component. If the primary is dead, the first
  // render goes straight to tier 2 or 3 with no wasted network request.
  const chainRef = useRef<string[] | null>(null);
  if (chainRef.current === null) {
    const ytId = extractYoutubeId(youtubeId);
    const candidates: string[] = [];
    if (ytId) candidates.push(`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`);
    if (communityUrl) candidates.push(communityUrl);
    candidates.push(generatePlaceholder(title || 'Track', 400));

    const filtered = candidates.filter(u => !failedUrls.has(u));
    // Always guarantee at least the placeholder so we never render empty.
    chainRef.current = filtered.length > 0
      ? filtered
      : [generatePlaceholder(title || 'Track', 400)];
  }

  const [idx, setIdx] = useState(0);
  const chain = chainRef.current;
  const src = chain[Math.min(idx, chain.length - 1)];

  const onError = useCallback(() => {
    // Record the failure so this URL is skipped on future mounts.
    markThumbnailFailed(src);
    setIdx(prev => (prev < chain.length - 1 ? prev + 1 : prev));
  }, [src, chain.length]);

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      draggable={draggable}
      onError={onError}
    />
  );
};

export const TrackThumbnail = memo(TrackThumbnailInner);
export default TrackThumbnail;

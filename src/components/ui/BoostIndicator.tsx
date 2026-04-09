/**
 * VOYO Boost Indicator - Shows playback source quality
 *
 * Cached = Boosted (highest quality, offline-ready)
 * Iframe = Streaming (playing now, boost in background)
 * Direct = High quality stream
 */

import { Zap, Download, Wifi, Radio } from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { useDownloadStore } from '../../store/downloadStore';

export const BoostIndicator = () => {
  const playbackSource = usePlayerStore((state) => state.playbackSource);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const downloads = useDownloadStore((state) => state.downloads);

  if (!currentTrack) return null;

  // Check if current track is being downloaded
  const downloadStatus = downloads.get(currentTrack.trackId);
  const isDownloading = downloadStatus?.status === 'downloading';
  const downloadProgress = downloadStatus?.progress || 0;

  return (
    <div
      key={playbackSource || 'loading'}
      className="flex items-center gap-1.5 animate-voyo-scale-in"
    >
      {playbackSource === 'cached' && (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-purple-500/20 to-violet-500/20 border border-purple-500/30">
          <Zap size={12} className="text-purple-400" />
          <span className="text-[10px] font-medium text-purple-300 uppercase tracking-wider">
            Boosted
          </span>
        </div>
      )}

      {playbackSource === 'iframe' && (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
          {isDownloading ? (
            <>
              <Download size={12} className="text-amber-400 animate-pulse" />
              <span className="text-[10px] font-medium text-amber-300 uppercase tracking-wider">
                Boosting {downloadProgress}%
              </span>
            </>
          ) : (
            <>
              <Radio size={12} className="text-amber-400" />
              <span className="text-[10px] font-medium text-amber-300 uppercase tracking-wider">
                Streaming
              </span>
            </>
          )}
        </div>
      )}

      {playbackSource === 'direct' && (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20">
          <Wifi size={12} className="text-purple-400" />
          <span className="text-[10px] font-medium text-purple-300 uppercase tracking-wider">
            HQ Stream
          </span>
        </div>
      )}

      {playbackSource === 'cdn' && (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20">
          <Wifi size={12} className="text-violet-400" />
          <span className="text-[10px] font-medium text-violet-300 uppercase tracking-wider">
            CDN
          </span>
        </div>
      )}
    </div>
  );
};

/**
 * Compact version for tight spaces
 */
export const BoostIndicatorCompact = () => {
  const playbackSource = usePlayerStore((state) => state.playbackSource);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const downloads = useDownloadStore((state) => state.downloads);

  if (!currentTrack) return null;

  const isDownloading = downloads.get(currentTrack.trackId)?.status === 'downloading';

  return (
    <div className="flex items-center animate-voyo-fade-in">
      {playbackSource === 'cached' && (
        <span title="Boosted - Playing from cache">
          <Zap size={14} className="text-purple-400" />
        </span>
      )}
      {playbackSource === 'iframe' && (
        <span title={isDownloading ? "Streaming + Boosting" : "Streaming"}>
          {isDownloading ? (
            <Download size={14} className="text-amber-400 animate-pulse" />
          ) : (
            <Radio size={14} className="text-amber-400" />
          )}
        </span>
      )}
      {playbackSource === 'direct' && (
        <span title="High quality stream">
          <Wifi size={14} className="text-purple-400" />
        </span>
      )}
      {playbackSource === 'cdn' && (
        <span title="CDN streaming">
          <Wifi size={14} className="text-blue-400" />
        </span>
      )}
    </div>
  );
};

export default BoostIndicator;

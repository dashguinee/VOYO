/**
 * iframeBridge — thin singleton that lets AudioPlayer talk to the YouTube
 * iframe without prop-drilling or React context. YouTubeIframe registers its
 * player on mount; AudioPlayer uses the bridge to coordinate the hot-swap
 * cross-fade when a track's R2 copy becomes available mid-play.
 */

type YTPlayer = {
  getCurrentTime: () => number;
  setVolume: (v: number) => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  playVideo: () => void;
  mute: () => void;
  unMute: () => void;
};

class IframeBridge {
  private player: YTPlayer | null = null;

  register(player: YTPlayer | null): void { this.player = player; }
  isReady(): boolean { return !!this.player; }

  getCurrentTime(): number | null {
    try { return this.player?.getCurrentTime?.() ?? null; } catch { return null; }
  }

  /**
   * Linear volume ramp from the current volume to 0 over `durationMs`.
   * Runs via setInterval rather than Web Audio because YouTube iframes don't
   * expose a MediaElement handle we can route through the Audio graph.
   */
  fadeOut(durationMs: number = 400): Promise<void> {
    const player = this.player;
    if (!player) return Promise.resolve();
    return new Promise((resolve) => {
      const steps = 16;
      const stepMs = Math.max(1, Math.round(durationMs / steps));
      let i = 0;
      const tick = () => {
        i++;
        const v = Math.max(0, Math.round(100 * (1 - i / steps)));
        try { player.setVolume(v); } catch {}
        if (i >= steps) { resolve(); return; }
        setTimeout(tick, stepMs);
      };
      tick();
    });
  }

  play(): void {
    try { this.player?.unMute?.(); } catch {}
    try { this.player?.setVolume?.(100); } catch {}
    try { this.player?.playVideo?.(); } catch {}
  }

  pause(): void {
    try { this.player?.pauseVideo?.(); } catch {}
    try { this.player?.mute?.(); } catch {}
  }

  /**
   * Stop the YouTube video entirely — kills the network stream, not just
   * pauses it. Call this after a hot-swap completes so YouTube doesn't
   * continue buffering for up to 60s in the background. Uses stopVideo()
   * (YT IFrame API) which terminates media fetch, unlike pauseVideo which
   * only halts playback while buffering continues.
   */
  stop(): void {
    try { this.player?.stopVideo?.(); } catch {}
    try { this.player?.mute?.(); } catch {}
  }

  /** Restore volume to full — use before a new unmute so we don't resume at 0. */
  resetVolume(): void {
    try { this.player?.setVolume?.(100); } catch {}
  }
}

export const iframeBridge = new IframeBridge();

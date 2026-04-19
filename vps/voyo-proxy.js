/**
 * VOYO audio proxy — v2 (pipe-tee architecture)
 *
 * Serves /voyo/audio/{trackId}?quality={low|medium|high|studio}.
 *
 * Hot-path order:
 *   1. /var/cache/voyo/{id}-{q}.opus hit → serve from disk (ms)
 *   2. R2 HEAD hit → 302 redirect (worker serves)
 *   3. activeJobs dedup → second caller waits for first's cache write
 *   4. Live extraction → pipe-tee:
 *        upstream HTTP → FFmpeg stdin → FFmpeg stdout → { user response, /var/cache/{id}-{q}.opus.tmp }
 *
 * After FFmpeg closes cleanly: atomic rename .tmp → final, background R2 upload.
 * The cache file STAYS on /var/cache/voyo permanently (LRU eviction by cron).
 *
 * Why pipe-tee: previously `extractAudioUrl` downloaded the full raw webm
 * to disk THEN resolved, THEN FFmpeg started. On a cold track this took
 * 10–15s before the user saw one byte, and the PWA watchdog skipped at 8s.
 * Now FFmpeg starts transcoding the moment first upstream bytes arrive,
 * so user TTFB drops to ~2s for a cold extraction. R2-cached tracks are
 * unchanged (still 302'd), and warm /var/cache hits beat R2 hits (no
 * redirect, local disk).
 *
 * Why keep /var/cache instead of relying only on R2: (a) it's faster
 * (no redirect, no TCP handshake with Cloudflare), (b) it's a graceful
 * degradation layer — if R2 has an incident, VPS still serves recent
 * tracks, (c) concurrent requests for the same cold track share one
 * extraction via file polling.
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const { exec, spawn } = require("child_process");
const { PassThrough } = require("stream");

const PORT = 8443;
const R2_BASE = "https://voyo-edge.dash-webtv.workers.dev";

// Cookie bridge in-memory cache — keyed by profile path, 10-min TTL
let cookiesBridgeCache = null;



// Telemetry sink — best-effort POST to Supabase voyo_playback_events with
// source='vps'. Complements PWA-side telemetry so we can see the timeline
// of edge circuit trips, cache hit rates, and cookie-source failures from
// BOTH ends. All calls fire-and-forget (no awaits anywhere on the request
// path) so a telemetry hiccup never blocks audio.
const TELEMETRY_URL = process.env.VOYO_SUPABASE_URL
  ? `${process.env.VOYO_SUPABASE_URL}/rest/v1/voyo_playback_events`
  : "";
const TELEMETRY_KEY = process.env.VOYO_SUPABASE_ANON_KEY || "";
const HOSTNAME = require("os").hostname();
function postTelemetry(eventType, trackId, meta) {
  if (!TELEMETRY_URL || !TELEMETRY_KEY) return;
  const body = JSON.stringify({
    event_type: eventType,
    track_id: trackId || "-",
    meta: { ...meta, source: "vps", host: HOSTNAME },
    user_agent: "voyo-proxy/v2.2",
    session_id: `vps_${HOSTNAME}`,
  });
  fetch(TELEMETRY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": TELEMETRY_KEY,
      "Authorization": `Bearer ${TELEMETRY_KEY}`,
      "Prefer": "return=minimal",
    },
    body,
  }).catch(() => {}); // silence network errors — proxy keeps running
}

// Hot-tier cache. Persists across restarts; cron-evicted by age/size.
const CACHE_DIR = "/var/cache/voyo";
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o755 });

// Secondary temp (waveform JSON, stray artefacts). Not for audio bytes.
const TMP_DIR = "/tmp/voyo-audio";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// Anything smaller than this in the cache is a truncated/corrupt write —
// discard it. Real opus files at 64kbps × 60s ≈ 480KB minimum.
const CACHE_MIN_BYTES = 300_000;

// Concurrency cap — protects the 4-vCPU VPS from FFmpeg herd.
const MAX_CONCURRENT_FFMPEG = 6;

// In-flight extractions keyed by `${trackId}-${quality}`. Second caller
// polls the cache path and serves from there once ready.
const activeJobs = new Map();


const ssl = {
  key: fs.readFileSync("/etc/letsencrypt/live/stream.zionsynapse.online/privkey.pem"),
  cert: fs.readFileSync("/etc/letsencrypt/live/stream.zionsynapse.online/fullchain.pem"),
};

const bitrateMap = { low: "64k", medium: "128k", high: "256k", studio: "320k" };

function cachePath(trackId, quality) {
  return `${CACHE_DIR}/${trackId}-${quality}.opus`;
}

// Sweep orphaned .tmp files left by prior crashes. Run once on boot.
(function cleanupOrphans() {
  try {
    fs.readdirSync(CACHE_DIR)
      .filter(f => f.endsWith(".tmp"))
      .forEach(f => {
        try { fs.unlinkSync(`${CACHE_DIR}/${f}`); } catch {}
      });
  } catch {}
})();

// Periodic /tmp cleanup (waveform artifacts etc.) — was in v1, keep.
setInterval(() => {
  try {
    const files = fs.readdirSync(TMP_DIR);
    const now = Date.now();
    let cleaned = 0;
    files.forEach(f => {
      const p = `${TMP_DIR}/${f}`;
      try {
        if (now - fs.statSync(p).mtimeMs > 3_600_000) {
          fs.unlinkSync(p); cleaned++;
        }
      } catch {}
    });
    if (cleaned) console.log(`[VOYO] tmp cleanup: ${cleaned} files`);
  } catch {}
}, 1_800_000);

// ── HTTP server ───────────────────────────────────────────────────────────

const server = https.createServer(ssl, async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, "https://localhost");

  // PoToken endpoint — CF Worker fetches this to authenticate InnerTube requests.
  // bgutil-pot service runs at localhost:4416 and generates browser-proof tokens.
  if (url.pathname === "/voyo/pot") {
    const videoId = url.searchParams.get("v") || "dQw4w9WgXcQ";
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid videoId" }));
      return;
    }
    try {
      const potRes = await fetch("http://localhost:4416/get_pot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      if (!potRes.ok) throw new Error(`bgutil ${potRes.status}`);
      const pot = await potRes.json();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ poToken: pot.poToken, contentBinding: pot.contentBinding, expiresAt: pot.expiresAt }));
    } catch (e) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `bgutil unavailable: ${e.message}` }));
    }
    return;
  }

  // ── Cookie bridge — /voyo/cookies ─────────────────────────────────────
  //
  // Dumps fresh Netscape-format cookies from a random persistent Chrome
  // profile at /opt/voyo/chrome-profile-NN. This is what lets GitHub Actions
  // workers extract from YouTube without shipping baked (stale) cookies in
  // the workflow YAML. The VPS's Chrome profiles self-refresh via the live
  // browser session so cookies stay fresh indefinitely.
  //
  // Auth: shared-secret header X-Voyo-Key (VOYO_COOKIES_SECRET env var).
  // Caching: 10-min TTL per profile in-memory. Rate-limits Chrome disk reads.
  //
  // Response headers:
  //   X-Cookie-Account: which profile was used (for logging/rotation)
  // Body: Netscape cookie file contents.
  if (url.pathname === "/voyo/cookies") {
    const COOKIES_SECRET = process.env.VOYO_COOKIES_SECRET || "";
    const provided = req.headers["x-voyo-key"] || "";
    if (!COOKIES_SECRET || provided !== COOKIES_SECRET) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    try {
      const profiles = fs.readdirSync("/opt/voyo")
        .filter(f => /^chrome-profile-\d+$/.test(f))
        .map(f => `/opt/voyo/${f}`);
      if (!profiles.length) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "no chrome profiles on VPS" }));
        return;
      }
      // Honor ?account=profile-001 if specified, otherwise random
      const requested = url.searchParams.get("account");
      const explicit  = requested && profiles.find(p => p.endsWith(requested));
      const chosen    = explicit || profiles[Math.floor(Math.random() * profiles.length)];
      const accountLabel = chosen.split("/").pop();

      // In-memory cache, 10-min TTL per profile. Avoids re-triggering a
      // yt-dlp call for every worker in a matrix of 3.
      cookiesBridgeCache = cookiesBridgeCache || new Map();
      const cached = cookiesBridgeCache.get(chosen);
      if (cached && Date.now() - cached.at < 10 * 60_000) {
        res.writeHead(200, {
          "Content-Type":     "text/plain",
          "X-Cookie-Account": accountLabel,
          "X-Cookie-Age-Ms":  String(Date.now() - cached.at),
        });
        res.end(cached.body);
        return;
      }

      // voyo-dump-cookies uses yt-dlp's cookies module directly — avoids
      // the YoutubeDL session save_cookies path which hits the immutable
      // /opt/voyo/cookies.txt. Helper at /usr/local/bin/voyo-dump-cookies.
      const tmpFile = `/tmp/voyo-cookies-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
      const cmd = `/usr/local/bin/voyo-dump-cookies "${chosen}" "${tmpFile}" 2>&1`;
      exec(cmd, { timeout: 20_000 }, (err) => {
        let body = "";
        try { body = fs.readFileSync(tmpFile, "utf8"); } catch {}
        try { fs.unlinkSync(tmpFile); } catch {}
        if (!body || body.length < 200) {
          console.error(`[VOYO] cookie dump failed for ${accountLabel}: ${err?.message || "empty"}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "dump failed", account: accountLabel }));
          return;
        }
        cookiesBridgeCache.set(chosen, { body, at: Date.now() });
        console.log(`[VOYO] served fresh cookies from ${accountLabel} (${body.length}B)`);
        res.writeHead(200, {
          "Content-Type":     "text/plain",
          "X-Cookie-Account": accountLabel,
          "X-Cookie-Age-Ms":  "0",
        });
        res.end(body);
      });
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (url.pathname === "/health" || url.pathname === "/voyo/health") {
    const jobs = Object.fromEntries([...activeJobs.entries()].map(([k, v]) => [k, v.status]));
    let cacheStats = null;
    try {
      const entries = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith(".opus"));
      let bytes = 0;
      entries.forEach(f => { try { bytes += fs.statSync(`${CACHE_DIR}/${f}`).size; } catch {} });
      cacheStats = { count: entries.length, bytes };
    } catch {}
    const now = Date.now();
    const pool = POOL_NODES.map(n => ({
      host: n.host,
      port: n.port,
      healthy: n.unhealthyUntil <= now,
      failures: n.failures,
      cooldownSec: n.unhealthyUntil > now ? Math.ceil((n.unhealthyUntil - now)/1000) : 0,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "voyo-audio",
      version: "v2.4-pool",
      uptime: process.uptime(),
      activeJobs: activeJobs.size,
      jobs,
      cache: cacheStats,
      pool,
      fallbackProxy: !!PROXY_CFG,
    }));
    return;
  }

  const audioMatch = url.pathname.match(/^\/voyo\/audio\/([a-zA-Z0-9_-]+)$/);
  if (audioMatch) {
    return handleAudio(req, res, audioMatch[1], url.searchParams.get("quality") || "high");
  }

  const waveMatch = url.pathname.match(/^\/voyo\/waveform\/([a-zA-Z0-9_-]+)$/);
  if (waveMatch) {
    const waveFile = `${TMP_DIR}/${waveMatch[1]}-waveform.json`;
    if (fs.existsSync(waveFile)) {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=604800",
      });
      fs.createReadStream(waveFile).pipe(res);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Waveform not yet generated" }));
    return;
  }

  res.writeHead(404);
  res.end("Not found. Endpoints: /voyo/audio/:trackId, /voyo/waveform/:trackId, /health");
});

server.listen(PORT, () => console.log(`[VOYO] Audio proxy v2 on :${PORT}`));

// ── Audio request handler ────────────────────────────────────────────────

async function handleAudio(req, res, trackId, quality) {
  const bitrate = bitrateMap[quality] || "256k";
  const cachedPath = cachePath(trackId, quality);
  const jobKey = `${trackId}-${quality}`;

  console.log(`[VOYO] Audio request: ${trackId} @ ${quality} (${bitrate})`);

  if (!/^[A-Za-z0-9_-]{11}$/.test(trackId)) {
    console.log(`[VOYO] Rejecting invalid trackId format: ${trackId}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid track ID format", trackId }));
    return;
  }

  // 1. /var/cache hot tier — local-disk hit is faster than R2 round-trip.
  //    Supports HTTP Range so seek-within-track works on a complete file.
  if (fs.existsSync(cachedPath)) {
    const stat = fs.statSync(cachedPath);
    if (stat.size >= CACHE_MIN_BYTES) {
      console.log(`[VOYO] /var/cache hit: ${trackId}/${quality} (${stat.size}B)`);
      postTelemetry("trace", trackId, { subtype: "vps_cache_hit", tier: "local", quality, bytes: stat.size });
      return serveFromCache(req, res, cachedPath, stat.size);
    }
    // Corrupt — toss it and proceed to extraction.
    fs.unlinkSync(cachedPath);
  }

  // 2. R2 cache — tracks that this VPS has uploaded (or another VPS did).
  try {
    const r2Url = `${R2_BASE}/audio/${trackId}?q=${quality}`;
    if (await checkR2(r2Url)) {
      console.log(`[VOYO] R2 hit: ${trackId}/${quality}`);
      postTelemetry("trace", trackId, { subtype: "vps_cache_hit", tier: "r2", quality });
      res.writeHead(302, { Location: r2Url });
      res.end();
      return;
    }
  } catch (e) {
    console.log(`[VOYO] R2 check failed, proceeding with extraction: ${e.message}`);
  }

  // 3. In-flight dedup — stream from the growing .tmp file as FFmpeg writes
  //    it, instead of waiting for the full .tmp → .opus rename (30-90s).
  //    Second requester gets audio after ~3-4s (once 80KB is written) which
  //    is the same TTFB as a cache hit. This is the "join in-progress tee"
  //    pattern: first caller owns the pipe-tee + cache write; second caller
  //    tail-reads from the same .tmp file.
  if (activeJobs.has(jobKey)) {
    console.log(`[VOYO] Already extracting ${jobKey} — joining live .tmp stream`);
    const tmpPath = `${cachedPath}.tmp`;
    // Min bytes before we start streaming: ~4s of 64kbps = 32KB.
    // Enough for OGG container header + several frames.
    const MIN_START_BYTES = 32_000;
    const deadline = Date.now() + 120_000;

    res.writeHead(200, {
      "Content-Type": "audio/ogg; codecs=opus",
      "Cache-Control": "public, max-age=86400",
      "Transfer-Encoding": "chunked",
      "Access-Control-Allow-Origin": "*",
    });

    let clientAlive = true;
    req.on("close", () => { clientAlive = false; });

    (async () => {
      // Phase 1: wait for .tmp to reach MIN_START_BYTES (or job completes).
      while (clientAlive && Date.now() < deadline) {
        if (fs.existsSync(cachedPath)) break; // rename already happened
        try { if (fs.statSync(tmpPath).size >= MIN_START_BYTES) break; } catch {}
        if (!activeJobs.has(jobKey) && !fs.existsSync(tmpPath) && !fs.existsSync(cachedPath)) break;
        await new Promise(r => setTimeout(r, 200));
      }

      if (!clientAlive) { try { res.end(); } catch {} return; }

      // Phase 2: tail-stream bytes from the live file, polling for more
      // until the .opus file appears and we've drained all bytes.
      // Single drain listener registered once — avoids MaxListenersExceeded
      // that occurred when res.once('drain') was added inside each loop iteration.
      let offset = 0;
      let activeReadStream = null;
      const onResDrain = () => { if (activeReadStream) activeReadStream.resume(); };
      res.on("drain", onResDrain);

      while (clientAlive && Date.now() < deadline) {
        const livePath = fs.existsSync(cachedPath) ? cachedPath : tmpPath;
        let size = 0;
        try { size = fs.statSync(livePath).size; } catch {}

        if (size > offset) {
          await new Promise((resolve) => {
            const stream = fs.createReadStream(livePath, { start: offset, end: size - 1 });
            activeReadStream = stream;
            stream.on("data", (chunk) => {
              if (!res.write(chunk)) stream.pause();
            });
            stream.on("end", () => { activeReadStream = null; resolve(); });
            stream.on("error", (e) => {
              // ENOENT = .tmp renamed to .opus mid-read, non-fatal.
              activeReadStream = null;
              if (e.code !== "ENOENT") clientAlive = false;
              resolve(null);
            });
          });
          offset = size;
        }

        // Done once we've sent all bytes from the finalized .opus file.
        if (fs.existsSync(cachedPath)) {
          let cacheSize = 0;
          try { cacheSize = fs.statSync(cachedPath).size; } catch {}
          if (offset >= cacheSize && cacheSize >= CACHE_MIN_BYTES) break;
        }

        if (!clientAlive) break;
        // Bail if the active job is gone and no files exist — extraction failed.
        // avoids waiting 120s for the deadline when FFmpeg was killed early.
        if (!activeJobs.has(jobKey) && !fs.existsSync(tmpPath) && !fs.existsSync(cachedPath)) break;
        await new Promise(r => setTimeout(r, 200));
      }

      res.off("drain", onResDrain);
      try { res.end(); } catch {}
    })();
    return;
  }

  // 4. Concurrency gate — protect VPS from FFmpeg herd.
  if (activeJobs.size >= MAX_CONCURRENT_FFMPEG) {
    console.log(`[VOYO] At capacity (${activeJobs.size}/${MAX_CONCURRENT_FFMPEG}) — rejecting ${trackId}`);
    res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "5" });
    res.end(JSON.stringify({ error: "Server at capacity, retry in 5s" }));
    return;
  }

  // 5. Live extraction via pipe-tee.
  const extractStart = Date.now();
  activeJobs.set(jobKey, { status: "extracting", started: extractStart });
  postTelemetry("trace", trackId, { subtype: "vps_extract_start", quality });

  let upstream;
  try {
    upstream = await openUpstream(trackId);
  } catch (e) {
    activeJobs.delete(jobKey);
    console.error(`[VOYO] Extraction failed: ${e.message}`);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Extraction failed" }));
    return;
  }

  if (!upstream) {
    activeJobs.delete(jobKey);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Track not found or unavailable" }));
    return;
  }

  activeJobs.set(jobKey, { status: "processing", started: Date.now() });

  // v2.3 — activeJobs leak fix. Previous revision leaked slots when FFmpeg
  // hung waiting for stdin that never arrived (upstream returned a Readable
  // that immediately errored AFTER being assigned — pipe took, bytes never
  // flowed, ffmpeg waited forever, never emitted 'close', activeJobs.delete
  // never fired). Observed: MAX_CONCURRENT_FFMPEG=6 slots permanently
  // occupied by dead trackIds, every subsequent cold request blocked.
  //
  // Defenses: (a) a single `releaseJob(reason)` that the close / error /
  // safety paths all funnel through, idempotent. (b) 180s safety timer
  // that force-kills FFmpeg if it hangs. (c) upstream pre-broken check
  // before piping. (d) ffmpeg.on('error') handler for spawn/runtime errors
  // that don't produce a 'close' event.
  const tmpPath = `${cachedPath}.tmp`;
  let jobCleaned = false;
  const releaseJob = (reason) => {
    if (jobCleaned) return;
    jobCleaned = true;
    activeJobs.delete(jobKey);
    console.log(`[VOYO] Released slot ${jobKey} (${reason})`);
  };

  // Early-out: upstream arrived already-broken.
  if (upstream.destroyed || upstream.readableEnded === true) {
    releaseJob("upstream_prebroken");
    console.error(`[VOYO] Upstream ${trackId} arrived pre-ended/destroyed`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Upstream pre-ended" }));
    return;
  }

  // FFmpeg: reads from stdin, writes Opus/Ogg to stdout. Two-pass loudnorm
  // params (measured_I/TP/LRA) tell FFmpeg to use the declared values
  // without running a measurement pass — keeps one-pass output streamable.
  const ffmpeg = spawn("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", "pipe:0",
    "-af", "loudnorm=I=-14:TP=-1:LRA=11:measured_I=-14:measured_TP=-1:measured_LRA=11:linear=true",
    "-c:a", "libopus",
    "-b:a", bitrate,
    "-vbr", "on",
    "-compression_level", "10",
    "-frame_duration", "60",
    "-application", "audio",
    "-ar", "48000",
    "-vn",
    "-f", "ogg",
    "-",
  ], { stdio: ["pipe", "pipe", "pipe"] });

  // v2.3 — ffmpeg lifecycle errors that don't fire 'close' (spawn error,
  // runtime crash) would leak the slot without this handler.
  ffmpeg.on("error", (e) => {
    console.error(`[VOYO] FFmpeg process error (${trackId}): ${e.message}`);
    try { fileStream.end(); } catch {}
    try { fs.unlinkSync(tmpPath); } catch {}
    postTelemetry("trace", trackId, { subtype: "vps_extract_fail", quality, reason: `ffmpeg_error_${e.code || 'unknown'}`, elapsedMs: Date.now() - extractStart });
    releaseJob("ffmpeg_error");
    if (clientAlive) { try { res.end(); } catch {} }
    clearTimeout(safetyTimer);
  });

  // Absolute safety timer: if ffmpeg hasn't closed in 180s, force-kill and
  // free the slot. Catches the "upstream alive but starved" hang pattern.
  const safetyTimer = setTimeout(() => {
    if (!jobCleaned) {
      console.error(`[VOYO] Safety-timeout ${jobKey} — force-killing FFmpeg after 180s`);
      try { ffmpeg.kill("SIGKILL"); } catch {}
      try { fileStream.end(); } catch {}
      try { fs.unlinkSync(tmpPath); } catch {}
      postTelemetry("trace", trackId, { subtype: "vps_extract_fail", quality, reason: "safety_timeout_180s", elapsedMs: Date.now() - extractStart });
      releaseJob("safety_timeout");
      if (clientAlive) { try { res.end(); } catch {} }
    }
  }, 180_000);

  // Pipe upstream into FFmpeg. Upstream errors (edge worker hiccup,
  // googlevideo connection reset) close stdin; FFmpeg finishes what it
  // has, we check `upstreamTruncated` below and discard the partial
  // cache if so (FFmpeg would otherwise exit code 0 with a half-song
  // and the size check alone can't distinguish a legit 2-min track
  // from a truncated 4-min one).
  let upstreamTruncated = false;
  upstream.pipe(ffmpeg.stdin);
  upstream.on("error", (e) => {
    upstreamTruncated = true;
    console.error(`[VOYO] Upstream error (${trackId}): ${e.message}`);
    try { ffmpeg.stdin.end(); } catch {}
  });
  upstream.on("end", () => {
    // IncomingMessage.complete is false if response ended prematurely
    // (connection reset, content-length mismatch, etc.).
    if (upstream.complete === false) {
      upstreamTruncated = true;
      console.error(`[VOYO] Upstream ended incomplete (${trackId})`);
    }
  });
  ffmpeg.stdin.on("error", (e) => {
    // EPIPE is expected when upstream ends before FFmpeg consumes all —
    // harmless, FFmpeg will flush what it has.
    if (e.code !== "EPIPE") console.error(`[VOYO] FFmpeg stdin err: ${e.message}`);
  });

  const fileStream = fs.createWriteStream(tmpPath);

  res.writeHead(200, {
    "Content-Type": "audio/ogg; codecs=opus",
    "Cache-Control": "public, max-age=86400",
    "Transfer-Encoding": "chunked",
    "Access-Control-Allow-Origin": "*",
  });

  // Tee with backpressure: FFmpeg output → user response + disk.
  // When the user's TCP socket can't keep up (slow client, mobile hiccup,
  // 2G network), we PAUSE ffmpeg.stdout so Node doesn't buffer the
  // unwritten bytes in memory indefinitely. Resume on res.drain.
  //
  // Consequence: slow clients slow the extraction+cache rate too (disk
  // write lives in the same data handler). Trade-off accepted — memory
  // stays bounded, cache still completes, worst case is extraction taking
  // a few extra seconds. At scale, unbounded buffering of one slow user
  // is the catastrophic outcome, not slow-extraction.
  let clientAlive = true;
  let ffmpegPaused = false;
  ffmpeg.stdout.on("data", (chunk) => {
    if (clientAlive) {
      try {
        const ok = res.write(chunk);
        if (!ok && !ffmpegPaused) {
          ffmpegPaused = true;
          ffmpeg.stdout.pause();
        }
      } catch (e) {
        // Client disconnected while we were mid-write — stop trying
        clientAlive = false;
      }
    }
    fileStream.write(chunk);
  });
  res.on("drain", () => {
    if (ffmpegPaused) {
      ffmpegPaused = false;
      ffmpeg.stdout.resume();
    }
  });

  ffmpeg.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[VOYO] FFmpeg(${trackId}): ${msg}`);
  });

  ffmpeg.on("close", (code) => {
    clearTimeout(safetyTimer);
    fileStream.end();
    if (clientAlive) { try { res.end(); } catch {} }
    clientAlive = false; // prevent buffered data events writing to ended response
    releaseJob(`ffmpeg_close_${code}`);

    fileStream.on("finish", () => {
      let size = 0;
      try { size = fs.statSync(tmpPath).size; } catch {}

      if (code !== 0 || size < CACHE_MIN_BYTES || upstreamTruncated) {
        const reason = upstreamTruncated ? "upstream_truncated"
                      : code !== 0 ? `ffmpeg_exit_${code}`
                      : `size_${size}`;
        console.error(`[VOYO] ${trackId}/${quality} bad finalize (${reason}) — discarding`);
        try { fs.unlinkSync(tmpPath); } catch {}
        postTelemetry("trace", trackId, { subtype: "vps_extract_fail", quality, reason, elapsedMs: Date.now() - extractStart });
        return;
      }

      try {
        fs.renameSync(tmpPath, cachedPath);
        console.log(`[VOYO] Cached: ${trackId}/${quality} (${(size/1024/1024).toFixed(2)}MB)`);
        postTelemetry("trace", trackId, { subtype: "vps_extract_done", quality, bytes: size, elapsedMs: Date.now() - extractStart });
      } catch (e) {
        console.error(`[VOYO] Cache rename failed ${trackId}: ${e.message}`);
        return;
      }

      // Background R2 upload — fire and forget, cache persists regardless.
      uploadToR2(cachedPath, trackId, quality)
        .then(() => console.log(`[VOYO] R2 upload ok: ${trackId}/${quality}`))
        .catch(e => console.error(`[VOYO] R2 upload failed ${trackId}: ${e.message}`));

      // Waveform (unchanged behavior) — reads the finalized cache file.
      generateWaveform(trackId, cachedPath);
    });
  });

  req.on("close", () => {
    clientAlive = false;
    // IMPORTANT: don't kill FFmpeg when client disconnects. We want
    // /var/cache to finalize so the next request for this track is a
    // cache hit. FFmpeg continues; stdout.data just drops the user
    // leg. This reclaims the activeJobs slot when FFmpeg exits.
  });
}

// ── Upstream openers ─────────────────────────────────────────────────────

/**
 * Opens a streaming source for a trackId.
 *
 * v2.1 — Edge + yt-dlp race in parallel (Promise.any) instead of sequential.
 * When both paths are healthy, whichever resolves first wins. When edge is
 * degraded, circuit-breaker skips it entirely so we don't wait 1-2s for it
 * to fail before even starting yt-dlp.
 *
 * Edge: Cloudflare Worker /extract/{id} streams bytes back through CF.
 * yt-dlp: VPS-side wrapper reads from persistent Chrome cookies, returns
 *   a googlevideo URL signed for the VPS IP, we open it with https.get.
 *
 * Resolves with a Readable stream. Rejects only if BOTH paths fail.
 * Resolves null if yt-dlp returns no URL (track genuinely unavailable).
 *
 * Trade-off: when edge wins, yt-dlp may still be mid-flight in the
 * background. We accept the wasted work — yt-dlp exits on its own
 * schedule and the slot self-frees. Alternative (AbortController chain)
 * added non-trivial complexity for ~1-2s of CPU savings per cold miss.
 */
// ── Proxy pool ────────────────────────────────────────────────────────────
//
// VOYO_PROXY_POOL env var = JSON array of exit nodes, each running tinyproxy.
// Example:
//   export VOYO_PROXY_POOL='[
//     {"host":"1.2.3.4","port":8888,"healthPort":8889},
//     {"host":"5.6.7.8","port":8888,"healthPort":8889}
//   ]'
//
// Selection: round-robin through healthy nodes.
// Deprecate: 3 consecutive failures → node goes unhealthy for 5 min.
// Fallback: if no node is healthy, fall back to VOYO_RESIDENTIAL_PROXY
// (Webshare) so we never lose extraction capability during rollout/incident.
//
// Rebuild a flagged node: destroy the VPS, re-provision (fresh IP),
// run vps/pool/node-bootstrap.sh. Update VOYO_PROXY_POOL with the new IP
// and restart voyo-proxy.js. Whole turnaround ~10 min.
const POOL_FAIL_THRESHOLD   = 3;
const POOL_COOLDOWN_MS      = 5 * 60_000;
let POOL_NODES              = [];
let POOL_ROUND_ROBIN_IDX    = 0;
try {
  POOL_NODES = JSON.parse(process.env.VOYO_PROXY_POOL || '[]').map(n => ({
    host: n.host,
    port: parseInt(n.port, 10) || 8888,
    healthPort: n.healthPort ? parseInt(n.healthPort, 10) : null,
    failures: 0,
    unhealthyUntil: 0,
  }));
} catch (e) {
  console.error(`[VOYO] VOYO_PROXY_POOL parse error: ${e.message} — pool disabled`);
}
if (POOL_NODES.length) {
  console.log(`[VOYO] Pool nodes (${POOL_NODES.length}):`);
  POOL_NODES.forEach(n => console.log(`[VOYO]   ${n.host}:${n.port}`));
}

function _pickPoolNode() {
  if (!POOL_NODES.length) return null;
  const now = Date.now();
  // One full rotation through the ring, picking the first healthy node
  for (let i = 0; i < POOL_NODES.length; i++) {
    const idx = (POOL_ROUND_ROBIN_IDX + i) % POOL_NODES.length;
    const n = POOL_NODES[idx];
    if (n.unhealthyUntil > now) continue;
    POOL_ROUND_ROBIN_IDX = (idx + 1) % POOL_NODES.length;
    return n;
  }
  return null; // all nodes in cooldown
}
function _markPoolFailure(node, reason) {
  node.failures = (node.failures || 0) + 1;
  if (node.failures >= POOL_FAIL_THRESHOLD) {
    node.unhealthyUntil = Date.now() + POOL_COOLDOWN_MS;
    node.failures = 0;
    console.error(`[VOYO] pool ${node.host}:${node.port} DEPRECATED for ${POOL_COOLDOWN_MS/1000}s (${reason})`);
  } else {
    console.warn(`[VOYO] pool ${node.host}:${node.port} failure ${node.failures}/${POOL_FAIL_THRESHOLD} (${reason})`);
  }
}
function _markPoolSuccess(node) {
  if (node.failures > 0 || node.unhealthyUntil > 0) {
    console.log(`[VOYO] pool ${node.host}:${node.port} recovered`);
  }
  node.failures = 0;
  node.unhealthyUntil = 0;
}
function _nodeProxyUrl(node) {
  return `http://${node.host}:${node.port}`;
}

function openUpstream(trackId) {
  // 1. Try a pool node (round-robin, skip cooldowned).
  const node = _pickPoolNode();
  if (node) {
    return openUpstreamViaEndpoint(trackId, _nodeProxyUrl(node), node)
      .then(stream => { _markPoolSuccess(node); return stream; })
      .catch(err => {
        _markPoolFailure(node, err.message);
        // Fallback to Webshare if still configured
        if (PROXY_CFG) {
          console.warn(`[VOYO] pool miss → webshare fallback: ${trackId}`);
          return openUpstreamViaProxy(trackId);
        }
        throw err;
      });
  }
  // 2. No healthy pool node — fall back to Webshare if configured
  if (PROXY_CFG) return openUpstreamViaProxy(trackId).then(s => { if (!s) throw new Error('Track not available'); return s; });
  return Promise.reject(new Error('No extraction path — pool drained, no Webshare'));
}

// Residential proxy — set VOYO_RESIDENTIAL_PROXY env var (http://user:pass@host:port)
// Webshare.io ~$3.50/mo/1GB. Leave unset to skip. Pool (VOYO_PROXY_POOL) is
// the primary path; Webshare is kept only as rollout fallback.
const RESIDENTIAL_PROXY_URL = process.env.VOYO_RESIDENTIAL_PROXY || "";
function _parseProxy(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return { host: u.hostname, port: parseInt(u.port,10)||80, auth: u.username ? Buffer.from(decodeURIComponent(u.username)+":"+decodeURIComponent(u.password||"")).toString("base64") : null };
  } catch { return null; }
}
const PROXY_CFG = _parseProxy(RESIDENTIAL_PROXY_URL);
if (PROXY_CFG) console.log(`[VOYO] Residential proxy: ${PROXY_CFG.host}:${PROXY_CFG.port}`);

function openUpstreamViaProxy(trackId) {
  if (!PROXY_CFG || !RESIDENTIAL_PROXY_URL) return Promise.reject(new Error('residential_proxy_disabled'));
  return openUpstreamViaEndpoint(trackId, RESIDENTIAL_PROXY_URL, null);
}

/**
 * Extract + stream a track through an arbitrary HTTP proxy endpoint.
 *
 * Shared path for both Webshare (legacy) and pool nodes (new). Both paths:
 *   1. yt-dlp --get-url --proxy PROXY_URL  → signed googlevideo URL
 *   2. curl --proxy PROXY_URL the signed URL → Opus/webm bytes (PassThrough)
 *
 * Same proxy endpoint for both steps = same exit IP = signed URL stays
 * valid during the fetch. Any IP rotation between steps causes 403.
 *
 * @param {string} trackId
 * @param {string} proxyUrl  e.g. "http://user:pass@host:port" or "http://host:port"
 * @param {object|null} node pool node object (for telemetry); null for Webshare
 */
function openUpstreamViaEndpoint(trackId, proxyUrl, node) {
  return new Promise((resolve, reject) => {
    const _cfs = require('fs').readdirSync('/opt/voyo')
      .filter(f => /^cookies(-[0-9]+)?\.txt$/.test(f))
      .map(f => '/opt/voyo/' + f);
    const cookieFile = _cfs.length
      ? _cfs[Math.floor(Math.random() * _cfs.length)]
      : '/opt/voyo/cookies.txt';

    const sourceLabel = node ? `pool ${node.host}:${node.port}` : 'webshare';

    // Step 1: extract signed audio URL through proxy
    const cmd = `/usr/local/bin/yt-dlp -f "bestaudio[vcodec=none]/bestaudio" --get-url --no-warnings --proxy "${proxyUrl}" --cookies "${cookieFile}" --extractor-args "youtube:player_client=tv_embedded" "https://www.youtube.com/watch?v=${trackId}"`;
    exec(cmd, { timeout: 40_000 }, (err, stdout, stderr) => {
      const stderrStr = (stderr || '').toString();
      if (stderrStr.includes('Sign in to confirm')) return reject(new Error(`${sourceLabel}: bot_challenge`));
      if (err) return reject(new Error(`${sourceLabel} yt-dlp: ${err.message}`));
      const lines = (stdout || '').split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
      if (!lines.length) return reject(new Error(`${sourceLabel}: no URL extracted`));
      const ITAG_RE = /[?&]itag=(25[012]|140|141|139|233|234|599|600)(&|$)/;
      const audioUrl = lines.find(l => ITAG_RE.test(l))
        || lines.find(l => l.includes('mime=audio%2F') || l.includes('mime=audio/'))
        || lines[lines.length - 1];

      // Step 2: download via curl through the SAME proxy.
      const curl = spawn('curl', [
        '--proxy', proxyUrl,
        '--range', '0-',
        '--silent',
        '--location',
        '--max-time', '180',
        audioUrl,
      ]);

      let resolved = false;
      const bt = setTimeout(() => {
        if (!resolved) { curl.kill('SIGKILL'); reject(new Error(`${sourceLabel} curl: no first byte in 20s`)); }
      }, 20_000);

      const pass = new PassThrough();
      curl.stdout.pipe(pass);

      pass.once('readable', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(bt);
          console.log(`[VOYO] ${sourceLabel} piping: ${trackId}`);
          resolve(pass);
        }
      });

      curl.stderr.on('data', (d) => {
        const s = d.toString().trim();
        if (s) console.error(`[VOYO] ${sourceLabel} curl stderr (${trackId}): ${s}`);
      });
      curl.on('error', (e) => { clearTimeout(bt); if (!resolved) reject(new Error(`${sourceLabel} curl spawn: ${e.message}`)); });
      curl.on('close', (code) => {
        clearTimeout(bt);
        if (!resolved) reject(new Error(`${sourceLabel} curl exited ${code} before first byte`));
      });
    });
  });
}


// ── Cache serving (complete file) ────────────────────────────────────────

function serveFromCache(req, res, filePath, size) {
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (start >= 0 && end < size && start <= end) {
        res.writeHead(206, {
          "Content-Type": "audio/ogg; codecs=opus",
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": end - start + 1,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*",
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
    }
    // Malformed range — fall through to full response.
  }

  res.writeHead(200, {
    "Content-Type": "audio/ogg; codecs=opus",
    "Content-Length": size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
    "Access-Control-Allow-Origin": "*",
  });
  fs.createReadStream(filePath).pipe(res);
}

// ── R2 helpers (unchanged from v1) ───────────────────────────────────────

function checkR2(url) {
  return new Promise((resolve) => {
    const getter = url.startsWith("https") ? https : http;
    const r = getter.request(url, { method: "HEAD", timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    r.on("error", () => resolve(false));
    r.on("timeout", () => { r.destroy(); resolve(false); });
    r.end();
  });
}

async function uploadToR2(filePath, trackId, quality) {
  const buf = fs.readFileSync(filePath);
  const url = `${R2_BASE}/upload/${trackId}?q=${quality}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "audio/ogg" },
    body: buf,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── Waveform (unchanged logic, reads from new cache dir) ─────────────────

function generateWaveform(trackId, audioPath) {
  const outFile = `${TMP_DIR}/${trackId}-waveform.json`;
  const cmd = `ffmpeg -i "${audioPath}" -ac 1 -filter:a "aresample=8000" -f s16le -acodec pcm_s16le pipe:1`;
  exec(cmd, { timeout: 30_000, encoding: "buffer", maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
    if (err || !stdout || stdout.length < 100) {
      console.error(`[VOYO] Waveform generation failed: ${err?.message || "empty output"}`);
      return;
    }
    try {
      const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
      const POINTS = 128;
      const chunkSize = Math.floor(samples.length / POINTS);
      const waveform = [];
      for (let i = 0; i < POINTS; i++) {
        let peak = 0;
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, samples.length);
        for (let j = start; j < end; j++) {
          const abs = Math.abs(samples[j]);
          if (abs > peak) peak = abs;
        }
        waveform.push(Math.round((peak / 32768) * 1000) / 1000);
      }
      fs.writeFileSync(outFile, JSON.stringify({ trackId, waveform, points: POINTS }));
      console.log(`[VOYO] Waveform generated: ${trackId}`);
    } catch (e) {
      console.error(`[VOYO] Waveform parse failed: ${e.message}`);
    }
  });
}

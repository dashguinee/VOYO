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

const PORT = 8443;
const R2_BASE = "https://voyo-edge.dash-webtv.workers.dev";
const EDGE_EXTRACT = "https://voyo-edge.dash-webtv.workers.dev/extract";

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

// v2.1 — Edge worker circuit breaker. When the Cloudflare worker returns
// 502 repeatedly (YouTube bot-checking CF's IPs), stop wasting 1-2s per
// request waiting for it to fail. After 3 consecutive failures, skip
// the edge path entirely for 60s and go straight to yt-dlp.
const EDGE_CIRCUIT_THRESHOLD = 3;
const EDGE_CIRCUIT_COOLDOWN_MS = 60_000;
let edgeConsecutiveFailures = 0;
let edgeCircuitOpenUntil = 0;
function isEdgeCircuitOpen() { return Date.now() < edgeCircuitOpenUntil; }
function recordEdgeFailure() {
  edgeConsecutiveFailures++;
  if (edgeConsecutiveFailures >= EDGE_CIRCUIT_THRESHOLD) {
    edgeCircuitOpenUntil = Date.now() + EDGE_CIRCUIT_COOLDOWN_MS;
    edgeConsecutiveFailures = 0;
    console.log(`[VOYO] Edge circuit OPEN for ${EDGE_CIRCUIT_COOLDOWN_MS/1000}s`);
  }
}
function recordEdgeSuccess() { edgeConsecutiveFailures = 0; edgeCircuitOpenUntil = 0; }

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

  if (url.pathname === "/health" || url.pathname === "/voyo/health") {
    const jobs = Object.fromEntries([...activeJobs.entries()].map(([k, v]) => [k, v.status]));
    const edgeCircuit = isEdgeCircuitOpen()
      ? { open: true, reopensInMs: edgeCircuitOpenUntil - Date.now() }
      : { open: false, consecutiveFailures: edgeConsecutiveFailures };
    let cacheStats = null;
    try {
      const entries = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith(".opus"));
      let bytes = 0;
      entries.forEach(f => { try { bytes += fs.statSync(`${CACHE_DIR}/${f}`).size; } catch {} });
      cacheStats = { count: entries.length, bytes };
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "voyo-audio",
      version: "v2.1-circuit-race",
      uptime: process.uptime(),
      activeJobs: activeJobs.size,
      jobs,
      edgeCircuit,
      cache: cacheStats,
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
      res.writeHead(302, { Location: r2Url });
      res.end();
      return;
    }
  } catch (e) {
    console.log(`[VOYO] R2 check failed, proceeding with extraction: ${e.message}`);
  }

  // 3. In-flight dedup — poll the cache path, serve when the live
  //    extraction finalizes it. Previously we polled activeJobs and
  //    redirected to R2, but R2 upload trails the cache rename by
  //    seconds; /var/cache is authoritative the moment .tmp → .opus.
  if (activeJobs.has(jobKey)) {
    console.log(`[VOYO] Already extracting ${jobKey} — waiting on cache`);
    const waitStart = Date.now();
    const poll = setInterval(() => {
      if (fs.existsSync(cachedPath)) {
        try {
          const stat = fs.statSync(cachedPath);
          if (stat.size >= CACHE_MIN_BYTES) {
            clearInterval(poll);
            serveFromCache(req, res, cachedPath, stat.size);
            return;
          }
        } catch {}
      }
      if (Date.now() - waitStart > 120_000) {
        // v2.1 — bumped from 30s to 120s to cover full-track transcodes.
        // A 4-5 minute song can take 60-90s to fully transcode with
        // two-pass loudnorm, so the .opus rename lands well after 30s.
        // 120s covers the vast majority of real tracks.
        clearInterval(poll);
        const r2Url = `${R2_BASE}/audio/${trackId}?q=${quality}`;
        res.writeHead(302, { Location: r2Url });
        res.end();
      }
    }, 300);
    req.on("close", () => clearInterval(poll));
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
  activeJobs.set(jobKey, { status: "extracting", started: Date.now() });

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

  // Pipe upstream into FFmpeg. Upstream errors (edge worker hiccup,
  // googlevideo connection reset) close stdin; FFmpeg finishes what it
  // has, we check size below and discard if truncated.
  upstream.pipe(ffmpeg.stdin);
  upstream.on("error", (e) => {
    console.error(`[VOYO] Upstream error (${trackId}): ${e.message}`);
    try { ffmpeg.stdin.end(); } catch {}
  });
  ffmpeg.stdin.on("error", (e) => {
    // EPIPE is expected when upstream ends before FFmpeg consumes all —
    // harmless, FFmpeg will flush what it has.
    if (e.code !== "EPIPE") console.error(`[VOYO] FFmpeg stdin err: ${e.message}`);
  });

  const tmpPath = `${cachedPath}.tmp`;
  const fileStream = fs.createWriteStream(tmpPath);

  res.writeHead(200, {
    "Content-Type": "audio/ogg; codecs=opus",
    "Cache-Control": "public, max-age=86400",
    "Transfer-Encoding": "chunked",
    "Access-Control-Allow-Origin": "*",
  });

  let clientAlive = true;
  ffmpeg.stdout.on("data", (chunk) => {
    if (clientAlive) {
      if (!res.write(chunk)) {
        // Backpressure on the user side. Don't block FFmpeg or the
        // cache write — just stop fanning to the user until drain.
        // This means a slow client can fall behind; we accept that
        // because caching always completes at FFmpeg's rate.
      }
    }
    fileStream.write(chunk);
  });

  ffmpeg.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[VOYO] FFmpeg(${trackId}): ${msg}`);
  });

  ffmpeg.on("close", (code) => {
    fileStream.end();
    if (clientAlive) { try { res.end(); } catch {} }
    activeJobs.delete(jobKey);

    fileStream.on("finish", () => {
      let size = 0;
      try { size = fs.statSync(tmpPath).size; } catch {}

      if (code !== 0 || size < CACHE_MIN_BYTES) {
        console.error(`[VOYO] ${trackId}/${quality} bad finalize (code=${code}, size=${size}) — discarding`);
        try { fs.unlinkSync(tmpPath); } catch {}
        return;
      }

      try {
        fs.renameSync(tmpPath, cachedPath);
        console.log(`[VOYO] Cached: ${trackId}/${quality} (${(size/1024/1024).toFixed(2)}MB)`);
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
function openUpstream(trackId) {
  const candidates = [];

  if (!isEdgeCircuitOpen()) {
    candidates.push(openUpstreamViaEdge(trackId));
  } else {
    console.log(`[VOYO] Edge circuit open, skipping edge: ${trackId}`);
  }
  candidates.push(openUpstreamViaYtdlp(trackId));

  // Promise.any — first success wins; only rejects if ALL candidates reject.
  // Filter nulls (yt-dlp returned no URL) as successful-but-unavailable.
  return Promise.any(candidates).then((stream) => {
    if (!stream) throw new Error("Track not available");
    return stream;
  });
}

function openUpstreamViaEdge(trackId) {
  return new Promise((resolve, reject) => {
    const edgeUrl = `${EDGE_EXTRACT}/${trackId}`;
    console.log(`[VOYO] Opening upstream via edge worker: ${trackId}`);
    const edgeReq = https.get(edgeUrl, { timeout: 15_000 }, (edgeRes) => {
      if (edgeRes.statusCode === 200 || edgeRes.statusCode === 206) {
        recordEdgeSuccess();
        resolve(edgeRes);
        return;
      }
      edgeRes.resume();
      console.log(`[VOYO] Edge ${edgeRes.statusCode}: ${trackId}`);
      recordEdgeFailure();
      reject(new Error(`Edge returned ${edgeRes.statusCode}`));
    });
    edgeReq.on("error", (e) => {
      console.log(`[VOYO] Edge err (${e.message}): ${trackId}`);
      recordEdgeFailure();
      reject(e);
    });
    edgeReq.on("timeout", () => {
      edgeReq.destroy();
      console.log(`[VOYO] Edge timeout: ${trackId}`);
      recordEdgeFailure();
      reject(new Error("Edge timeout"));
    });
  });
}

function openUpstreamViaYtdlp(trackId) {
  return new Promise((resolve, reject) => {
    const cmd = `/usr/local/bin/yt-dlp-safe -f "bestaudio" --get-url --no-warnings --geo-bypass "https://www.youtube.com/watch?v=${trackId}"`;
    exec(cmd, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error("[VOYO] yt-dlp err:", err?.message, "stderr:", stderr?.toString()?.slice(0, 300));
        return reject(new Error("Both extraction methods failed"));
      }
      const url = (stdout || "").trim();
      if (!url || !url.startsWith("http")) return resolve(null);

      const ytReq = https.get(url, { timeout: 30_000 }, (ytRes) => {
        if (ytRes.statusCode >= 200 && ytRes.statusCode < 300) {
          resolve(ytRes);
          return;
        }
        ytRes.resume();
        reject(new Error(`googlevideo returned ${ytRes.statusCode}`));
      });
      ytReq.on("error", (e) => reject(new Error(`googlevideo fetch failed: ${e.message}`)));
      ytReq.on("timeout", () => { ytReq.destroy(); reject(new Error("googlevideo timeout")); });
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

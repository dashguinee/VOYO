/**
 * voyo-stream.js — Continuous audio streaming sessions for VOYO
 *
 * Why this exists:
 *   The browser was doing too much — source resolution, preloading, BG
 *   heartbeats, stall recovery, error recovery. All of that complexity
 *   exists because the browser was acting as a streaming server. Move it
 *   here. Browser plays one stream. VPS manages the pipeline.
 *
 * Architecture:
 *   POST /voyo/session/create          → { sessionId, streamUrl, eventsUrl }
 *   GET  /voyo/stream/:sessionId       → chunked OGG/Opus (one persistent connection)
 *   GET  /voyo/events/:sessionId       → SSE stream (now_playing, queue_needed, ...)
 *   POST /voyo/session/:id/skip        → skip current track
 *   POST /voyo/session/:id/queue       → { tracks: [{ trackId, title, artist, duration }] }
 *   GET  /voyo/sessions/health         → debug: active sessions + warming count
 *
 * Source priority per track (same as voyo-proxy.js):
 *   1. /var/cache/voyo hot-tier — local disk, instant
 *   2. R2 collective cache — download to /var/cache, then stream
 *   3. yt-dlp cold extraction — via voyo-proxy.js internal call (localhost:8443)
 *
 * Pre-extraction: as soon as track N starts playing, track N+1 is already
 * being extracted in the background. By the time track N ends, track N+1
 * is on disk. Zero-latency track transitions for cached/R2 tracks.
 *
 * OGG chaining: OGG format supports sequential streams (chained OGG). Chrome
 * and Firefox handle this natively — each track's EOS/BOS pages tell the
 * decoder to reset for the next track. One HTTP response, multiple tracks.
 *
 * All logs here. One place to tail. No browser telemetry needed for pipeline
 * debugging — the VPS sees everything: extraction latency, skip events,
 * queue states, errors.
 *
 * No external npm dependencies — pure Node.js built-ins only.
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

// ── Config ────────────────────────────────────────────────────────────────

const PORT          = 8444;
const CACHE_DIR     = '/var/cache/voyo';
const CACHE_MIN_BYTES = 300_000;         // < this = corrupt file, discard
const R2_BASE       = 'https://voyo-edge.dash-webtv.workers.dev';
const PROXY_BASE    = 'https://localhost:8443'; // voyo-proxy.js internal
const PRE_WARM      = 2;                 // tracks ahead to pre-extract
const QUEUE_LOW     = 3;                 // ask browser for more below this
const SESSION_TTL   = 30 * 60_000;      // 30 min idle before cleanup
const BUFFER_AHEAD  = 60;               // send 60s ahead of real-time — reduces rate-limiter pause frequency on mobile

const ssl = {
  key:  fs.readFileSync('/etc/letsencrypt/live/stream.zionsynapse.online/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/stream.zionsynapse.online/fullchain.pem'),
};

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * @typedef {{ trackId: string, title: string, artist: string, duration?: number }} QueueItem
 * @typedef {{
 *   id: string,
 *   queue: QueueItem[],
 *   quality: string,
 *   active: boolean,
 *   streamRes: import('http').ServerResponse | null,
 *   sseRes:    import('http').ServerResponse | null,
 *   skipEmitter: EventEmitter,
 *   currentTrackId: string | null,
 *   currentTrack: QueueItem | null,
 *   trackStartedAt: number,
 *   history: Array<{ track: QueueItem, startedAt: number, endedAt: number }>,
 *   skipCount: number,
 *   createdAt: number,
 *   lastActivityAt: number,
 * }} Session
 */

/** @type {Map<string, Session>} */
const sessions = new Map();

/** Tracks currently being extracted — deduplicates work across sessions */
const globalWarming = new Set(); // key = `${trackId}-${quality}`

// ── Logging ───────────────────────────────────────────────────────────────

function log(sessionId, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[STREAM ${ts}] [${sessionId.slice(0, 8)}] ${msg}`);
}
function logGlobal(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[STREAM ${ts}] ${msg}`);
}

// ── SSE helpers ───────────────────────────────────────────────────────────

function sseSend(session, obj) {
  if (!session.sseRes) return;
  try {
    session.sseRes.write(`data: ${JSON.stringify(obj)}\n\n`);
  } catch {}
}

// ── Cache helpers ─────────────────────────────────────────────────────────

function cachePath(trackId, quality) {
  return path.join(CACHE_DIR, `${trackId}-${quality}.opus`);
}

function isCached(trackId, quality) {
  try {
    const p = cachePath(trackId, quality);
    return fs.existsSync(p) && fs.statSync(p).size >= CACHE_MIN_BYTES;
  } catch { return false; }
}

/**
 * Find the first OGG page boundary at-or-after `approxByte`.
 *
 * Chrome/Firefox demuxers require a valid OGG "capture pattern" ("OggS", 4B)
 * at the start of the stream bytes they receive on a new connection. If we
 * resume mid-file from an arbitrary byte offset, the first page header is
 * mid-word → MEDIA_ELEMENT_ERROR / DEMUXER_ERROR_COULD_NOT_OPEN → browser
 * reloads src → we re-resume at another arbitrary offset → infinite error
 * loop on a single track.
 *
 * Scan window: 128 KB. OGG max page size is 65307 B (27-byte header + up to
 * 255×255 B payload per Opus spec). One window covers at least one boundary
 * for a sane stream.
 *
 * Returns the aligned byte offset, or 0 if no boundary found (degraded but
 * always decodable — user hears the track restart).
 */
function findOggPageBoundary(filePath, approxByte, fileSize) {
  if (approxByte <= 0) return 0;
  const WINDOW = 128 * 1024;
  const start = Math.min(approxByte, Math.max(0, fileSize - 4));
  const len   = Math.min(WINDOW, Math.max(0, fileSize - start));
  if (len < 4) return 0;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, start);
    for (let i = 0; i + 4 <= n; i++) {
      // "OggS" = 0x4F 0x67 0x67 0x53
      if (buf[i] === 0x4F && buf[i+1] === 0x67 && buf[i+2] === 0x67 && buf[i+3] === 0x53) {
        return start + i;
      }
    }
    return 0;
  } catch {
    return 0;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

async function waitForCache(trackId, quality, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const p = cachePath(trackId, quality);
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).size >= CACHE_MIN_BYTES) return p;
    } catch {}
    await sleep(300);
  }
  throw new Error(`cache miss after ${timeoutMs}ms: ${trackId}`);
}

// ── Track extraction ──────────────────────────────────────────────────────

/**
 * Ensure a track file exists at /var/cache/voyo.
 * Priority: local cache → R2 download → voyo-proxy cold extraction.
 * Deduplicates: if another session is already extracting, wait for it.
 */
async function ensureExtracted(trackId, quality) {
  if (isCached(trackId, quality)) return cachePath(trackId, quality);

  const key = `${trackId}-${quality}`;
  if (globalWarming.has(key)) {
    logGlobal(`waiting for in-flight extraction: ${trackId}`);
    return waitForCache(trackId, quality, 90_000);
  }

  globalWarming.add(key);
  try {
    // 1. R2 hit — download directly to /var/cache (no redirect to browser)
    const r2Url = `${R2_BASE}/audio/${trackId}?q=${quality}`;
    const r2Ok = await r2Head(r2Url);
    if (r2Ok) {
      logGlobal(`R2 → cache: ${trackId}@${quality}`);
      await r2Download(r2Url, cachePath(trackId, quality));
      if (isCached(trackId, quality)) return cachePath(trackId, quality);
    }

    // 2. Cold extraction via voyo-proxy (yt-dlp → FFmpeg → /var/cache side effect)
    logGlobal(`cold extract via proxy: ${trackId}@${quality}`);
    await proxyExtract(trackId, quality);
    return await waitForCache(trackId, quality, 10_000);
  } finally {
    globalWarming.delete(key);
  }
}

/** Pre-warm a track without blocking — fire and forget */
function warmTrack(trackId, quality) {
  if (!trackId || isCached(trackId, quality)) return;
  const key = `${trackId}-${quality}`;
  if (globalWarming.has(key)) return;
  ensureExtracted(trackId, quality).catch(e =>
    logGlobal(`pre-warm failed ${trackId}: ${e.message}`)
  );
}

// ── HTTP helpers ──────────────────────────────────────────────────────────

function r2Head(url) {
  return new Promise(resolve => {
    const req = https.request(url, { method: 'HEAD', timeout: 4000 }, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function r2Download(url, destPath) {
  return new Promise((resolve, reject) => {
    const tmp = `${destPath}.r2.tmp`;
    const file = fs.createWriteStream(tmp);
    https.get(url, { timeout: 60_000 }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`R2 download ${res.statusCode}: ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            const size = fs.statSync(tmp).size;
            if (size >= CACHE_MIN_BYTES) {
              fs.renameSync(tmp, destPath);
              resolve();
            } else {
              try { fs.unlinkSync(tmp); } catch {}
              reject(new Error(`R2 download too small (${size}B): ${url}`));
            }
          } catch (e) { reject(e); }
        });
      });
      file.on('error', e => { try { fs.unlinkSync(tmp); } catch {} reject(e); });
    }).on('error', e => { try { fs.unlinkSync(tmp); } catch {} reject(e); });
  });
}

function proxyExtract(trackId, quality) {
  // voyo-proxy.js handles yt-dlp + FFmpeg and writes to /var/cache as a side
  // effect. We consume the response stream but don't use the bytes — we wait
  // for /var/cache to appear via waitForCache().
  return new Promise((resolve, reject) => {
    const req = https.get(
      `${PROXY_BASE}/voyo/audio/${trackId}?quality=${quality}`,
      { rejectUnauthorized: false, timeout: 90_000 },
      res => { res.resume(); res.on('end', resolve); res.on('error', reject); }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('proxy extract timeout')); });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 200_000) { req.destroy(); reject(new Error('body too large')); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Session loop ──────────────────────────────────────────────────────────

async function runSession(session) {
  const { id } = session;

  while (session.active) {
    session.lastActivityAt = Date.now();

    // Queue empty — request more from browser, wait
    if (session.queue.length === 0) {
      log(id, 'queue empty — requesting tracks from browser');
      sseSend(session, { type: 'queue_needed', queueLength: 0 });
      // Wait up to 5 min for tracks to arrive
      const deadline = Date.now() + 5 * 60_000;
      while (session.active && session.queue.length === 0 && Date.now() < deadline) {
        await sleep(400);
      }
      if (!session.active) break;
      if (session.queue.length === 0) {
        log(id, 'no tracks received — ending session');
        break;
      }
      continue;
    }

    const track = session.queue.shift();
    // Archive previous track to history (cap at 20)
    if (session.currentTrack) {
      session.history.push({ track: session.currentTrack, startedAt: session.trackStartedAt, endedAt: Date.now() });
      if (session.history.length > 20) session.history.shift();
    }
    session.currentTrackId  = track.trackId;
    session.currentTrack    = track;
    session.trackStartedAt  = Date.now();
    session.lastActivityAt  = Date.now();

    // Warm full remaining queue while this track plays (no-op for already-cached)
    session.queue.forEach(t => warmTrack(t.trackId, session.quality));

    // Request refill if queue is running low
    if (session.queue.length < QUEUE_LOW) {
      sseSend(session, { type: 'queue_needed', queueLength: session.queue.length });
    }

    // If not cached, ensure it gets extracted before playing.
    // ensureExtracted() handles all cases: in-flight dedup (globalWarming),
    // R2 download, and cold proxy extraction. Never skip a track just because
    // nobody pre-warmed it — that caused inter-track silence for late queue adds
    // and any track whose warmTrack fired but extraction failed silently.
    if (!isCached(track.trackId, session.quality)) {
      log(id, `extracting before play: ${track.trackId}`);
      sseSend(session, { type: 'track_warming', trackId: track.trackId });
      try {
        await ensureExtracted(track.trackId, session.quality);
      } catch (e) {
        log(id, `extraction failed — skipping: ${track.trackId}: ${e.message}`);
        sseSend(session, { type: 'track_failed', trackId: track.trackId, error: 'extraction_failed' });
        continue;
      }
    }

    const filePath = cachePath(track.trackId, session.quality);

    log(id, `now_playing: ${track.trackId} "${track.title || '—'}" by ${track.artist || '—'}`);
    sseSend(session, {
      type: 'now_playing',
      startedAt: Date.now(),
      trackId: track.trackId,
      title:   track.title   ?? null,
      artist:  track.artist  ?? null,
      duration: track.duration ?? null,
      queueLength: session.queue.length,
    });

    try {
      log(id, `streaming: ${track.trackId}`);
      await pipeTrack(session, filePath, track.trackId);
      log(id, `track done: ${track.trackId}`);
    } catch (e) {
      log(id, `stream error: ${track.trackId} — ${e.message}`);
      sseSend(session, { type: 'track_failed', trackId: track.trackId, error: e.message });
      // Skip to next track — loop continues naturally
    }
  }

  // Clean up
  session.active = false;
  try { session.streamRes?.end(); } catch {}
  try { session.sseRes?.end(); }    catch {}
  sessions.delete(id);
  log(id, 'session ended');
}

/**
 * Pipe one cached .opus file into the session's streaming HTTP response.
 * Resolves on EOF or when a skip signal fires.
 *
 * Background reconnect: if the client drops (TCP close in background) but
 * the session survives the grace period, pipeTrack pauses the file read and
 * waits for a 'reconnect' signal. On reconnect it restarts from byte 0 so
 * the new TCP connection receives a valid OGG stream from the beginning.
 */
function pipeTrack(session, filePath, trackId) {
  return new Promise((resolve, reject) => {
    let done = false;
    let currentStream = null;
    let pipeStartAt   = Date.now(); // shared across reconnects for elapsed-time seek
    let fileSize      = 0;
    let drainRes      = null; // response that owns current drain listener
    let drainFn       = null; // current drain listener (for clean removal)
    try { fileSize = fs.statSync(filePath).size; } catch {}

    const finish = (reason) => {
      if (done) return;
      done = true;
      session.skipEmitter.removeListener('skip', onSkip);
      session.skipEmitter.removeListener('reconnect', onReconnect);
      if (currentStream) { currentStream.destroy(); currentStream = null; }
      if (drainFn && drainRes) { try { drainRes.off('drain', drainFn); } catch {} }
      resolve();
    };

    const onSkip = () => {
      log(session.id, `skip mid-track: ${trackId}`);
      session._skipReconnect = true; // next reconnect on new track must start from byte 0
      finish('skip');
    };

    const onReconnect = () => {
      if (done) return;
      if (currentStream) { currentStream.destroy(); currentStream = null; }
      // Remove drain listener from old response to avoid MaxListeners leak
      if (drainFn && drainRes) { try { drainRes.off('drain', drainFn); } catch {} drainFn = null; drainRes = null; }

      // Skip reconnect: browser reloaded audio.src to flush skip buffer.
      // New track starts at byte 0 — always an OGG page boundary.
      // Background reconnect: resume near elapsed position but align to the next
      // OGG page boundary so the browser demuxer gets a valid stream (arbitrary
      // byte offsets cause DEMUXER_ERROR_COULD_NOT_OPEN and a retry-loop storm).
      let startByte = 0;
      if (session._skipReconnect) {
        session._skipReconnect = false;
        log(session.id, `client reconnected after skip — ${trackId} from byte 0`);
      } else {
        const rawReconnDur = session.currentTrack?.duration;
        const trackDur = (rawReconnDur && rawReconnDur > 0) ? rawReconnDur : Math.ceil(fileSize / 16_000);
        let offsetSecs = 0;
        let approxByte = 0;
        if (fileSize > 0) {
          offsetSecs = Math.max(0, Math.min((Date.now() - pipeStartAt) / 1000, trackDur - 1));
          approxByte = Math.floor((offsetSecs / trackDur) * fileSize);
        }
        startByte = findOggPageBoundary(filePath, approxByte, fileSize);
        log(session.id, `client reconnected — resuming ${trackId} at ${Math.round(offsetSecs)}s (page-aligned byte ${startByte})`);
      }
      startFileStream(startByte);
    };

    const startFileStream = (startByte = 0) => {
      // 16KB chunks ≈ 1s of audio at 128kbps — fine-grained rate control.
      // Default 64KB chunks = 4s each, which caused buffer underruns on first read.
      const streamOpts = { highWaterMark: 16 * 1024, ...(startByte > 0 ? { start: startByte } : {}) };
      const stream = fs.createReadStream(filePath, streamOpts);
      currentStream = stream;

      let bytesSent  = startByte;
      let rateTimer  = null;
      // Fallback: estimate duration from file size at ~128kbps Opus if not provided.
      // This keeps the rate limiter active even when the client sends no duration.
      const rawDur   = session.currentTrack?.duration;
      const trackDur = (rawDur && rawDur > 0) ? rawDur : Math.ceil(fileSize / 16_000);

      // Remove old drain listener, register on the new response
      if (drainFn && drainRes) { try { drainRes.off('drain', drainFn); } catch {} }
      const capturedRes = session.streamRes;
      drainRes = capturedRes;
      if (capturedRes) {
        drainFn = () => { if (!done && currentStream === stream && !rateTimer) stream.resume(); };
        capturedRes.on('drain', drainFn);
      } else {
        drainFn = null;
      }

      stream.on('data', chunk => {
        if (done) return;
        if (!session.active) { finish('session_ended'); return; }
        if (!session.streamRes) {
          stream.pause();
          return;
        }

        // Stay at most BUFFER_AHEAD seconds ahead of real-time.
        // This keeps pipeTrack alive for the track's actual duration so runSession
        // advances at the right pace. Skip flushes the buffer via audio.src reload.
        if (trackDur && fileSize > 0) {
          bytesSent += chunk.length;
          const secondsSent  = (bytesSent / fileSize) * trackDur;
          const secondsAhead = secondsSent - (Date.now() - pipeStartAt) / 1000;
          if (secondsAhead > BUFFER_AHEAD) {
            stream.pause();
            const waitMs = Math.max(100, (secondsAhead - BUFFER_AHEAD) * 1000);
            rateTimer = setTimeout(() => {
              rateTimer = null;
              if (!done && session.streamRes) stream.resume();
            }, waitMs);
          }
        }

        const canContinue = session.streamRes.write(chunk);
        if (!canContinue) stream.pause();
      });

      stream.on('end', () => {
        if (rateTimer) { clearTimeout(rateTimer); rateTimer = null; }
        finish('eof');
      });
      stream.on('error', e => {
        if (rateTimer) { clearTimeout(rateTimer); rateTimer = null; }
        if (!done) { done = true; reject(e); }
      });
    };

    session.skipEmitter.once('skip', onSkip);
    session.skipEmitter.on('reconnect', onReconnect);
    startFileStream();
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────

const server = https.createServer(ssl, async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  };
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  let url;
  try { url = new URL(req.url, 'https://localhost'); }
  catch { res.writeHead(400); res.end('bad url'); return; }

  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify(obj));
  };

  // ── POST /voyo/warm — pre-warm tracks before session starts ──────────────
  // Client calls this with the planned queue IDs right before startSession.
  // Kicks off R2 downloads in background so by session create time tracks
  // are already cached. Continue-listening tracks are no-ops (isCached guard).
  if (url.pathname === '/voyo/warm' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { trackIds = [], quality = 'high' } = JSON.parse(body);
      const fresh = trackIds.filter(id => !isCached(id, quality));
      fresh.forEach(id => warmTrack(id, quality));
      json(200, { warming: fresh.length, alreadyCached: trackIds.length - fresh.length });
    } catch (e) {
      json(400, { error: e.message });
    }
    return;
  }

  // ── POST /voyo/session/create ──────────────────────────────────────────
  if (url.pathname === '/voyo/session/create' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { queue = [], quality = 'high', platform = 'unknown' } = JSON.parse(body);

      const sessionId = crypto.randomUUID();
      /** @type {Session} */
      const session = {
        id: sessionId,
        queue: queue.map(t => ({ trackId: t.trackId, title: t.title, artist: t.artist, duration: t.duration })),
        quality,
        platform,
        active: true,
        streamRes: null,
        sseRes: null,
        skipEmitter: new EventEmitter(),
        currentTrackId: null,
        currentTrack: null,
        trackStartedAt: 0,
        history: [],
        skipCount: 0,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        disconnectTimer: null, // grace-period timer on stream drop
        running: false,        // true once runSession is in flight
      };
      sessions.set(sessionId, session);

      // Warm the ENTIRE initial queue now — R2 downloads are fast (~2-8s each)
      // and run concurrently. By the time runSession reaches track 3+, they
      // should be ready. isCached() short-circuits for continue-listening tracks
      // (already on disk from prior sessions) — no wasted bandwidth.
      session.queue.forEach(t => warmTrack(t.trackId, quality));

      logGlobal(`session created: ${sessionId} | ${session.queue.length} tracks | quality=${quality} | platform=${platform}`);

      json(200, {
        sessionId,
        streamUrl: `https://stream.zionsynapse.online:${PORT}/voyo/stream/${sessionId}`,
        eventsUrl: `https://stream.zionsynapse.online:${PORT}/voyo/events/${sessionId}`,
      });
    } catch (e) {
      logGlobal(`session create error: ${e.message}`);
      json(400, { error: e.message });
    }
    return;
  }

  // ── GET /voyo/stream/:sessionId ────────────────────────────────────────
  const streamMatch = url.pathname.match(/^\/voyo\/stream\/([a-zA-Z0-9-]+)$/);
  if (streamMatch && req.method === 'GET') {
    const session = sessions.get(streamMatch[1]);
    if (!session)        { json(404, { error: 'session not found or expired' }); return; }
    // If old connection is still registered, tear it down — browser reconnected
    // before the TCP close event fired (race on network hiccup / tab resume).
    if (session.streamRes) {
      // DON'T call .end() on the old response — sending the HTTP terminal
      // chunk causes the browser's <audio> to fire 'ended' → handleEnded
      // sets el.src again → new GET → loop. The client already moved on.
      // Destroy the socket instead (RST, no FIN/terminal chunk) so the
      // server-side TCP connection closes without signalling end-of-stream.
      const stale = session.streamRes;
      session.streamRes = null;
      log(session.id, 'replaced stale stream connection');
      try { stale.socket?.destroy(); } catch {}
    }

    // Clear any pending grace-period kill timer (client reconnected in time)
    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = null;
      log(session.id, 'client reconnected within grace period');
    }

    session.streamRes = res;
    session.lastActivityAt = Date.now();

    res.writeHead(200, {
      'Content-Type':     'audio/ogg; codecs=opus',
      'Transfer-Encoding': 'chunked',
      'Cache-Control':    'no-cache, no-store',
      'X-Session-Id':     session.id,
      ...cors,
    });

    req.on('close', () => {
      // Guard: only null out streamRes if THIS connection is still the active one.
      // When we replace a stale connection (409 fix), the old req's close fires
      // AFTER we've already set session.streamRes to the new res — don't clobber it.
      if (session.streamRes !== res) return;
      log(session.id, 'audio client disconnected — 60s grace period');
      session.streamRes = null;
      // Don't kill the session immediately — give 60s for background reconnect.
      // pipeTrack will pause the file read and wait for the 'reconnect' signal.
      if (!session.disconnectTimer) {
        session.disconnectTimer = setTimeout(() => {
          session.disconnectTimer = null;
          if (!session.streamRes && session.active) {
            log(session.id, 'grace period expired — ending session');
            session.active = false;
            session.skipEmitter.emit('skip'); // unblock pipeTrack
          }
        }, 60_000);
      }
    });

    if (!session.running) {
      // First connection — start the session loop
      session.running = true;
      setImmediate(() => {
        runSession(session).catch(e => {
          logGlobal(`runSession error [${session.id}]: ${e.message}`);
        });
      });
    } else {
      // Reconnect — pipeTrack is paused waiting for this signal
      session.skipEmitter.emit('reconnect');
    }
    return;
  }

  // ── GET /voyo/events/:sessionId (SSE) ─────────────────────────────────
  const eventsMatch = url.pathname.match(/^\/voyo\/events\/([a-zA-Z0-9-]+)$/);
  if (eventsMatch && req.method === 'GET') {
    const session = sessions.get(eventsMatch[1]);
    if (!session) { json(404, { error: 'session not found' }); return; }

    session.sseRes = res;
    session.lastActivityAt = Date.now();

    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      ...cors,
    });

    // Keep-alive comment every 15s so proxies don't time out
    const keepAlive = setInterval(() => {
      try { res.write(': keep-alive\n\n'); } catch {}
    }, 15_000);

    // Send current state immediately (browser might reconnect mid-session)
    if (session.currentTrackId) {
      sseSend(session, {
        type: 'now_playing',
        trackId:     session.currentTrackId,
        title:       session.currentTrack?.title    ?? null,
        artist:      session.currentTrack?.artist   ?? null,
        duration:    session.currentTrack?.duration ?? null,
        queueLength: session.queue.length,
      });
    }

    req.on('close', () => {
      clearInterval(keepAlive);
      if (session.sseRes === res) session.sseRes = null;
      log(session.id, 'SSE client disconnected');
    });
    return;
  }

  // ── POST /voyo/session/:id/skip ────────────────────────────────────────
  const skipMatch = url.pathname.match(/^\/voyo\/session\/([a-zA-Z0-9-]+)\/skip$/);
  if (skipMatch && req.method === 'POST') {
    const session = sessions.get(skipMatch[1]);
    if (!session) { json(404, { error: 'session not found' }); return; }
    log(session.id, 'skip via POST');
    session.skipCount++;
    session.skipEmitter.emit('skip');
    session.lastActivityAt = Date.now();
    json(200, { ok: true });
    return;
  }

  // ── POST /voyo/session/:id/queue ───────────────────────────────────────
  const queueMatch = url.pathname.match(/^\/voyo\/session\/([a-zA-Z0-9-]+)\/queue$/);
  if (queueMatch && req.method === 'POST') {
    const session = sessions.get(queueMatch[1]);
    if (!session) { json(404, { error: 'session not found' }); return; }
    try {
      const body = await readBody(req);
      const { tracks = [], priority = false } = JSON.parse(body);
      const added = tracks.map(t => ({
        trackId: t.trackId, title: t.title, artist: t.artist, duration: t.duration,
      }));
      if (priority) {
        session.queue.unshift(...added); // push to FRONT
      } else {
        session.queue.push(...added);    // push to back (existing behaviour)
      }
      session.lastActivityAt = Date.now();
      log(session.id, `queue ${priority ? 'PRIORITY ' : ''}+= ${added.length} tracks (total: ${session.queue.length})`);

      // Warm all newly added tracks (isCached short-circuits for hot tracks)
      added.forEach(t => warmTrack(t.trackId, session.quality));

      sseSend(session, { type: 'queue_updated', queueLength: session.queue.length });
      json(200, { ok: true, queueLength: session.queue.length });
    } catch (e) {
      json(400, { error: e.message });
    }
    return;
  }

  // ── GET /voyo/admin/now_playing ────────────────────────────────────────
  // All active sessions, current track, elapsed, queue — the "eyes" endpoint.
  if (url.pathname === '/voyo/admin/now_playing') {
    const now = Date.now();
    json(200, {
      activeSessions: sessions.size,
      warming: globalWarming.size,
      warmingTracks: [...globalWarming],
      sessions: [...sessions.values()].map(s => ({
        sessionId:    s.id,
        active:       s.active,
        connected:    !!s.streamRes,
        sseConnected: !!s.sseRes,
        quality:      s.quality,
        nowPlaying: s.currentTrack ? {
          trackId:   s.currentTrack.trackId,
          title:     s.currentTrack.title,
          artist:    s.currentTrack.artist,
          duration:  s.currentTrack.duration,
          elapsedSec: Math.round((now - s.trackStartedAt) / 1000),
          startedAt: new Date(s.trackStartedAt).toISOString(),
        } : null,
        queue:        s.queue.map(t => ({ trackId: t.trackId, title: t.title, artist: t.artist })),
        queueLength:  s.queue.length,
        skipCount:    s.skipCount,
        history:      s.history.slice(-5).map(h => ({
          trackId:   h.track.trackId,
          title:     h.track.title,
          artist:    h.track.artist,
          playedSec: Math.round((h.endedAt - h.startedAt) / 1000),
        })),
        uptimeSec:    Math.round((now - s.createdAt) / 1000),
        idleSec:      Math.round((now - s.lastActivityAt) / 1000),
      })),
    });
    return;
  }

  // ── GET /voyo/admin/session/:id ────────────────────────────────────────
  // Full detail on one session including full history.
  const adminSessionMatch = url.pathname.match(/^\/voyo\/admin\/session\/([a-zA-Z0-9-]+)$/);
  if (adminSessionMatch && req.method === 'GET') {
    const session = sessions.get(adminSessionMatch[1]);
    if (!session) { json(404, { error: 'session not found' }); return; }
    const now = Date.now();
    json(200, {
      sessionId:    session.id,
      active:       session.active,
      connected:    !!session.streamRes,
      sseConnected: !!session.sseRes,
      quality:      session.quality,
      createdAt:    new Date(session.createdAt).toISOString(),
      uptimeSec:    Math.round((now - session.createdAt) / 1000),
      nowPlaying: session.currentTrack ? {
        trackId:   session.currentTrack.trackId,
        title:     session.currentTrack.title,
        artist:    session.currentTrack.artist,
        duration:  session.currentTrack.duration,
        elapsedSec: Math.round((now - session.trackStartedAt) / 1000),
        startedAt: new Date(session.trackStartedAt).toISOString(),
      } : null,
      queue:        session.queue,
      skipCount:    session.skipCount,
      history:      session.history.map(h => ({
        trackId:   h.track.trackId,
        title:     h.track.title,
        artist:    h.track.artist,
        duration:  h.track.duration,
        startedAt: new Date(h.startedAt).toISOString(),
        playedSec: Math.round((h.endedAt - h.startedAt) / 1000),
      })),
    });
    return;
  }

  // ── GET /voyo/admin/cache ──────────────────────────────────────────────
  // What's on local disk — trackIds, sizes, freshness.
  if (url.pathname === '/voyo/admin/cache') {
    try {
      const files = fs.readdirSync(CACHE_DIR)
        .filter(f => f.endsWith('.opus'))
        .map(f => {
          const full = path.join(CACHE_DIR, f);
          const stat = fs.statSync(full);
          return {
            file:     f,
            trackId:  f.replace(/-high\.opus$|,-low\.opus$/, '').replace(/-\w+\.opus$/, ''),
            sizeMB:   (stat.size / 1_048_576).toFixed(2),
            ageMin:   Math.round((Date.now() - stat.mtimeMs) / 60_000),
          };
        })
        .sort((a, b) => a.ageMin - b.ageMin); // freshest first
      json(200, { count: files.length, files });
    } catch (e) {
      json(500, { error: e.message });
    }
    return;
  }

  // ── GET /voyo/sessions/health (kept for backwards compat) ─────────────
  if (url.pathname === '/voyo/sessions/health') {
    json(200, {
      sessions: sessions.size,
      warming: globalWarming.size,
      warmingTracks: [...globalWarming],
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found. See: POST /voyo/session/create');
});

// ── Stale session cleanup ─────────────────────────────────────────────────
// Sessions without a stream connection for SESSION_TTL are leaked — clean up.
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (!session.streamRes && now - session.lastActivityAt > SESSION_TTL) {
      session.active = false;
      try { session.sseRes?.end(); } catch {}
      sessions.delete(id);
      logGlobal(`cleaned stale session: ${id}`);
    }
  }
}, 5 * 60_000);

// ── Cache eviction ────────────────────────────────────────────────────────
// Cap /var/cache/voyo at CACHE_MAX_BYTES. Delete oldest files (by mtime)
// until under the limit. Runs every 30 min.
const CACHE_MAX_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

function evictCache() {
  try {
    const files = fs.readdirSync(CACHE_DIR)
      .filter(f => f.endsWith('.opus'))
      .map(f => {
        const p = path.join(CACHE_DIR, f);
        const stat = fs.statSync(p);
        return { path: p, mtime: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => a.mtime - b.mtime); // oldest first

    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    if (totalBytes <= CACHE_MAX_BYTES) return;

    let freed = 0;
    const toFree = totalBytes - CACHE_MAX_BYTES;
    for (const f of files) {
      if (freed >= toFree) break;
      try { fs.unlinkSync(f.path); freed += f.size; logGlobal(`evicted: ${path.basename(f.path)} (${(f.size/1e6).toFixed(1)}MB)`); } catch {}
    }
    logGlobal(`cache eviction: freed ${(freed/1e9).toFixed(2)}GB, total was ${(totalBytes/1e9).toFixed(2)}GB`);
  } catch (e) {
    logGlobal(`cache eviction error: ${e.message}`);
  }
}

setInterval(evictCache, 30 * 60_000);
evictCache(); // run once on boot

// ── Boot ──────────────────────────────────────────────────────────────────
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o755 });

server.listen(PORT, () => {
  logGlobal(`streaming session server on :${PORT}`);
  logGlobal(`cache dir: ${CACHE_DIR}`);
  logGlobal(`proxy: ${PROXY_BASE}`);
});

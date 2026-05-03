#!/usr/bin/env node
/**
 * VOYO Music — Production Health Check
 *
 * Usage:
 *   node scripts/health-check.cjs            # full check, human-readable
 *   node scripts/health-check.cjs --json     # machine-readable JSON (CI/cron)
 *   node scripts/health-check.cjs --quick    # skip slow Piped checks
 *
 * Checks:
 *   1. All Piped API instances  (piped.ts: 7 instances)
 *   2. R2 edge worker           (voyo-edge.dash-webtv.workers.dev)
 *   3. Supabase connectivity    (voyo_playback_events count)
 *   4. Error rate last hour     (play_fail / stream_error from Supabase)
 *   5. Queue health             (stuck pending jobs in voyo_upload_queue)
 *
 * Env vars (read from .env in repo root):
 *   VITE_SUPABASE_URL       — Supabase REST endpoint
 *   VITE_SUPABASE_ANON_KEY  — read-only anon key (enough for SELECT)
 *   SUPABASE_SERVICE_KEY    — full admin key (used for queue + error rate queries)
 */

'use strict';

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

// ── Flags ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const JSON_MODE  = args.includes('--json');
const QUICK_MODE = args.includes('--quick');

// ── Env loading (.env in repo root) ──────────────────────────────────────────
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    log('warn', '.env not found — set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY manually');
    return;
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const SUPABASE_URL  = (process.env.VITE_SUPABASE_URL  || '').replace(/\/$/, '');
const ANON_KEY      = process.env.VITE_SUPABASE_ANON_KEY || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY || ANON_KEY; // fall back to anon for read-only queries

// ── Constants (mirroring source files) ────────────────────────────────────────
// piped.ts: PIPED_INSTANCES
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi-libre.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://piped-api.privacy.com.de',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.syncpundit.io',
  'https://pipedapi.tokhmi.xyz',
];

// r2Probe.ts / voyoStream.ts / api.ts: all agree on this base
const R2_EDGE_BASE = 'https://voyo-edge.dash-webtv.workers.dev';

// A known-good track in R2 to HEAD-check audio delivery.
// DEbGRu24BoA is confirmed r2_cached=true in video_intelligence.
// If this ever 404s legitimately, update to any other r2_cached=true youtube_id.
const R2_PROBE_TRACK_ID = 'DEbGRu24BoA';

const TABLE_EVENTS = 'voyo_playback_events';
const TABLE_QUEUE  = 'voyo_upload_queue';

// ── Result accumulator ────────────────────────────────────────────────────────
const results = {
  ts:       new Date().toISOString(),
  overall:  'ok',  // 'ok' | 'degraded' | 'down'
  checks:   [],
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function log(level, ...args) {
  if (JSON_MODE) return;
  const prefix = { ok: '✓', warn: '⚠', error: '✗', info: '·' }[level] || '·';
  console.log(`  ${prefix} ${args.join(' ')}`);
}

function header(title) {
  if (!JSON_MODE) console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 54 - title.length))}`);
}

/** Fire a GET/HEAD with a hard timeout. Returns { status, latency, ok, body? }. */
function httpProbe(urlStr, { method = 'GET', timeoutMs = 5000, wantBody = false } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const parsed = new URL(urlStr);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(
      { hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search, method, headers: { 'User-Agent': 'VOYO-HealthCheck/1.0' } },
      (res) => {
        const latency = Date.now() - t0;
        if (!wantBody) {
          res.resume();
          resolve({ status: res.statusCode, latency, ok: res.statusCode >= 200 && res.statusCode < 400 });
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode, latency, ok: res.statusCode >= 200 && res.statusCode < 400,
                    body: Buffer.concat(chunks).toString('utf8') });
        });
      }
    );
    req.on('error', (e) => resolve({ status: 0, latency: Date.now() - t0, ok: false, error: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, latency: timeoutMs, ok: false, error: 'timeout' }); });
    req.end();
  });
}

/** Supabase REST query helper. Returns { data, error }. */
async function supabaseQuery(path, { key = SERVICE_KEY } = {}) {
  if (!SUPABASE_URL || !key) return { data: null, error: 'Supabase not configured' };
  const r = await httpProbe(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'GET',
    timeoutMs: 8000,
    wantBody: true,
    // httpProbe doesn't support custom headers natively; use a wrapper
  }).catch(e => ({ ok: false, error: e.message, body: null }));

  // httpProbe doesn't allow custom headers — use a proper fetch via https.request
  return supabaseFetch(`/rest/v1/${path}`, key);
}

/** Low-level Supabase fetch that supports custom headers. */
function supabaseFetch(pathAndQuery, key) {
  return new Promise((resolve) => {
    if (!SUPABASE_URL || !key) {
      resolve({ data: null, error: 'Supabase not configured' });
      return;
    }
    const parsed = new URL(SUPABASE_URL + pathAndQuery);
    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json',
        'User-Agent': 'VOYO-HealthCheck/1.0',
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve({ data: JSON.parse(body), error: null }); }
          catch { resolve({ data: null, error: `JSON parse failed: ${body.slice(0, 100)}` }); }
        } else {
          resolve({ data: null, error: `HTTP ${res.statusCode}: ${body.slice(0, 200)}` });
        }
      });
    });
    req.on('error', e => resolve({ data: null, error: e.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ data: null, error: 'timeout' }); });
    req.end();
  });
}

function addCheck(name, status, detail, extra = {}) {
  // status: 'ok' | 'degraded' | 'down'
  results.checks.push({ name, status, detail, ...extra });
  if (status === 'down' && results.overall !== 'down') results.overall = 'down';
  if (status === 'degraded' && results.overall === 'ok') results.overall = 'degraded';
}

// ── Check 1: Piped Instances ───────────────────────────────────────────────────
async function checkPipedInstances() {
  header('Piped API Instances');
  if (QUICK_MODE) {
    log('info', 'Skipped (--quick)');
    addCheck('piped_instances', 'ok', 'skipped (--quick)');
    return;
  }

  const probes = await Promise.all(
    PIPED_INSTANCES.map(async (instance) => {
      // /healthcheck is not universally supported; /trending returns 200 on healthy instances
      const r = await httpProbe(`${instance}/trending?region=US`, { method: 'GET', timeoutMs: 6000 });
      return { instance, ...r };
    })
  );

  const up = probes.filter(p => p.ok);
  const down = probes.filter(p => !p.ok);

  for (const p of probes) {
    const tag = p.ok ? 'ok' : 'error';
    const latStr = p.ok ? `${p.latency}ms` : (p.error || `HTTP ${p.status}`);
    log(tag, `${p.instance.replace('https://pipedapi.', '').replace('https://piped-api.', '')} — ${latStr}`);
  }

  const fastestUp = up.sort((a, b) => a.latency - b.latency)[0];

  if (up.length === 0) {
    addCheck('piped_instances', 'down', 'All 7 Piped instances unreachable', {
      up: 0, total: PIPED_INSTANCES.length,
    });
  } else if (down.length > 0) {
    addCheck('piped_instances', 'degraded',
      `${up.length}/${PIPED_INSTANCES.length} up — fastest: ${fastestUp?.instance} (${fastestUp?.latency}ms)`,
      { up: up.length, total: PIPED_INSTANCES.length, down_instances: down.map(d => d.instance) }
    );
  } else {
    addCheck('piped_instances', 'ok',
      `All ${PIPED_INSTANCES.length} up — fastest: ${fastestUp?.instance} (${fastestUp?.latency}ms)`,
      { up: up.length, total: PIPED_INSTANCES.length }
    );
  }
}

// ── Check 2: R2 Edge Worker ────────────────────────────────────────────────────
async function checkR2Edge() {
  header('R2 Audio Edge Worker');

  // 2a: health ping on the worker root
  const ping = await httpProbe(`${R2_EDGE_BASE}/`, { method: 'GET', timeoutMs: 5000 });
  log(ping.ok ? 'ok' : 'error', `Worker root — HTTP ${ping.status} (${ping.latency}ms)`);

  // 2b: HEAD a known track to verify audio delivery pipeline end-to-end
  const audioUrl = `${R2_EDGE_BASE}/audio/${R2_PROBE_TRACK_ID}?q=high&_v=${Date.now()}`;
  const audio = await httpProbe(audioUrl, { method: 'HEAD', timeoutMs: 5000 });
  log(audio.ok ? 'ok' : 'error',
    `Audio probe (${R2_PROBE_TRACK_ID}) — HTTP ${audio.status} (${audio.latency}ms)`
  );

  // 2c: /exists endpoint (used by SearchOverlayV2)
  const exists = await httpProbe(`${R2_EDGE_BASE}/exists/${R2_PROBE_TRACK_ID}`, { method: 'GET', timeoutMs: 5000 });
  log(exists.ok ? 'ok' : 'error', `/exists endpoint — HTTP ${exists.status} (${exists.latency}ms)`);

  if (!ping.ok && !audio.ok) {
    addCheck('r2_edge_worker', 'down',
      `Worker unreachable — root ${ping.status}, audio ${audio.status}`,
      { ping_ms: ping.latency, audio_ms: audio.latency }
    );
  } else if (!audio.ok) {
    addCheck('r2_edge_worker', 'degraded',
      `Worker up but audio probe failed (${audio.status}) — R2 bucket may be empty or track evicted`,
      { ping_ms: ping.latency, audio_status: audio.status, audio_ms: audio.latency }
    );
  } else {
    addCheck('r2_edge_worker', 'ok',
      `Worker healthy — audio ${audio.latency}ms, /exists ${exists.latency}ms`,
      { ping_ms: ping.latency, audio_ms: audio.latency, exists_ms: exists.latency }
    );
  }
}

// ── Check 3: Supabase Connectivity ────────────────────────────────────────────
async function checkSupabase() {
  header('Supabase Connectivity');

  if (!SUPABASE_URL || !ANON_KEY) {
    log('warn', 'VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set — skipping');
    addCheck('supabase_connectivity', 'degraded', 'env vars not set');
    return;
  }

  // Simple: count events in the last minute (tiny result, fast)
  const { data, error } = await supabaseFetch(
    `/rest/v1/${TABLE_EVENTS}?select=id&created_at=gte.${new Date(Date.now() - 60_000).toISOString()}&limit=1`,
    ANON_KEY
  );

  if (error) {
    log('error', `Supabase query failed: ${error}`);
    addCheck('supabase_connectivity', 'down', `Query error: ${error}`);
    return;
  }

  log('ok', `Supabase reachable — ${TABLE_EVENTS} accessible`);
  addCheck('supabase_connectivity', 'ok', `${TABLE_EVENTS} accessible`);
}

// ── Check 4: Error Rate Last Hour ─────────────────────────────────────────────
async function checkErrorRate() {
  header('Error Rate (last 60 min)');

  if (!SUPABASE_URL || !SERVICE_KEY) {
    log('warn', 'SERVICE_KEY not set — skipping error rate check');
    addCheck('error_rate', 'degraded', 'SUPABASE_SERVICE_KEY not set');
    return;
  }

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // Total events in the last hour (denominator)
  const { data: totalData, error: totalError } = await supabaseFetch(
    `/rest/v1/${TABLE_EVENTS}?select=id&created_at=gte.${since}`,
    SERVICE_KEY
  );

  // Error events only: play_fail + stream_error
  const { data: errorData, error: errorErr } = await supabaseFetch(
    `/rest/v1/${TABLE_EVENTS}?select=event_type,error_code,track_id&created_at=gte.${since}&event_type=in.(play_fail,stream_error)`,
    SERVICE_KEY
  );

  // Window errors from errorReporter.ts  (subtype=window_error or unhandled_rejection)
  const { data: jsErrors, error: jsErr } = await supabaseFetch(
    `/rest/v1/${TABLE_EVENTS}?select=meta,created_at&created_at=gte.${since}&event_type=eq.trace`,
    SERVICE_KEY
  );

  if (totalError || errorErr) {
    log('error', `Query failed: ${totalError || errorErr}`);
    addCheck('error_rate', 'degraded', `Query error: ${totalError || errorErr}`);
    return;
  }

  const total = Array.isArray(totalData) ? totalData.length : 0;
  const errors = Array.isArray(errorData) ? errorData.length : 0;
  const windowErrors = Array.isArray(jsErrors)
    ? jsErrors.filter(e => {
        const s = e.meta?.subtype;
        return s === 'window_error' || s === 'unhandled_rejection';
      }).length
    : 0;

  const rate = total > 0 ? ((errors / total) * 100).toFixed(1) : '0.0';
  const rateNum = parseFloat(rate);

  // Break down error codes
  const byCode = {};
  if (Array.isArray(errorData)) {
    for (const e of errorData) {
      const k = e.error_code || 'unknown';
      byCode[k] = (byCode[k] || 0) + 1;
    }
  }

  log(rateNum < 5 ? 'ok' : rateNum < 20 ? 'warn' : 'error',
    `${errors} errors / ${total} events = ${rate}% error rate`
  );
  log(windowErrors > 0 ? 'warn' : 'ok',
    `${windowErrors} JS runtime errors (window_error + unhandled_rejection)`
  );

  if (Object.keys(byCode).length > 0) {
    log('info', `Error breakdown: ${Object.entries(byCode).map(([k, v]) => `${k}:${v}`).join(', ')}`);
  }

  const status = rateNum >= 20 ? 'down' : rateNum >= 5 ? 'degraded' : 'ok';
  addCheck('error_rate', status,
    `${rate}% (${errors}/${total} events) — ${windowErrors} JS errors`,
    { total_events: total, error_events: errors, js_errors: windowErrors,
      error_rate_pct: rateNum, by_error_code: byCode }
  );
}

// ── Check 5: Upload Queue Health ──────────────────────────────────────────────
async function checkQueueHealth() {
  header('Upload Queue Health');

  if (!SUPABASE_URL || !SERVICE_KEY) {
    log('warn', 'SERVICE_KEY not set — skipping queue check');
    addCheck('upload_queue', 'degraded', 'SUPABASE_SERVICE_KEY not set');
    return;
  }

  // Stuck = pending rows created > 30 min ago (workers claim in seconds normally)
  const stuckSince = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: stuckData, error: stuckErr } = await supabaseFetch(
    `/rest/v1/${TABLE_QUEUE}?select=youtube_id,status,created_at,priority&status=eq.pending&created_at=lte.${stuckSince}&order=priority.desc&limit=10`,
    SERVICE_KEY
  );

  // Failed rows in the last 24h
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: failedData, error: failedErr } = await supabaseFetch(
    `/rest/v1/${TABLE_QUEUE}?select=youtube_id,status&status=eq.failed&created_at=gte.${dayAgo}`,
    SERVICE_KEY
  );

  // Currently processing (workers holding a claim)
  const { data: processingData } = await supabaseFetch(
    `/rest/v1/${TABLE_QUEUE}?select=youtube_id&status=eq.processing`,
    SERVICE_KEY
  );

  if (stuckErr) {
    log('warn', `Queue query failed: ${stuckErr}`);
    addCheck('upload_queue', 'degraded', `Query error: ${stuckErr}`);
    return;
  }

  const stuck = Array.isArray(stuckData) ? stuckData.length : 0;
  const failed = Array.isArray(failedData) ? failedData.length : 0;
  const processing = Array.isArray(processingData) ? processingData.length : 0;

  log(stuck === 0 ? 'ok' : 'warn', `${stuck} stuck pending (>30 min old)`);
  log(failed < 10 ? 'ok' : 'warn', `${failed} failed rows in last 24h`);
  log('info', `${processing} currently processing`);

  const status = stuck > 20 || failed > 50 ? 'degraded' : 'ok';
  addCheck('upload_queue', status,
    `${stuck} stuck, ${failed} failed/24h, ${processing} processing`,
    { stuck, failed_24h: failed, processing }
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  if (!JSON_MODE) {
    console.log('\nVOYO Music — Production Health Check');
    console.log(`${'═'.repeat(58)}`);
    console.log(`  ${new Date().toUTCString()}`);
    if (QUICK_MODE) console.log('  Mode: quick (Piped checks skipped)');
  }

  await checkPipedInstances();
  await checkR2Edge();
  await checkSupabase();
  await checkErrorRate();
  await checkQueueHealth();

  // ── Summary ──────────────────────────────────────────────────────────────────
  if (!JSON_MODE) {
    console.log('\n' + '═'.repeat(58));
    const icon = results.overall === 'ok' ? '✓' : results.overall === 'degraded' ? '⚠' : '✗';
    const color = results.overall === 'ok' ? '' : results.overall === 'degraded' ? '' : '';
    console.log(`  ${icon} Overall: ${results.overall.toUpperCase()}`);
    console.log('');

    for (const c of results.checks) {
      const sym = c.status === 'ok' ? '✓' : c.status === 'degraded' ? '⚠' : '✗';
      console.log(`  ${sym} ${c.name.padEnd(24)} ${c.detail}`);
    }
    console.log('');

    if (results.overall !== 'ok') {
      console.log('  Failing checks:');
      for (const c of results.checks.filter(c => c.status !== 'ok')) {
        console.log(`    • [${c.status}] ${c.name}: ${c.detail}`);
      }
      console.log('');
    }
  } else {
    console.log(JSON.stringify(results, null, 2));
  }

  process.exit(results.overall === 'down' ? 2 : results.overall === 'degraded' ? 1 : 0);
}

main().catch(e => {
  console.error('Health check crashed:', e);
  process.exit(3);
});

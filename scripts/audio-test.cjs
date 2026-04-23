#!/usr/bin/env node
/**
 * VOYO Audio Debug CLI
 *
 * Usage:
 *   node scripts/audio-test.cjs                  # last session timeline
 *   node scripts/audio-test.cjs --bg             # detect background failures
 *   node scripts/audio-test.cjs --r2 <ytId>      # probe + ffprobe an R2 track
 *   node scripts/audio-test.cjs --live           # tail events in real time
 *   node scripts/audio-test.cjs --session <id>   # replay a specific session
 *   node scripts/audio-test.cjs --gaps           # find all advancement gaps today
 */

'use strict';

const https  = require('https');
const { execSync, spawnSync } = require('child_process');

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL    = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co';
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTk3MTc0MCwiZXhwIjoyMDgxNTQ3NzQwfQ.R01xDTxUs9oOirsiJIHXE_cLujY49rU8oJmTNhB_dQY';
const R2_BASE         = 'https://voyo-edge.dash-webtv.workers.dev/audio';
const TABLE           = 'voyo_playback_events';

// ── ANSI colors ───────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  gray:   '\x1b[90m',
};
const ok   = (s) => `${c.green}✓${c.reset} ${s}`;
const fail = (s) => `${c.red}✗${c.reset} ${s}`;
const warn = (s) => `${c.yellow}⚠${c.reset} ${s}`;
const info = (s) => `${c.cyan}→${c.reset} ${s}`;
const dim  = (s) => `${c.dim}${s}${c.reset}`;
const bold = (s) => `${c.bold}${s}${c.reset}`;

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function supaGet(path, params = {}) {
  const qs = new URLSearchParams({ ...params, limit: params.limit || '200' }).toString();
  const url = `${SUPABASE_URL}/rest/v1/${path}?${qs}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`JSON parse fail: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpHead(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : require('http');
    const req = mod.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'HEAD',
      headers: { 'User-Agent': 'voyo-debug/1' }
    }, (res) => resolve({ status: res.statusCode, headers: res.headers }));
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.setTimeout(4000, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.end();
  });
}

// ── Time helpers ──────────────────────────────────────────────────────────────
function ts(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function gap(a, b) {
  return ((new Date(b) - new Date(a)) / 1000).toFixed(1) + 's';
}
function gapMs(a, b) {
  return new Date(b) - new Date(a);
}

// ── Event coloring ────────────────────────────────────────────────────────────
const EVENT_COLOR = {
  play_start:     c.green,
  play_success:   c.green,
  stream_ended:   c.yellow,
  stream_error:   c.red,
  stream_stall:   c.red,
  play_fail:      c.red,
  skip_auto:      c.yellow,
  trace:          c.gray,
  bg_disconnect:  c.red,
  bg_reconnect:   c.green,
};
function colorEvent(e) {
  const col = EVENT_COLOR[e] || c.white;
  return `${col}${e}${c.reset}`;
}

// ── Subtype detection ─────────────────────────────────────────────────────────
function subtype(ev) {
  return ev.meta?.subtype || '';
}

// ── MODES ─────────────────────────────────────────────────────────────────────

// ── 1. Last session timeline ──────────────────────────────────────────────────
async function lastSession() {
  console.log(bold('\n== VOYO Last Session Timeline ==\n'));

  // Get last 300 events (enough for one full session)
  const rows = await supaGet(TABLE, {
    select: 'id,created_at,event_type,track_id,track_title,track_artist,source,error_code,latency_ms,is_background,session_id,meta',
    order: 'created_at.desc',
    limit: '300',
  });

  if (!rows.length) { console.log(warn('No events found')); return; }

  // Group by session_id (most recent session first)
  const sessions = {};
  for (const r of rows) {
    const sid = r.session_id || 'unknown';
    if (!sessions[sid]) sessions[sid] = [];
    sessions[sid].push(r);
  }

  const latestSid = Object.keys(sessions)[0];
  const events = sessions[latestSid].reverse(); // chronological

  console.log(info(`Session: ${c.cyan}${latestSid}${c.reset}  (${events.length} events)`));
  console.log(info(`Period:  ${ts(events[0].created_at)} → ${ts(events[events.length - 1].created_at)}\n`));

  let currentTrack = null;
  let lastPlayStart = null;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const next = events[i + 1];

    // Track change header
    if (ev.event_type === 'play_start') {
      if (currentTrack !== ev.track_id) {
        currentTrack = ev.track_id;
        const title = ev.track_title || ev.track_id.slice(0, 12);
        const artist = ev.track_artist ? ` — ${ev.track_artist}` : '';
        console.log(`\n${c.bold}${c.blue}♪ ${title}${artist}${c.reset}  ${dim(ev.track_id)}`);
      }
      lastPlayStart = ev.created_at;
    }

    const bg    = ev.is_background ? `${c.yellow}[BG]${c.reset} ` : '     ';
    const sub   = subtype(ev) ? ` ${dim(subtype(ev))}` : '';
    const src   = ev.source ? ` ${c.cyan}src:${ev.source}${c.reset}` : '';
    const err   = ev.error_code ? ` ${c.red}err:${ev.error_code}${c.reset}` : '';
    const lat   = ev.latency_ms ? ` ${dim(ev.latency_ms + 'ms')}` : '';
    const meta  = ev.meta && Object.keys(ev.meta).length > 0
      ? ` ${dim(JSON.stringify(ev.meta).slice(0, 80))}`
      : '';

    // Gap detection between events
    if (next && ev.event_type !== 'trace') {
      const gapSec = gapMs(ev.created_at, next.created_at) / 1000;
      if (gapSec > 10 && !ev.meta?.hidden) {
        console.log(`  ${c.red}⚡ GAP ${gapSec.toFixed(1)}s — possible BG silence${c.reset}`);
      }
    }

    console.log(`  ${dim(ts(ev.created_at))} ${bg}${colorEvent(ev.event_type)}${sub}${src}${err}${lat}${meta}`);
  }

  // Summary
  const plays = events.filter(e => e.event_type === 'play_start').length;
  const errors = events.filter(e => e.event_type === 'stream_error' || e.event_type === 'play_fail').length;
  const bgEvents = events.filter(e => e.is_background).length;
  const iframeStarts = events.filter(e => e.event_type === 'play_start' && e.source === 'iframe').length;
  const r2Starts = events.filter(e => e.event_type === 'play_start' && e.source === 'r2').length;

  console.log(`\n${bold('── Summary ──────────────────────────────────')}`);
  console.log(`  Tracks played:   ${plays}  (R2: ${r2Starts}, iframe: ${iframeStarts})`);
  console.log(`  Errors:          ${errors ? c.red + errors + c.reset : ok('0')}`);
  console.log(`  BG events:       ${bgEvents}`);
  console.log('');
}

// ── 2. Background failure analysis ───────────────────────────────────────────
async function bgAnalysis() {
  console.log(bold('\n== Background Playback Analysis ==\n'));

  const rows = await supaGet(TABLE, {
    select: 'id,created_at,event_type,track_id,track_title,is_background,session_id,meta',
    order: 'created_at.asc',
    limit: '600',
    'created_at': `gt.${new Date(Date.now() - 24*60*60*1000).toISOString()}`,
  });

  if (!rows.length) { console.log(warn('No events in last 24h')); return; }

  // Strategy 1: explicit visibility trace events (meta.state)
  // Strategy 2: detect BG windows from >20s gaps between events (JS throttled = no events)
  // Strategy 3: ae_resume_ok / ae_resume_attempt events mark FG returns
  const bgWindows = [];

  // Find FG-return markers: ae_resume_ok or visibility.visible
  const fgReturns = rows.filter(r =>
    (r.event_type === 'trace' && r.meta?.subtype === 'ae_resume_ok') ||
    (r.event_type === 'trace' && r.meta?.state === 'visible' && r.meta?.subtype === 'visibility')
  );

  // For each FG return, find the last event before it that marks "went to BG"
  // Heuristic: the last heartbeat_tick or play event before a >15s silence gap
  for (const fgReturn of fgReturns) {
    const fgTime = new Date(fgReturn.created_at);
    // Find the last event before this FG return that's more than 15s earlier
    const before = rows
      .filter(r => new Date(r.created_at) < fgTime)
      .filter(r => (fgTime - new Date(r.created_at)) > 15000);
    if (!before.length) continue;
    const lastBefore = before[before.length - 1];
    const gapSec = (fgTime - new Date(lastBefore.created_at)) / 1000;
    if (gapSec < 15) continue; // not a real BG window

    // Collect events in this window
    const wStart = new Date(lastBefore.created_at);
    const wEnd   = fgTime;
    const windowEvents = rows.filter(r => {
      const t = new Date(r.created_at);
      return t > wStart && t < wEnd;
    });

    const heartbeats = windowEvents.filter(r => r.meta?.subtype === 'heartbeat_tick').length;
    const advances   = windowEvents.filter(r => r.event_type === 'play_start').length;
    const ctxResumes = windowEvents.filter(r => r.meta?.subtype?.startsWith('ae_resume')).length;

    // Deduplicate: don't add if we already have a window ending within 5s of this one
    const dup = bgWindows.find(w => Math.abs(new Date(w.to) - fgTime) < 5000);
    if (!dup) {
      bgWindows.push({
        from: lastBefore.created_at,
        to: fgReturn.created_at,
        gapSec,
        heartbeats,
        advances,
        ctxResumes,
        trackTitle: lastBefore.track_title || lastBefore.track_id?.slice(0, 20) || '?',
      });
    }
  }

  if (!bgWindows.length) {
    console.log(info('No background windows detected in last 24h'));
    console.log(dim('Play a song, lock screen, unlock, then re-run this check.\n'));
    return;
  }

  console.log(`Found ${bgWindows.length} background window(s):\n`);

  for (const g of bgWindows) {
    const audioAlive = g.heartbeats > 0;
    const icon = audioAlive ? ok('') : fail('');
    console.log(`${icon} ${c.bold}BG: ${g.gapSec.toFixed(0)}s silent window${c.reset}  ${dim(ts(g.from) + ' → ' + ts(g.to))}`);
    console.log(`   Track:       ${g.trackTitle}`);
    console.log(`   Heartbeats:  ${g.heartbeats > 0
      ? c.green + g.heartbeats + ' (audio thread alive)' + c.reset
      : c.red + '0 — JS throttled, thread dead' + c.reset}`);
    console.log(`   Ctx resumes: ${g.ctxResumes > 0 ? c.green + g.ctxResumes + c.reset : dim(g.ctxResumes)}`);
    console.log(`   Advances:    ${g.advances > 0
      ? c.green + g.advances + ' track(s) — BG auto-advance working' + c.reset
      : dim('none (stayed on same track)')}`);

    if (!audioAlive && g.gapSec > 30) {
      console.log(`   ${c.red}⚡ JS fully throttled for ${g.gapSec.toFixed(0)}s — relies on onstatechange fix${c.reset}`);
    }
    if (g.advances === 0 && g.gapSec > 60) {
      console.log(`   ${c.yellow}⚠  No track advancement in ${g.gapSec.toFixed(0)}s — track likely ended and didn't advance${c.reset}`);
    }
    console.log('');
  }

  // Overall verdict
  const dead = bgWindows.filter(w => w.heartbeats === 0).length;
  const noAdv = bgWindows.filter(w => w.advances === 0 && w.gapSec > 60).length;
  console.log(bold('── Verdict ──────────────────────────────────'));
  if (dead === 0) console.log(ok('Audio thread alive in all BG windows'));
  else console.log(fail(`${dead}/${bgWindows.length} BG windows had dead audio thread`));
  if (noAdv === 0) console.log(ok('Track advancement working in background'));
  else console.log(warn(`${noAdv} long BG windows with no advancement (expected if track was still playing)`));
  console.log('');
}

// ── 3. R2 probe + ffprobe ─────────────────────────────────────────────────────
async function r2Check(ytId) {
  if (!ytId) { console.log(fail('Usage: --r2 <youtubeId>')); return; }
  ytId = ytId.replace(/^vyo_/, ''); // strip VOYO prefix if passed

  console.log(bold(`\n== R2 Check: ${ytId} ==\n`));

  // 1. HEAD probe
  const url = `${R2_BASE}/${ytId}?q=high&_v=${Date.now()}`;
  console.log(info(`HEAD ${url}`));
  const head = await httpHead(url);

  if (head.status === 200) {
    console.log(ok(`R2 has track (200)`));
    const size = head.headers['content-length'];
    const type = head.headers['content-type'];
    if (size) console.log(`  Size: ${(parseInt(size)/1024/1024).toFixed(2)} MB`);
    if (type) console.log(`  Type: ${type}`);
  } else {
    console.log(fail(`R2 missing (${head.status || head.error})`));
    console.log(dim('  Track is not cached — will use YouTube iframe\n'));
    return;
  }

  // 2. ffprobe
  console.log(info('\nffprobe analysis:'));
  const probe = spawnSync('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format',
    url,
  ], { timeout: 10000, encoding: 'utf8' });

  if (probe.error || probe.status !== 0) {
    console.log(warn('ffprobe failed — ' + (probe.error?.message || probe.stderr?.slice(0, 100))));
    return;
  }

  try {
    const info2 = JSON.parse(probe.stdout);
    const fmt = info2.format;
    const stream = info2.streams?.[0];

    if (fmt) {
      console.log(`  Format:   ${fmt.format_name}`);
      console.log(`  Duration: ${parseFloat(fmt.duration).toFixed(1)}s`);
      console.log(`  Bitrate:  ${Math.round(fmt.bit_rate / 1000)} kbps`);
    }
    if (stream) {
      console.log(`  Codec:    ${stream.codec_name} (${stream.codec_long_name})`);
      console.log(`  Sample:   ${stream.sample_rate} Hz`);
      console.log(`  Channels: ${stream.channels}`);
    }
    console.log(ok('File is valid audio'));
  } catch {
    console.log(warn('ffprobe JSON parse failed'));
  }

  // 3. Quick download speed test (first 100KB)
  console.log(info('\nSpeed test (first 100KB):'));
  const t0 = Date.now();
  const dlResult = spawnSync('curl', [
    '-s', '-r', '0-102400', '-o', '/dev/null', '-w', '%{speed_download}', url
  ], { timeout: 10000, encoding: 'utf8' });
  const elapsed = Date.now() - t0;
  if (!dlResult.error) {
    const bps = parseFloat(dlResult.stdout);
    const kbps = Math.round(bps * 8 / 1000);
    const quality = kbps > 800 ? ok(`${kbps} kbps (fast)`) :
                    kbps > 300 ? warn(`${kbps} kbps (ok)`) :
                    fail(`${kbps} kbps (slow)`);
    console.log(`  Speed:  ${quality}  ${dim('('+elapsed+'ms)')}`);
  }
  console.log('');
}

// ── 4. Advancement gap scanner ────────────────────────────────────────────────
async function gapScan() {
  console.log(bold('\n== Track Advancement Gaps (today) ==\n'));

  const rows = await supaGet(TABLE, {
    select: 'id,created_at,event_type,track_id,track_title,source,meta,is_background',
    order: 'created_at.asc',
    limit: '1000',
    'created_at': `gt.${new Date(Date.now() - 12*60*60*1000).toISOString()}`,
  });

  const starts = rows.filter(r => r.event_type === 'play_start');
  const ends   = rows.filter(r => r.event_type === 'stream_ended');

  let badGaps = 0;

  for (let i = 0; i < ends.length; i++) {
    const ended = ends[i];
    // Find the next play_start after this end
    const nextStart = starts.find(s => new Date(s.created_at) > new Date(ended.created_at));
    if (!nextStart) continue;

    const gapSec = gapMs(ended.created_at, nextStart.created_at) / 1000;
    const wasHidden = ended.meta?.hidden || ended.is_background;

    if (gapSec > 5) {
      badGaps++;
      const icon = gapSec > 30 ? fail('') : warn('');
      const bgLabel = wasHidden ? `${c.yellow}[BG]${c.reset} ` : '     ';
      const title1 = ended.track_title || ended.track_id?.slice(0, 20);
      const title2 = nextStart.track_title || nextStart.track_id?.slice(0, 20);
      console.log(`${icon} ${bgLabel}${c.bold}${gapSec.toFixed(1)}s gap${c.reset}  ${ts(ended.created_at)}`);
      console.log(`  ${dim('ended:')}   ${title1}`);
      console.log(`  ${dim('→ next:')}  ${title2}  ${dim('src:' + (nextStart.source || '?'))}`);
    }
  }

  if (!badGaps) {
    console.log(ok(`No advancement gaps > 5s in last 12h`));
  } else {
    console.log(`\n${warn(`${badGaps} gap(s) detected`)}`);
  }
  console.log('');
}

// ── 5. Live tail ──────────────────────────────────────────────────────────────
async function liveTail() {
  console.log(bold('\n== Live Event Tail (Ctrl+C to stop) ==\n'));
  let lastId = 0;

  // Get current last ID
  const seed = await supaGet(TABLE, { select: 'id', order: 'id.desc', limit: '1' });
  if (seed[0]) lastId = seed[0].id;
  console.log(dim(`Tailing from id=${lastId}\n`));

  const poll = async () => {
    try {
      const rows = await supaGet(TABLE, {
        select: 'id,created_at,event_type,track_id,track_title,source,error_code,is_background,meta',
        order: 'id.asc',
        'id': `gt.${lastId}`,
        limit: '50',
      });
      for (const ev of rows) {
        lastId = ev.id;
        const bg    = ev.is_background ? `${c.yellow}[BG]${c.reset} ` : '     ';
        const sub   = subtype(ev) ? ` ${dim(subtype(ev))}` : '';
        const src   = ev.source ? ` ${c.cyan}${ev.source}${c.reset}` : '';
        const err   = ev.error_code ? ` ${c.red}${ev.error_code}${c.reset}` : '';
        const title = ev.track_title ? ` ${c.dim}${ev.track_title.slice(0, 30)}${c.reset}` : '';
        const meta  = ev.meta && subtype(ev) === '' && Object.keys(ev.meta).length
          ? ` ${dim(JSON.stringify(ev.meta).slice(0, 60))}`
          : '';
        console.log(`${dim(ts(ev.created_at))} ${bg}${colorEvent(ev.event_type)}${sub}${src}${err}${title}${meta}`);
      }
    } catch (e) {
      console.log(warn('poll error: ' + e.message));
    }
    setTimeout(poll, 2000);
  };
  poll();
}

// ── 6. Session replay by ID ───────────────────────────────────────────────────
async function sessionReplay(sid) {
  console.log(bold(`\n== Session: ${sid} ==\n`));

  const rows = await supaGet(TABLE, {
    select: '*',
    session_id: `eq.${sid}`,
    order: 'created_at.asc',
    limit: '500',
  });

  if (!rows.length) { console.log(warn('No events for session ' + sid)); return; }

  console.log(info(`${rows.length} events\n`));
  for (const ev of rows) {
    const bg  = ev.is_background ? `${c.yellow}[BG]${c.reset} ` : '     ';
    const sub = subtype(ev) ? ` ${dim(subtype(ev))}` : '';
    const src = ev.source ? ` ${c.cyan}src:${ev.source}${c.reset}` : '';
    const err = ev.error_code ? ` ${c.red}err:${ev.error_code}${c.reset}` : '';
    const meta = ev.meta ? ` ${dim(JSON.stringify(ev.meta).slice(0, 80))}` : '';
    console.log(`  ${dim(ts(ev.created_at))} ${bg}${colorEvent(ev.event_type)}${sub}${src}${err}${meta}`);
  }
  console.log('');
}

// ── Router ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const mode = args[0] || '';

(async () => {
  try {
    if (mode === '--bg')                 await bgAnalysis();
    else if (mode === '--r2')            await r2Check(args[1]);
    else if (mode === '--gaps')          await gapScan();
    else if (mode === '--live')          await liveTail();
    else if (mode === '--session')       await sessionReplay(args[1]);
    else                                 await lastSession();
  } catch (e) {
    console.error(fail('Fatal: ' + e.message));
    process.exit(1);
  }
})();

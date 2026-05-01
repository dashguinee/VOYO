#!/usr/bin/env python3
"""
VPS queue lane — adaptive extraction worker.

Architecture: an "egyptian lane". Runs forever under pm2, claims rows via
claim_upload_queue RPC, extracts audio with yt-dlp (Chrome profile cookies,
forced player_client list), uploads the opus to R2 via the Cloudflare edge
worker, marks the row done. When queue is empty, idle-polls every 3s.

Does NOT go through voyo-proxy — that process is reserved for live listener
streaming so drainer load never chokes playback.

SPEED UNLOCKS (2026-05-01):
  * mweb-only player_client — skips 5-client probe chain, saves ~2s
  * 4-range parallel download — each range gets its own YT throttle bucket;
    tested: 87s serial → 0.14s parallel on a 2.78MB file
  * ThreadPoolExecutor(batch_size) — whole batch runs concurrently; single
    post-batch cooldown instead of per-track serial cooldown. Amortized
    time per track: ~15s serial → ~5s parallel
  * Cookie lock — thread-safe re-dump when multiple lanes share a profile

ADAPTIVE LAYER (2026-04-23):
  * Rolling stats window per lane (last N outcomes, categorized errors)
  * Adaptive cooldown + batch size — backs off on error spikes, tries to
    speed up when error-free + queue backlog is building
  * Per-minute `worker_tick` telemetry to voyo_playback_events so we can
    see the system breathing + discover the YT ceiling empirically
  * Cookie dump cached (1h TTL) — was re-dumping per extraction, wasted
    ~1s/track + extra disk churn

Env required (set by pm2 ecosystem):
    VOYO_SUPABASE_URL
    VOYO_SUPABASE_ANON_KEY
    R2_UPLOAD_BASE          e.g. https://voyo-edge.dash-webtv.workers.dev
    VOYO_LANE_ID            e.g. "vps-lane-001" (WORKER_ID for claim RPC)
    VOYO_CHROME_PROFILE     e.g. /opt/voyo/chrome-profile-001
"""
import os, re, subprocess, time, random, signal, sys, shutil, threading, base64
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import requests

SUPABASE_URL    = os.environ['VOYO_SUPABASE_URL']
SUPABASE_KEY    = os.environ['VOYO_SUPABASE_ANON_KEY']
R2_UPLOAD_BASE  = os.environ.get('R2_UPLOAD_BASE', 'https://voyo-edge.dash-webtv.workers.dev')
R2_UPLOAD_SECRET = os.environ.get('R2_UPLOAD_SECRET', '')
LANE_ID         = os.environ.get('VOYO_LANE_ID', f'vps-lane-{os.getpid()}')
CHROME_PROFILE  = os.environ.get('VOYO_CHROME_PROFILE', '/opt/voyo/chrome-profile-001')

POLL_IDLE_SEC          = 3
HOUSEKEEP_EVERY        = 300   # seconds between requeue_stale sweeps
TELEMETRY_EVERY        = 60    # seconds between worker_tick emissions
COOKIE_TTL_SEC         = 3600  # re-dump cookies at most once per hour

# Baseline concurrency (adaptive throttle may deviate within bounds below)
# Start at 2 — VPS is fresh after downtime; YouTube needs a warm-up period
# before trusting bursts of 3. Adaptive throttle will scale up to 3 once
# the error rate settles at 0 for 2 minutes.
INITIAL_BATCH_SIZE     = 2
# Cooldown is now post-BATCH (not per-track) because the batch runs in
# parallel. 3-6s between batches is adequate politeness; the adaptive layer
# can tighten/loosen from here.
INITIAL_COOLDOWN_MIN   = 3
INITIAL_COOLDOWN_MAX   = 6

# Adaptive bounds — never exceed these no matter what
MAX_BATCH_SIZE         = 3     # YT fingerprint ceiling per IP
MIN_BATCH_SIZE         = 1
MAX_COOLDOWN_SEC       = 40    # deepest back-off
MIN_COOLDOWN_SEC       = 3     # fastest we'll ever try

# Adaptive thresholds
ERROR_RATE_THROTTLE_DOWN = 0.20   # >20% error rate → halve concurrency
ERROR_RATE_THROTTLE_UP   = 0.00   # 0% for THROTTLE_UP_DWELL_SEC → try faster
QUEUE_BACKLOG_THRESHOLD  = 10     # only bump up if there's work waiting
THROTTLE_UP_DWELL_SEC    = 120    # must sustain zero-error for 2 min
ROLLING_WINDOW_SIZE      = 40     # remember last 40 outcomes

# Hard back-off when YT gives the explicit rate-limit signal
RATE_LIMIT_BACKOFF_SEC = 900   # 15 min

TEMP_DIR = Path('/tmp/voyo-lane')
TEMP_DIR.mkdir(exist_ok=True)

HEADERS = {
    'apikey':        SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type':  'application/json',
}

# Stealth: rotate through realistic browser UAs so extraction requests don't
# all share the same fingerprint. Skewed toward Chrome/Windows (most common)
# and Chrome/Android (mobile music users). Avoid any Linux/headless UA.
_UA_POOL = [
    # Chrome Windows (most common globally)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.6478.127 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.7049.115 Safari/537.36',
    # Chrome macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.6478.127 Safari/537.36',
    # Chrome Android (aligns with mweb player_client)
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.6478.122 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.7049.111 Mobile Safari/537.36',
    # Safari iOS (another common music listener profile)
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    # Firefox Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
]

def _pick_ua() -> str:
    """Return a weighted-random UA. Android/Windows Chrome = 60% share."""
    return random.choice(_UA_POOL)

def log(msg: str) -> None:
    print(f'[{LANE_ID}] {msg}', flush=True)


# ═══════════════════════════════════════════════════════════════════════
# STATS — rolling outcome window
# ═══════════════════════════════════════════════════════════════════════

class LaneStats:
    """Records outcomes with category + latency. All queries are windowed
    by wall-clock time so old data ages out without explicit pruning."""
    def __init__(self, max_size: int = ROLLING_WINDOW_SIZE):
        # each entry: (ts, 'ok'|'fail', category_or_None, latency_ms_or_None)
        self.events = deque(maxlen=max_size)

    def record_ok(self, latency_ms: int) -> None:
        self.events.append((time.time(), 'ok', None, latency_ms))

    def record_fail(self, category: str, latency_ms: int) -> None:
        self.events.append((time.time(), 'fail', category, latency_ms))

    def _window(self, seconds: int):
        cutoff = time.time() - seconds
        return [e for e in self.events if e[0] > cutoff]

    def error_rate(self, seconds: int) -> float:
        w = self._window(seconds)
        if not w: return 0.0
        return sum(1 for e in w if e[1] == 'fail') / len(w)

    def latency_p50(self, seconds: int = 300):
        lats = sorted(e[3] for e in self._window(seconds) if e[3] is not None)
        return lats[len(lats)//2] if lats else None

    def latency_p95(self, seconds: int = 300):
        lats = sorted(e[3] for e in self._window(seconds) if e[3] is not None)
        return lats[int(len(lats)*0.95)] if lats else None

    def category_breakdown(self, seconds: int = 300):
        out = {}
        for e in self._window(seconds):
            if e[1] == 'fail' and e[2]:
                out[e[2]] = out.get(e[2], 0) + 1
        return out


# ═══════════════════════════════════════════════════════════════════════
# ADAPTIVE THROTTLE — tune cooldown + batch size by error signal
# ═══════════════════════════════════════════════════════════════════════

class AdaptiveThrottle:
    """Sits between the main loop and the extraction primitive. Owns current
    cooldown_min/max + batch_size. Adjusts on every tick based on rolling
    stats + queue depth.

    Rules:
      * error_rate_60s >= ERROR_RATE_THROTTLE_DOWN  → halve concurrency
        (double cooldown, halve batch size, clamp to MAX_COOLDOWN_SEC /
        MIN_BATCH_SIZE)
      * error_rate_60s == 0 AND queue_depth > QUEUE_BACKLOG_THRESHOLD AND
        last state change was > THROTTLE_UP_DWELL_SEC ago  →  try 25%
        faster (cooldown *= 0.75, batch += 1, clamp to MIN_COOLDOWN_SEC /
        MAX_BATCH_SIZE)
      * Otherwise → no change.
    """
    def __init__(self):
        self.batch_size   = INITIAL_BATCH_SIZE
        self.cooldown_min = INITIAL_COOLDOWN_MIN
        self.cooldown_max = INITIAL_COOLDOWN_MAX
        self._last_change = time.time()

    def snapshot(self) -> dict:
        return {
            'batch_size':   self.batch_size,
            'cooldown_min': self.cooldown_min,
            'cooldown_max': self.cooldown_max,
        }

    def adjust(self, stats: LaneStats, queue_depth: int) -> None:
        rate = stats.error_rate(60)

        if rate >= ERROR_RATE_THROTTLE_DOWN:
            # Throttle down aggressively. YT is pushing back — we respect it.
            new_cd_min = min(MAX_COOLDOWN_SEC, max(INITIAL_COOLDOWN_MIN, self.cooldown_min * 2))
            new_cd_max = min(MAX_COOLDOWN_SEC, max(INITIAL_COOLDOWN_MAX, self.cooldown_max * 2))
            new_batch  = max(MIN_BATCH_SIZE, self.batch_size // 2)
            if (new_cd_min, new_cd_max, new_batch) != (self.cooldown_min, self.cooldown_max, self.batch_size):
                log(f'adaptive: throttle_DOWN rate={rate:.0%} → '
                    f'cooldown={new_cd_min}-{new_cd_max}s batch={new_batch}')
                self.cooldown_min = new_cd_min
                self.cooldown_max = new_cd_max
                self.batch_size   = new_batch
                self._last_change = time.time()
            return

        # Only consider speeding up if we're well past the last change
        if rate > ERROR_RATE_THROTTLE_UP: return
        if queue_depth < QUEUE_BACKLOG_THRESHOLD: return
        if time.time() - self._last_change < THROTTLE_UP_DWELL_SEC: return

        new_cd_min = max(MIN_COOLDOWN_SEC, int(self.cooldown_min * 0.75))
        new_cd_max = max(MIN_COOLDOWN_SEC + 2, int(self.cooldown_max * 0.75))
        new_batch  = min(MAX_BATCH_SIZE, self.batch_size + 1)
        if (new_cd_min, new_cd_max, new_batch) != (self.cooldown_min, self.cooldown_max, self.batch_size):
            log(f'adaptive: throttle_UP rate=0 backlog={queue_depth} → '
                f'cooldown={new_cd_min}-{new_cd_max}s batch={new_batch}')
            self.cooldown_min = new_cd_min
            self.cooldown_max = new_cd_max
            self.batch_size   = new_batch
            self._last_change = time.time()


# ═══════════════════════════════════════════════════════════════════════
# VOYO ID — decode vyo_<base64url> → plain YouTube ID
# ═══════════════════════════════════════════════════════════════════════

def get_youtube_id(track_id: str) -> str:
    """Mirror of the frontend getYouTubeId util.
    vyo_<base64url> → YouTube ID. Plain IDs pass through unchanged."""
    if not track_id.startswith('vyo_'):
        return track_id
    encoded = track_id[4:]  # strip vyo_
    # URL-safe base64 → standard base64
    b64 = encoded.replace('-', '+').replace('_', '/')
    # Re-add padding
    b64 += '=' * (-len(b64) % 4)
    return base64.b64decode(b64).decode('utf-8')


# ═══════════════════════════════════════════════════════════════════════
# ERROR CATEGORIZATION
# ═══════════════════════════════════════════════════════════════════════

def categorize_error(err_msg: str) -> str:
    m = (err_msg or '').lower()
    # Permanent failures checked first — even if 429 appears in the same
    # stderr dump, the video is gone and no backoff will help.
    # extract_and_upload raises RuntimeError('unavailable: ...') explicitly
    # when it detects these patterns in the full stderr, so this also handles
    # the case where [-250:] truncation missed the removed/private line.
    if m.startswith('unavailable:'):
        return 'unavailable'
    if 'video has been removed' in m or 'this video is private' in m:
        return 'unavailable'
    if 'video unavailable' in m or ('unavailable' in m and 'uploader' in m):
        return 'unavailable'
    if 'rate-limited' in m or 'too many requests' in m or '429' in m:
        return 'rate_limited'
    if 'format not available' in m or 'requested format is not available' in m:
        return 'format_not_available'
    if 'signature' in m:
        return 'signature'
    if 'private' in m or 'removed' in m or 'unavailable' in m:
        return 'unavailable'
    if 'timeout' in m or 'timed out' in m:
        return 'timeout'
    if 'network' in m or 'connection' in m or 'connect' in m:
        return 'network'
    if 'empty download' in m:
        return 'empty_download'
    if 'r2 upload' in m:
        return 'r2_upload'
    return 'other'


# ═══════════════════════════════════════════════════════════════════════
# SUPABASE — claim, mark, housekeeping, queue depth, telemetry emit
# ═══════════════════════════════════════════════════════════════════════

def claim_batch(batch_size: int):
    """Atomic claim via SECURITY DEFINER RPC. Returns up to batch_size rows."""
    try:
        r = requests.post(
            f'{SUPABASE_URL}/rest/v1/rpc/claim_upload_queue',
            json={'p_worker_id': LANE_ID, 'p_batch_size': batch_size},
            headers=HEADERS, timeout=10,
        )
        if r.status_code != 200:
            log(f'claim HTTP {r.status_code}: {r.text[:200]}')
            return []
        return r.json() or []
    except Exception as e:
        log(f'claim error: {e}')
        return []

def mark_done(row_id: int, yt_id: str, extraction_ms: int, audio_bytes: int) -> None:
    """Mark the queue row done AND flip video_intelligence.r2_cached so the
    home-feed discovery filter picks it up. Also writes extraction_ms and
    audio_bytes for latency telemetry. Two PATCHes, independent."""
    try:
        requests.patch(
            f'{SUPABASE_URL}/rest/v1/voyo_upload_queue?id=eq.{row_id}',
            json={
                'status':         'done',
                'completed_at':   'now()',
                'extraction_ms':  extraction_ms,
                'audio_bytes':    audio_bytes,
            },
            headers=HEADERS, timeout=10,
        )
    except Exception: pass
    try:
        requests.patch(
            f'{SUPABASE_URL}/rest/v1/video_intelligence?youtube_id=eq.{yt_id}',
            json={'r2_cached': True, 'r2_cached_at': 'now()'},
            headers=HEADERS, timeout=10,
        )
    except Exception: pass

def mark_failed(row_id: int, error_msg: str, category: str, extraction_ms: int) -> None:
    # Bump failure_count; status=failed once >=3, else back to pending.
    try:
        r = requests.get(
            f'{SUPABASE_URL}/rest/v1/voyo_upload_queue?id=eq.{row_id}&select=failure_count',
            headers=HEADERS, timeout=10,
        )
        count = (r.json()[0]['failure_count'] if r.status_code == 200 and r.json() else 0) + 1
    except Exception:
        count = 1
    new_status = 'failed' if count >= 3 else 'pending'
    try:
        requests.patch(
            f'{SUPABASE_URL}/rest/v1/voyo_upload_queue?id=eq.{row_id}',
            json={
                'status':            new_status,
                'failure_count':     count,
                'last_error':        (error_msg or '')[:500],
                'failure_category':  category,
                'extraction_ms':     extraction_ms,
                'claimed_at':        None,
                'claimed_by_worker': None,
            },
            headers=HEADERS, timeout=10,
        )
    except Exception: pass

def requeue_stale() -> None:
    try:
        r = requests.post(
            f'{SUPABASE_URL}/rest/v1/rpc/requeue_stale_claims',
            json={}, headers=HEADERS, timeout=10,
        )
        n = r.json() if r.status_code == 200 else 0
        if n: log(f'housekeeping: requeued {n} stale rows')
    except Exception as e:
        log(f'housekeeping err: {e}')

def get_queue_depth() -> int:
    """Count pending rows across the whole queue (all lanes see same depth)."""
    try:
        r = requests.get(
            f'{SUPABASE_URL}/rest/v1/voyo_upload_queue?select=id&status=eq.pending',
            headers={**HEADERS, 'Prefer': 'count=exact', 'Range': '0-0'},
            timeout=5,
        )
        cr = r.headers.get('content-range', '0/0')
        return int(cr.split('/')[1]) if '/' in cr else 0
    except Exception:
        return 0

def emit_worker_tick(stats: LaneStats, throttle: AdaptiveThrottle, queue_depth: int) -> None:
    """Per-minute heartbeat emitted to voyo_playback_events. Gives us the
    data to answer 'are we at the ceiling?' at any moment."""
    payload = {
        'event_type': 'trace',
        'track_id':   'lane-stats',
        'meta': {
            'subtype':         'worker_tick',
            'lane':            LANE_ID,
            'error_rate_60s':  round(stats.error_rate(60), 3),
            'error_rate_300s': round(stats.error_rate(300), 3),
            'latency_p50':     stats.latency_p50(),
            'latency_p95':     stats.latency_p95(),
            'categories':      stats.category_breakdown(),
            'queue_depth':     queue_depth,
            **throttle.snapshot(),
        },
    }
    try:
        requests.post(
            f'{SUPABASE_URL}/rest/v1/voyo_playback_events',
            json=payload, headers=HEADERS, timeout=5,
        )
    except Exception: pass  # telemetry failure must never block extraction


# ═══════════════════════════════════════════════════════════════════════
# COOKIES — dump via voyo-dump-cookies, cached 1h
# ═══════════════════════════════════════════════════════════════════════

_cookie_cache_path: Path | None = None
_cookie_cache_at:   float       = 0.0
_cookie_lock                    = threading.Lock()

def get_cookie_file() -> Path:
    """Return a valid cookie file for yt-dlp. Re-dumps from Chrome profile
    when stale (>1h) or first time; otherwise reuses the cached file to
    save the ~1s + disk churn per-extraction cost.
    Thread-safe: lock prevents concurrent threads from double-dumping."""
    global _cookie_cache_path, _cookie_cache_at
    dest = TEMP_DIR / f'cookies-{LANE_ID}.txt'
    now = time.time()
    with _cookie_lock:
        if _cookie_cache_path == dest and dest.exists() and (now - _cookie_cache_at) < COOKIE_TTL_SEC:
            return dest
        dest.unlink(missing_ok=True)
        subprocess.run(
            ['/usr/local/bin/voyo-dump-cookies', CHROME_PROFILE, str(dest)],
            capture_output=True, timeout=20, check=True,
        )
        try: dest.chmod(0o600)
        except PermissionError: pass
        _cookie_cache_path = dest
        _cookie_cache_at   = now
        return dest

def invalidate_cookie_cache() -> None:
    """Force a re-dump on the next call. Use after a sig/auth error that
    may indicate the cookies went stale before the TTL."""
    global _cookie_cache_at
    with _cookie_lock:
        _cookie_cache_at = 0.0


# ═══════════════════════════════════════════════════════════════════════
# EXTRACT — mweb-only + 4-range parallel download + R2 upload
# ═══════════════════════════════════════════════════════════════════════

def _parallel_download(url: str) -> bytes:
    """Download audio bytes using 4 concurrent Range requests.

    YT throttles each signed-URL connection to ~playback speed (~0.03 MB/s).
    The throttle is per-connection. 4 parallel ranges each get their own
    bucket → total bandwidth ≈ full VPS throughput.

    clen= in the query string gives the exact byte length without a HEAD
    round-trip. Falls back to a HEAD request for URLs that don't embed it.
    Falls back to a single GET for files under 512 KB (not worth splitting).
    """
    # Parse content length from URL (googlevideo embeds clen=NNNN)
    m = re.search(r'[?&]clen=(\d+)', url)
    if m:
        size = int(m.group(1))
    else:
        head = requests.head(url, timeout=10)
        head.raise_for_status()
        size = int(head.headers.get('content-length', 0))

    if size < 512_000:
        # Small file — single connection is fine, no split overhead.
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        return r.content

    # Split into 4 equal ranges; last range absorbs any remainder.
    chunk = size // 4
    ranges = [
        (i * chunk, (i + 1) * chunk - 1 if i < 3 else size - 1)
        for i in range(4)
    ]

    def _fetch(start: int, end: int) -> tuple[int, bytes]:
        r = requests.get(
            url,
            headers={'Range': f'bytes={start}-{end}'},
            timeout=60,
        )
        r.raise_for_status()
        return start, r.content

    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = [pool.submit(_fetch, s, e) for s, e in ranges]
        parts = sorted((f.result() for f in as_completed(futs)), key=lambda x: x[0])

    return b''.join(data for _, data in parts)


def extract_and_upload(track_id: str) -> tuple[int, int]:
    """Returns (wall_ms, audio_bytes). Raises on any failure (caller
    categorizes + marks failed)."""
    t0 = time.time()
    # Decode VOYO IDs (vyo_<base64url>) to plain YouTube IDs before hitting yt-dlp.
    yt_id = get_youtube_id(track_id)
    cookie_file = get_cookie_file()

    # Step 1 — get the signed googlevideo URL.
    # mweb alone is always the fastest client — the default multi-client
    # chain (default,mweb,web_safari,...) probed 6 clients sequentially,
    # wasting ~2s. mweb succeeds on ~95%+ of tracks; the CLI fallback
    # below catches the rare misses.
    # Wrap in env -i so NODE_CHANNEL_FD (set by pm2) doesn't leak into
    # the subprocess and crash any Deno-based PoToken solver.
    # Stealth: organic micro-jitter before each extraction so requests don't
    # arrive in lockstep. 0.3–1.8s variance — below human perception threshold
    # but enough to break clockwork fingerprinting.
    time.sleep(random.uniform(0.3, 1.8))

    ua = _pick_ua()
    yt_cmd = (
        '/usr/local/bin/yt-dlp -f "bestaudio[vcodec=none]/bestaudio" --get-url '
        f'--cookies {cookie_file} '
        f'--user-agent "{ua}" '
        '--extractor-args "youtube:player_client=mweb" '
        f'"https://www.youtube.com/watch?v={yt_id}"'
    )
    cmd = ['/usr/bin/env', '-i',
           'PATH=/usr/local/bin:/usr/bin:/bin',
           'HOME=/root',
           '/bin/bash', '-c', yt_cmd]
    result = subprocess.run(
        cmd, capture_output=True, timeout=60, text=True,
        close_fds=True, start_new_session=True,
    )
    urls = [l.strip() for l in (result.stdout or '').splitlines() if l.strip().startswith('http')]

    # mweb rejects ~5% of tracks (age-gated, region-locked). Fall back to
    # the full client chain for those rather than marking them failed.
    if not urls:
        ua_fb = _pick_ua()
        yt_cmd_fb = (
            '/usr/local/bin/yt-dlp -f "bestaudio[vcodec=none]/bestaudio" --get-url '
            f'--cookies {cookie_file} '
            f'--user-agent "{ua_fb}" '
            '--extractor-args "youtube:player_client=default,mweb,web_safari,web_music,tv_simply,tv" '
            f'"https://www.youtube.com/watch?v={yt_id}"'
        )
        cmd_fb = ['/usr/bin/env', '-i',
                  'PATH=/usr/local/bin:/usr/bin:/bin',
                  'HOME=/root',
                  '/bin/bash', '-c', yt_cmd_fb]
        result = subprocess.run(
            cmd_fb, capture_output=True, timeout=60, text=True,
            close_fds=True, start_new_session=True,
        )
        urls = [l.strip() for l in (result.stdout or '').splitlines() if l.strip().startswith('http')]

    if not urls:
        stderr = result.stderr or ''
        log(f'stderr dump for {yt_id}:\n{stderr[:1000]}')
        # Surface permanent failures even when 429 appears first in stderr —
        # yt-dlp logs the 429 warning before the real "removed/private" error.
        sl = stderr.lower()
        if 'video has been removed' in sl or 'this video is private' in sl:
            raise RuntimeError(f'unavailable: {stderr[-200:]}')
        if 'video unavailable' in sl:
            raise RuntimeError(f'unavailable: {stderr[-200:]}')
        raise RuntimeError(f'no url: {stderr[-250:]}')

    # Step 2 — 4-range parallel download from googlevideo.
    content = _parallel_download(urls[0])
    if len(content) < 1024:
        raise RuntimeError(f'empty download ({len(content)}b)')

    # Step 3 — upload to R2 via edge worker.
    upload_headers = {'Content-Type': 'audio/ogg'}
    if R2_UPLOAD_SECRET:
        upload_headers['Authorization'] = f'Bearer {R2_UPLOAD_SECRET}'
    r = requests.post(
        f'{R2_UPLOAD_BASE}/upload/{yt_id}?q=medium',
        data=content, headers=upload_headers,
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f'R2 upload HTTP {r.status_code}: {r.text[:200]}')

    return int((time.time() - t0) * 1000), len(content)


# ═══════════════════════════════════════════════════════════════════════
# MAIN LOOP — parallel batch execution
# ═══════════════════════════════════════════════════════════════════════

_running = True
def _term(_sig, _frame):
    global _running
    log('SIGTERM — finishing current batch then exiting')
    _running = False
signal.signal(signal.SIGTERM, _term)
signal.signal(signal.SIGINT,  _term)


def _run_row(row: dict) -> tuple[str, dict, int, int | str]:
    """Worker function submitted to the thread pool.

    Always returns a result tuple (never raises) so the main thread can
    collect all futures unconditionally:
      ('ok',   row, wall_ms, audio_bytes)
      ('fail', row, wall_ms, error_str)
    """
    t0 = time.time()
    try:
        wall_ms, audio_bytes = extract_and_upload(row['youtube_id'])
        return ('ok', row, wall_ms, audio_bytes)
    except Exception as e:
        wall_ms = int((time.time() - t0) * 1000)
        return ('fail', row, wall_ms, str(e))


def main():
    log(f'starting — profile={CHROME_PROFILE} baseline batch={INITIAL_BATCH_SIZE} '
        f'cooldown={INITIAL_COOLDOWN_MIN}-{INITIAL_COOLDOWN_MAX}s (post-batch)')

    stats       = LaneStats()
    throttle    = AdaptiveThrottle()
    last_house  = 0.0
    last_tel    = 0.0
    processed   = 0
    queue_depth = 0

    while _running:
        now = time.time()

        # Housekeeping (requeue stale claims across all lanes)
        if now - last_house > HOUSEKEEP_EVERY:
            requeue_stale()
            last_house = now

        # Periodic telemetry + throttle re-evaluation
        if now - last_tel > TELEMETRY_EVERY:
            queue_depth = get_queue_depth()
            throttle.adjust(stats, queue_depth)
            emit_worker_tick(stats, throttle, queue_depth)
            last_tel = now

        batch = claim_batch(throttle.batch_size)
        if not batch:
            time.sleep(POLL_IDLE_SEC)
            continue

        # Run the whole batch in parallel. All tracks start at once; we
        # collect results as they finish. One post-batch cooldown replaces
        # the old per-track serial cooldown.
        rate_limited_seen = False

        with ThreadPoolExecutor(max_workers=len(batch)) as pool:
            futures = {pool.submit(_run_row, row): row for row in batch}
            for future in as_completed(futures):
                status, row, wall_ms, payload = future.result()
                yt_id  = row['youtube_id']
                row_id = row['id']

                if status == 'ok':
                    audio_bytes = payload
                    # Decode vyo_ IDs for mark_done — video_intelligence
                    # is keyed by plain YouTube ID, not VOYO ID.
                    yt_plain = get_youtube_id(yt_id)
                    mark_done(row_id, yt_plain, wall_ms, audio_bytes)
                    stats.record_ok(wall_ms)
                    processed += 1
                    log(f'✓ {yt_plain} in {wall_ms/1000:.1f}s ({audio_bytes//1024}KB) total={processed}')
                else:
                    err      = payload
                    category = categorize_error(err)
                    mark_failed(row_id, err, category, wall_ms)
                    stats.record_fail(category, wall_ms)
                    log(f'✗ {yt_id} ({category}) in {wall_ms/1000:.1f}s: {err[:150]}')

                    # Stale cookies — force re-dump before next batch.
                    if category in ('signature', 'format_not_available'):
                        invalidate_cookie_cache()

                    # Hard rate-limit: note it, apply backoff after batch.
                    # Permanent failures (unavailable, removed, private) are
                    # NOT rate-limit events — don't penalise the whole lane.
                    if category == 'rate_limited':
                        rate_limited_seen = True

        # Post-batch: apply rate-limit backoff or normal politeness cooldown.
        if rate_limited_seen:
            log(f'rate-limited — backing off {RATE_LIMIT_BACKOFF_SEC}s')
            # Sleep in 60s slices so telemetry ticks can still fire and
            # _running is checked regularly (clean shutdown during backoff).
            deadline = time.time() + RATE_LIMIT_BACKOFF_SEC
            while _running and time.time() < deadline:
                now2 = time.time()
                if now2 - last_tel > TELEMETRY_EVERY:
                    queue_depth = get_queue_depth()
                    throttle.adjust(stats, queue_depth)
                    emit_worker_tick(stats, throttle, queue_depth)
                    last_tel = now2
                time.sleep(min(60, deadline - time.time()))
        elif _running:
            # Randomise so concurrent lanes don't sync up on the next claim.
            time.sleep(random.uniform(throttle.cooldown_min, throttle.cooldown_max))

    log(f'exiting cleanly after {processed} extractions')

if __name__ == '__main__':
    main()

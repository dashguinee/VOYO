#!/usr/bin/env python3
"""
VPS queue lane — always-on worker that drains voyo_upload_queue.

Architecture: an "egyptian lane". Runs forever under pm2, claims rows via
claim_upload_queue RPC, extracts audio with yt-dlp (Chrome profile cookies,
forced player_client list), uploads the opus to R2 via the Cloudflare edge
worker, marks the row done. When queue is empty, idle-polls every 3s.

Does NOT go through voyo-proxy — that process is reserved for live listener
streaming so drainer load never chokes playback.

Env required (set by pm2 ecosystem):
    VOYO_SUPABASE_URL
    VOYO_SUPABASE_ANON_KEY
    R2_UPLOAD_BASE          e.g. https://voyo-edge.dash-webtv.workers.dev
    VOYO_LANE_ID            e.g. "vps-lane-1" (WORKER_ID for claim RPC)
    VOYO_CHROME_PROFILE     e.g. /opt/voyo/chrome-profile-001
"""
import os, subprocess, time, random, signal, sys, shutil
from pathlib import Path
import requests

SUPABASE_URL    = os.environ['VOYO_SUPABASE_URL']
SUPABASE_KEY    = os.environ['VOYO_SUPABASE_ANON_KEY']
R2_UPLOAD_BASE  = os.environ.get('R2_UPLOAD_BASE', 'https://voyo-edge.dash-webtv.workers.dev')
LANE_ID         = os.environ.get('VOYO_LANE_ID', f'vps-lane-{os.getpid()}')
CHROME_PROFILE  = os.environ.get('VOYO_CHROME_PROFILE', '/opt/voyo/chrome-profile-001')

POLL_IDLE_SEC   = 3
BATCH_SIZE      = 3           # claim N rows per cycle
HOUSEKEEP_EVERY = 300         # seconds between requeue_stale sweeps

TEMP_DIR = Path('/tmp/voyo-lane')
TEMP_DIR.mkdir(exist_ok=True)

HEADERS = {
    'apikey':        SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type':  'application/json',
}

def log(msg: str) -> None:
    print(f'[{LANE_ID}] {msg}', flush=True)

def claim_batch():
    """Atomic claim via SECURITY DEFINER RPC. Returns up to BATCH_SIZE rows."""
    try:
        r = requests.post(
            f'{SUPABASE_URL}/rest/v1/rpc/claim_upload_queue',
            json={'p_worker_id': LANE_ID, 'p_batch_size': BATCH_SIZE},
            headers=HEADERS, timeout=10,
        )
        if r.status_code != 200:
            log(f'claim HTTP {r.status_code}: {r.text[:200]}')
            return []
        return r.json() or []
    except Exception as e:
        log(f'claim error: {e}')
        return []

def mark_done(row_id: int) -> None:
    requests.patch(
        f'{SUPABASE_URL}/rest/v1/voyo_upload_queue?id=eq.{row_id}',
        json={'status': 'done', 'completed_at': 'now()'},
        headers=HEADERS, timeout=10,
    )

def mark_failed(row_id: int, error_msg: str) -> None:
    # Bump failure_count; status=failed once >=3, else back to pending.
    r = requests.get(
        f'{SUPABASE_URL}/rest/v1/voyo_upload_queue?id=eq.{row_id}&select=failure_count',
        headers=HEADERS, timeout=10,
    )
    count = (r.json()[0]['failure_count'] if r.status_code == 200 and r.json() else 0) + 1
    new_status = 'failed' if count >= 3 else 'pending'
    requests.patch(
        f'{SUPABASE_URL}/rest/v1/voyo_upload_queue?id=eq.{row_id}',
        json={
            'status':            new_status,
            'failure_count':     count,
            'last_error':        error_msg[:500],
            'claimed_at':        None,
            'claimed_by_worker': None,
        },
        headers=HEADERS, timeout=10,
    )

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

def dump_cookies(profile: str, dest: Path) -> None:
    """Use voyo-dump-cookies helper to write a fresh Netscape cookie file from
    the live Chrome profile. Handles account-family cases that break
    --cookies-from-browser when yt-dlp reads mid-transcode."""
    dest.unlink(missing_ok=True)
    subprocess.run(
        ['/usr/local/bin/voyo-dump-cookies', profile, str(dest)],
        capture_output=True, timeout=20, check=True,
    )
    # voyo-dump-cookies runs as root sometimes; ensure our own user can read.
    try: dest.chmod(0o644)
    except PermissionError: pass

def extract_and_upload(yt_id: str) -> None:
    """Mirror voyo-proxy: get signed URL via yt-dlp, fetch the audio bytes,
    POST to R2 upload bridge. No transcode — we upload webm/opus as-is.

    Why this shape instead of `yt-dlp -x --audio-format opus`:
    - account-family profiles break on the format-extraction code path but
      succeed on --get-url (different player_client fallback)
    - skips ffmpeg cost + transcode time
    - voyo-proxy already uses this exact recipe in production"""
    cookie_file = TEMP_DIR / f'cookies-{LANE_ID}.txt'
    dump_cookies(CHROME_PROFILE, cookie_file)

    # Step 1 — get the signed googlevideo URL
    # Wrap yt-dlp in a fresh bash shell via `env -i` so NO env vars from the
    # pm2 parent leak in — in particular NODE_CHANNEL_FD, which makes Deno
    # (yt-dlp's JS challenge solver) crash with "Failed to open IPC channel
    # from NODE_CHANNEL_FD (3): fd is not from BiPipe".
    yt_cmd = (
        '/usr/local/bin/yt-dlp -f "bestaudio[vcodec=none]/bestaudio" --get-url '
        f'--cookies {cookie_file} '
        '--extractor-args "youtube:player_client=default,mweb,web_safari,web_music,tv_simply,tv" '
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
    if not urls:
        # Print FULL stderr (first 1000 chars) so we can diagnose env-specific
        # yt-dlp failures like missing PoT provider, data_sync_id etc.
        log(f'stderr dump for {yt_id}:\n{(result.stderr or "")[:1000]}')
        raise RuntimeError(f'no url: {(result.stderr or "")[-250:]}')

    # Step 2 — download bytes from googlevideo (signed URL bound to THIS VPS IP;
    # relay-free by design since we're on the VPS)
    audio_resp = requests.get(urls[0], timeout=90, stream=True)
    audio_resp.raise_for_status()
    content = audio_resp.content   # small enough (~3-10 MB) to hold in memory
    if len(content) < 1024:
        raise RuntimeError(f'empty download ({len(content)}b)')

    # Step 3 — upload to R2 via edge worker
    r = requests.post(
        f'{R2_UPLOAD_BASE}/upload/{yt_id}?q=medium',
        data=content, headers={'Content-Type': 'audio/ogg'},
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f'R2 upload HTTP {r.status_code}: {r.text[:200]}')

# Graceful shutdown on pm2 stop/restart
_running = True
def _term(_sig, _frame):
    global _running
    log('SIGTERM — finishing current track then exiting')
    _running = False
signal.signal(signal.SIGTERM, _term)
signal.signal(signal.SIGINT,  _term)

def main():
    log(f'starting — profile={CHROME_PROFILE}')
    last_house = 0
    processed = 0
    while _running:
        if time.time() - last_house > HOUSEKEEP_EVERY:
            requeue_stale()
            last_house = time.time()

        batch = claim_batch()
        if not batch:
            time.sleep(POLL_IDLE_SEC)
            continue

        for row in batch:
            yt_id = row['youtube_id']
            row_id = row['id']
            t0 = time.time()
            try:
                extract_and_upload(yt_id)
                mark_done(row_id)
                processed += 1
                log(f'✓ {yt_id} in {time.time()-t0:.1f}s (total {processed})')
            except Exception as e:
                mark_failed(row_id, str(e))
                log(f'✗ {yt_id} in {time.time()-t0:.1f}s: {str(e)[:150]}')
            # Small politeness sleep between tracks
            time.sleep(random.uniform(0.2, 0.4))

    log(f'exiting cleanly after {processed} extractions')

if __name__ == '__main__':
    main()

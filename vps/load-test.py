#!/usr/bin/env python3
"""
vps/load-test.py — discover the YT rate-limit ceiling empirically.

Queues N cold tracks via bump_queue_priority, polls voyo_upload_queue until
all complete or fail, reports:
  * total success %
  * ceiling signal: when error rate first crossed 5% in a rolling 10-track window
  * latency stats (p50/p95/mean) across successes
  * error category breakdown (rate_limited / format_not_available / ...)
  * throughput (completions per minute per lane)

Pair this with live `worker_tick` telemetry from queue-worker.py — this
script tells you the answer for THIS test, the worker telemetry tells you
the answer continuously as usage shifts.

Usage:
  VOYO_SUPABASE_URL=https://anmgyxhnyhbyxzpjhxgx.supabase.co \
  VOYO_SUPABASE_SERVICE_KEY=sb_secret_... \
  python3 vps/load-test.py [--count 100] [--priority 5] [--source cold|curated]

source options:
  cold     — query video_intelligence for tracks that are NOT r2_cached
             (real cold tracks; trips ceiling honestly)
  curated  — use a built-in small list of known-playable IDs (predictable,
             for dry-run; won't stress YT much since R2 hits short-circuit)
"""
import os, sys, time, json, argparse
from collections import Counter, defaultdict
import requests

SUPABASE_URL = os.environ['VOYO_SUPABASE_URL']
SERVICE_KEY  = os.environ['VOYO_SUPABASE_SERVICE_KEY']
HEADERS = {
    'apikey':        SERVICE_KEY,
    'Authorization': f'Bearer {SERVICE_KEY}',
    'Content-Type':  'application/json',
}

# Small curated list for --source curated (known playable, mostly obscure)
CURATED_TEST_IDS = [
    'dQw4w9WgXcQ', 'kJQP7kiw5Fk', 'JGwWNGJdvx8', 'RgKAFK5djSk',
    'OPf0YbXqDm0', 'hT_nvWreIhg', 'CevxZvSJLk8', 'fJ9rUzIMcZQ',
]


def find_cold_tracks(n: int) -> list[str]:
    """Pull N YouTube IDs from video_intelligence where r2_cached is not
    true. These will force real extraction."""
    r = requests.get(
        f'{SUPABASE_URL}/rest/v1/video_intelligence'
        f'?select=youtube_id&or=(r2_cached.is.null,r2_cached.eq.false)&limit={n}',
        headers=HEADERS, timeout=15,
    )
    r.raise_for_status()
    return [row['youtube_id'] for row in r.json() if row.get('youtube_id')]


def enqueue(youtube_ids: list[str], priority: int) -> list[str]:
    """Bump each ID into voyo_upload_queue. Returns the IDs actually
    submitted (skips anything that errored)."""
    submitted = []
    for yt_id in youtube_ids:
        try:
            r = requests.post(
                f'{SUPABASE_URL}/rest/v1/rpc/bump_queue_priority',
                json={
                    'p_youtube_id': yt_id,
                    'p_priority':   priority,
                    'p_title':      None,
                    'p_artist':     None,
                },
                headers=HEADERS, timeout=10,
            )
            if r.ok:
                submitted.append(yt_id)
        except Exception:
            pass
    return submitted


def snapshot_status(youtube_ids: list[str]) -> dict:
    """Fetch current queue rows for the batch. Returns {yt_id: row_dict}."""
    if not youtube_ids: return {}
    in_list = ','.join(f'"{yid}"' for yid in youtube_ids)
    r = requests.get(
        f'{SUPABASE_URL}/rest/v1/voyo_upload_queue'
        f'?youtube_id=in.({in_list})'
        f'&select=youtube_id,status,extraction_ms,failure_category,claimed_by_worker,completed_at,requested_at'
        f'&limit={len(youtube_ids)}',
        headers=HEADERS, timeout=15,
    )
    if not r.ok: return {}
    return {row['youtube_id']: row for row in r.json()}


def report(rows: dict, submitted_at: float) -> None:
    total    = len(rows)
    done     = [r for r in rows.values() if r['status'] == 'done']
    failed   = [r for r in rows.values() if r['status'] == 'failed']
    pending  = [r for r in rows.values() if r['status'] == 'pending']
    running  = [r for r in rows.values() if r['status'] == 'processing']

    print('\n' + '═' * 60)
    print(f'LOAD TEST REPORT — {total} tracks submitted')
    print('═' * 60)

    print(f'\n  done:       {len(done)}  ({len(done)*100/total:.1f}%)')
    print(f'  failed:     {len(failed)}  ({len(failed)*100/total:.1f}%)')
    print(f'  pending:    {len(pending)}')
    print(f'  processing: {len(running)}')

    if done:
        lats = sorted(r['extraction_ms'] for r in done if r.get('extraction_ms'))
        if lats:
            mean = sum(lats) / len(lats)
            p50  = lats[len(lats)//2]
            p95  = lats[int(len(lats)*0.95)] if len(lats) >= 20 else lats[-1]
            print(f'\n  extraction_ms  mean={mean:.0f}  p50={p50}  p95={p95}')

    if failed:
        cats = Counter(r.get('failure_category') or 'unknown' for r in failed)
        print('\n  failure categories:')
        for cat, n in cats.most_common():
            print(f'    {cat}: {n}')

    # Per-lane throughput
    by_lane = defaultdict(list)
    for r in done:
        by_lane[r.get('claimed_by_worker') or 'unknown'].append(r)
    if by_lane:
        print('\n  per-lane stats:')
        for lane, rs in by_lane.items():
            lats = [r['extraction_ms'] for r in rs if r.get('extraction_ms')]
            if not lats: continue
            mean = sum(lats) / len(lats)
            # rough throughput: done rows / wall-clock elapsed since first submit
            wall = time.time() - submitted_at
            print(f'    {lane}: {len(rs)} done  mean_lat={mean:.0f}ms  rate={len(rs)/wall*60:.2f}/min')

    # Ceiling signal — first 10-track window where fail rate crossed 5%
    ordered = sorted(
        [r for r in rows.values() if r.get('completed_at')],
        key=lambda r: r['completed_at'],
    )
    if len(ordered) >= 10:
        for i in range(len(ordered) - 9):
            window = ordered[i:i+10]
            fails = sum(1 for r in window if r['status'] == 'failed')
            if fails >= 1:  # >= 10% in a 10-window
                first_bad_ts = window[0]['completed_at']
                print(f'\n  CEILING HINT: first 10-track window with a fail '
                      f'opened at {first_bad_ts}  ({fails}/10 failed)')
                break
        else:
            print('\n  CEILING HINT: no 10-track window ever had a failure '
                  '→ today\'s ceiling is HIGHER than this test. Re-run bigger.')

    print('\n' + '═' * 60)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--count', type=int, default=50)
    p.add_argument('--priority', type=int, default=5)
    p.add_argument('--source', choices=('cold', 'curated'), default='cold')
    p.add_argument('--poll-interval', type=int, default=10)
    p.add_argument('--max-wait-minutes', type=int, default=30)
    args = p.parse_args()

    if args.source == 'cold':
        print(f'Pulling {args.count} cold tracks from video_intelligence...')
        ids = find_cold_tracks(args.count)
    else:
        # cycle the curated list to requested count
        base = CURATED_TEST_IDS
        ids = (base * (args.count // len(base) + 1))[:args.count]

    if not ids:
        print('No IDs to submit. Aborting.', file=sys.stderr)
        sys.exit(1)

    print(f'Enqueueing {len(ids)} tracks at priority={args.priority}...')
    submitted = enqueue(ids, args.priority)
    submitted_at = time.time()
    print(f'Submitted {len(submitted)} / {len(ids)}. Polling every '
          f'{args.poll_interval}s (max wait {args.max_wait_minutes} min)...')

    deadline = submitted_at + args.max_wait_minutes * 60
    while time.time() < deadline:
        rows = snapshot_status(submitted)
        done = sum(1 for r in rows.values() if r['status'] == 'done')
        failed = sum(1 for r in rows.values() if r['status'] == 'failed')
        pending = sum(1 for r in rows.values() if r['status'] in ('pending', 'processing'))
        elapsed = int(time.time() - submitted_at)
        print(f'  [+{elapsed:>4d}s]  done={done} failed={failed} pending={pending}')
        if pending == 0: break
        time.sleep(args.poll_interval)

    final_rows = snapshot_status(submitted)
    report(final_rows, submitted_at)


if __name__ == '__main__':
    main()

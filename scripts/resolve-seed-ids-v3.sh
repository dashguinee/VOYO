#!/bin/bash
# Seed resolver v3 — curl-based YouTube search + oembed verification.
#
# Why v3: v1 (ytsearch1) was 23%. v2 (YT Data API) is 94% but quota-capped at
# 10k/day. v3 scrapes youtube.com/results HTML directly for candidates, then
# verifies via oembed (both no-auth endpoints). No quota, no API key.
#
# Strategy per track:
#   1. GET https://www.youtube.com/results?search_query={artist}+{title}+official
#   2. Regex out all 11-char video IDs
#   3. For top 6 candidates, verify via oembed (1 request each, instant)
#   4. Pick the candidate whose oembed title fuzzy-matches expected (SequenceMatcher)
#   5. Upsert to voyo_upload_queue
#
# Usage:
#   ONLY_NOT_DONE=1 bash scripts/resolve-seed-ids-v3.sh
#   LIMIT=10 DRY_RUN=1 bash scripts/resolve-seed-ids-v3.sh    # smoke test

set -u

SEED_FILE="${SEED_FILE:-/home/dash/voyo-music/data/seed-2025-2026/all-consolidated.json}"
SUPABASE_URL="${VOYO_SUPABASE_URL:-https://anmgyxhnyhbyxzpjhxgx.supabase.co}"
SUPABASE_KEY="${VOYO_SUPABASE_KEY:-$(grep -oE '^VITE_SUPABASE_ANON_KEY=.*' /home/dash/voyo-music/.env 2>/dev/null | head -1 | cut -d= -f2-)}"
DRY_RUN="${DRY_RUN:-0}"
LIMIT="${LIMIT:-0}"
OFFSET="${OFFSET:-0}"
ONLY_NOT_DONE="${ONLY_NOT_DONE:-0}"       # only resolve tracks NOT already status=done
CONCURRENCY="${CONCURRENCY:-6}"           # parallel tracks

[ -z "$SUPABASE_KEY" ] && { echo "ERROR: SUPABASE_KEY unset" >&2; exit 2; }

total=$(python3 -c "import json; print(len(json.load(open('$SEED_FILE'))))")
echo "seed        : $SEED_FILE ($total tracks)"
echo "supabase    : $SUPABASE_URL"
echo "mode        : $([ "$ONLY_NOT_DONE" = "1" ] && echo 'skip tracks already done' || echo 'all tracks')"
echo "concurrency : $CONCURRENCY"
[ "$DRY_RUN" = "1" ] && echo "DRY RUN — no upserts"
echo

export SEED_FILE SUPABASE_URL SUPABASE_KEY DRY_RUN LIMIT OFFSET ONLY_NOT_DONE CONCURRENCY
python3 <<'PY'
import json, os, re, sys, urllib.request, urllib.parse, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import SequenceMatcher

SEED   = os.environ['SEED_FILE']
SURL   = os.environ['SUPABASE_URL']
SKEY   = os.environ['SUPABASE_KEY']
DRY    = os.environ['DRY_RUN'] == '1'
LIMIT  = int(os.environ['LIMIT'])
OFFSET = int(os.environ['OFFSET'])
ONLY_NOT_DONE = os.environ['ONLY_NOT_DONE'] == '1'
CONC   = int(os.environ['CONCURRENCY'])

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
YTID_RE = re.compile(r'"videoId":"([A-Za-z0-9_-]{11})"')

def http_get(url, timeout=12):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', errors='ignore'), r.status

def search_candidates(artist, title):
    q = urllib.parse.quote(f"{artist} {title} official")
    try:
        html, _ = http_get(f"https://www.youtube.com/results?search_query={q}", timeout=15)
    except Exception as e:
        return []
    # dedupe while preserving order; cap at 8
    seen, ids = set(), []
    for m in YTID_RE.finditer(html):
        vid = m.group(1)
        if vid in seen: continue
        seen.add(vid)
        ids.append(vid)
        if len(ids) >= 8: break
    return ids

def oembed_verify(vid):
    """Return {title, author_name} if alive, None if dead."""
    try:
        body, status = http_get(f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json", timeout=8)
        if status != 200: return None
        d = json.loads(body)
        return {'title': d.get('title', ''), 'author': d.get('author_name', '')}
    except urllib.error.HTTPError as e:
        return None
    except Exception:
        return None

def norm(s): return re.sub(r'[^a-z0-9]', '', s.lower())

def pick_best(artist, title, ids):
    """Verify each candidate, rank by (channel contains artist, title similarity)."""
    a = norm(artist); t = norm(title)
    best = None
    best_score = -1
    for vid in ids:
        info = oembed_verify(vid)
        if not info: continue
        score = 0.0
        if a and a in norm(info['author']): score += 3.0
        score += SequenceMatcher(None, t, norm(info['title'])).ratio() * 2.0
        if 'official' in info['title'].lower(): score += 0.3
        if score > best_score:
            best_score = score; best = (vid, info, score)
    return best

def upsert(ytid, title, artist):
    body = [{'youtube_id': ytid, 'status': 'pending', 'failure_count': 0, 'last_error': None,
             'title': title, 'artist': artist, 'requested_by_session': 'seed-2025-2026'}]
    req = urllib.request.Request(
        f"{SURL}/rest/v1/voyo_upload_queue?on_conflict=youtube_id",
        data=json.dumps(body).encode(), method='POST',
        headers={'apikey': SKEY, 'Authorization': f'Bearer {SKEY}',
                 'Content-Type': 'application/json',
                 'Prefer': 'resolution=merge-duplicates,return=minimal'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status < 300
    except Exception as e:
        return False

# Pull current queue state to identify which tracks are already done
done_keys = set()
if ONLY_NOT_DONE:
    req = urllib.request.Request(f"{SURL}/rest/v1/voyo_upload_queue?requested_by_session=eq.seed-2025-2026&status=eq.done&select=artist,title",
                                 headers={'apikey': SKEY, 'Authorization': f'Bearer {SKEY}', 'Range': '0-5000'})
    with urllib.request.urlopen(req, timeout=15) as r:
        for row in json.loads(r.read()):
            k = ((row.get('artist') or '').strip().lower(), (row.get('title') or '').strip().lower())
            done_keys.add(k)
    print(f"[info] {len(done_keys)} tracks already done — will skip")

with open(SEED) as f:
    tracks = json.load(f)
if OFFSET > 0: tracks = tracks[OFFSET:]
if LIMIT > 0:  tracks = tracks[:LIMIT]

# Filter to not-done
work = []
for t in tracks:
    artist = (t.get('artist') or '').strip()
    title  = (t.get('title') or '').strip()
    if not artist or not title: continue
    if (artist.lower(), title.lower()) in done_keys: continue
    work.append((artist, title))

print(f"[info] processing {len(work)} tracks")

def handle(args):
    idx, artist, title = args
    ids = search_candidates(artist, title)
    if not ids:
        return (idx, artist, title, None, 'no_candidates')
    best = pick_best(artist, title, ids)
    if not best:
        return (idx, artist, title, None, 'no_playable')
    vid, info, score = best
    if not DRY:
        upsert(vid, title, artist)
    return (idx, artist, title, vid, f"{info['author'][:25]}, score={score:.2f}")

from collections import Counter
status_counts = Counter()
import time
t0 = time.time()

with ThreadPoolExecutor(max_workers=CONC) as pool:
    futures = [pool.submit(handle, (i, a, t)) for i, (a, t) in enumerate(work, 1)]
    for fut in as_completed(futures):
        idx, artist, title, vid, detail = fut.result()
        if vid:
            status_counts['resolved'] += 1
            print(f"[{idx}/{len(work)}] + {artist} - {title} -> {vid}  ({detail})")
        else:
            status_counts['failed'] += 1
            print(f"[{idx}/{len(work)}] x {artist} - {title}  ({detail})")

dt = time.time() - t0
print()
print("=" * 60)
print(f"processed: {len(work)}  resolved: {status_counts['resolved']}  failed: {status_counts['failed']}")
if len(work):
    print(f"hit rate:  {100*status_counts['resolved']/len(work):.1f}%")
print(f"elapsed:   {dt:.1f}s ({len(work)/max(dt,1):.1f} tracks/sec)")
PY

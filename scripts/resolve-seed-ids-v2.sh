#!/bin/bash
# Seed resolver v2 — YouTube Data API v3 edition.
#
# Why v2 exists: v1 (resolve-seed-ids.sh) used `yt-dlp ytsearch1:` which returns
# whatever video hits the query first. That gave us ~23% extraction success
# because many first-hits are dead IDs, wrong uploads, or region-locked.
#
# v2 uses YouTube Data API search.list + videos.list to:
#   1. Search top 5 candidates for each (artist + title + "official")
#   2. Filter to candidates whose channel name contains the artist OR
#      whose title closely matches our expected title
#   3. Pick the highest-viewed of the remainder
#   4. Validate via videos.list: uploadStatus=processed AND privacyStatus=public
#      AND not region-restricted for most regions
#   5. Upsert the verified ID into voyo_upload_queue
#
# Cost: search.list = 100 quota units, videos.list = 1. 489 tracks * 101 = ~50k
# units. Free tier is 10k/day — so run this in ~5 chunks or ask for quota bump.
# Per-track cost can be dropped to 1 unit if we skip search and use ytsearch1
# THEN validate with videos.list — but that defeats the point of getting better
# search results. For 100s of tracks, split runs across days or request quota.
#
# Usage:
#   YOUTUBE_API_KEY=... ./scripts/resolve-seed-ids-v2.sh
#   LIMIT=50 YOUTUBE_API_KEY=... ./scripts/resolve-seed-ids-v2.sh    # smoke test
#   ONLY_FAILED=1 YOUTUBE_API_KEY=... ./scripts/resolve-seed-ids-v2.sh   # only re-resolve failed seed rows
#   DRY_RUN=1 YOUTUBE_API_KEY=... ./scripts/resolve-seed-ids-v2.sh

set -u

SEED_FILE="${SEED_FILE:-/home/dash/voyo-music/data/seed-2025-2026/all-consolidated.json}"
SUPABASE_URL="${VOYO_SUPABASE_URL:-https://anmgyxhnyhbyxzpjhxgx.supabase.co}"
SUPABASE_KEY="${VOYO_SUPABASE_KEY:-$(grep -oE '^VITE_SUPABASE_ANON_KEY=.*' /home/dash/voyo-music/.env 2>/dev/null | head -1 | cut -d= -f2-)}"
YOUTUBE_API_KEY="${YOUTUBE_API_KEY:-$(grep -oE '^YOUTUBE_API_KEY=.*' /home/dash/voyo-music/.env 2>/dev/null | head -1 | cut -d= -f2-)}"

DRY_RUN="${DRY_RUN:-0}"
LIMIT="${LIMIT:-0}"
OFFSET="${OFFSET:-0}"
ONLY_FAILED="${ONLY_FAILED:-0}"    # only process seed rows whose current status is 'failed'

[ -z "$SUPABASE_KEY" ]   && { echo "ERROR: SUPABASE_KEY unset" >&2; exit 2; }
[ -z "$YOUTUBE_API_KEY" ] && { echo "ERROR: YOUTUBE_API_KEY unset (put in .env as VITE_GEMINI_API_KEY or export YOUTUBE_API_KEY)" >&2; exit 2; }

total=$(python3 -c "import json; print(len(json.load(open('$SEED_FILE'))))")
echo "seed       : $SEED_FILE ($total tracks)"
echo "supabase   : $SUPABASE_URL"
echo "api key    : ${YOUTUBE_API_KEY:0:10}... (YouTube Data API v3)"
echo "mode       : $([ "$ONLY_FAILED" = "1" ] && echo 'retry failed seed rows' || echo 'fill empty + validate all')"
[ "$DRY_RUN" = "1" ] && echo "DRY RUN — no upserts"
[ "$LIMIT" != "0" ] && echo "limit      : $LIMIT"
echo

export SEED_FILE SUPABASE_URL SUPABASE_KEY YOUTUBE_API_KEY DRY_RUN LIMIT OFFSET ONLY_FAILED
python3 <<'PY'
import json, os, re, sys, time, urllib.request, urllib.parse, urllib.error
from difflib import SequenceMatcher

SEED   = os.environ['SEED_FILE']
SURL   = os.environ['SUPABASE_URL']
SKEY   = os.environ['SUPABASE_KEY']
YT_KEY = os.environ['YOUTUBE_API_KEY']
DRY    = os.environ['DRY_RUN'] == '1'
LIMIT  = int(os.environ['LIMIT'])
OFFSET = int(os.environ['OFFSET'])
ONLY_FAILED = os.environ['ONLY_FAILED'] == '1'

YT_API = 'https://www.googleapis.com/youtube/v3'

def http_json(url: str, timeout=15):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())

def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', s.lower())

def search_candidates(artist: str, title: str):
    """Return up to 5 YouTube video candidates for the artist+title query."""
    q = f"{artist} {title} official"
    url = f"{YT_API}/search?part=snippet&q={urllib.parse.quote(q)}&type=video&maxResults=5&key={YT_KEY}"
    try:
        d = http_json(url)
    except urllib.error.HTTPError as e:
        if e.code == 403:
            print(f"   403 from YT API: {e.read().decode()[:200]}", file=sys.stderr)
            raise
        return []
    except Exception as e:
        print(f"   YT search error: {e}", file=sys.stderr)
        return []
    out = []
    for it in d.get('items', []):
        vid = (it.get('id') or {}).get('videoId')
        if not vid: continue
        sn = it.get('snippet') or {}
        out.append({
            'id': vid,
            'title': sn.get('title', ''),
            'channel': sn.get('channelTitle', ''),
            'description': sn.get('description', ''),
            'publishedAt': sn.get('publishedAt', ''),
        })
    return out

def validate_ids(ids: list):
    """Call videos.list for up to 50 ids; return map of id -> {playable: bool, title, viewCount, ...}."""
    if not ids: return {}
    url = f"{YT_API}/videos?part=status,statistics,snippet,contentDetails&id={','.join(ids)}&key={YT_KEY}"
    try:
        d = http_json(url)
    except Exception as e:
        print(f"   YT validate error: {e}", file=sys.stderr)
        return {}
    out = {}
    for it in d.get('items', []):
        vid = it.get('id')
        st = it.get('status') or {}
        sn = it.get('snippet') or {}
        cd = it.get('contentDetails') or {}
        stats = it.get('statistics') or {}
        playable = (
            st.get('uploadStatus') == 'processed'
            and st.get('privacyStatus') == 'public'
            and st.get('embeddable', True)
        )
        # Region block detection: allowed might be small subset → skip
        reg = cd.get('regionRestriction') or {}
        if reg.get('blocked') and len(reg['blocked']) > 20:
            playable = False  # widely blocked
        if reg.get('allowed') and len(reg['allowed']) < 100:
            playable = False  # narrowly allowed
        out[vid] = {
            'playable': playable,
            'title': sn.get('title', ''),
            'channel': sn.get('channelTitle', ''),
            'views': int(stats.get('viewCount', 0)),
            'duration': cd.get('duration', ''),
            'privacyStatus': st.get('privacyStatus'),
            'uploadStatus': st.get('uploadStatus'),
        }
    return out

def pick_best(artist: str, title: str, candidates: list, validation: dict):
    """Rank candidates, return the best playable id or None."""
    a_norm = norm(artist)
    t_norm = norm(title)
    ranked = []
    for c in candidates:
        v = validation.get(c['id'])
        if not v or not v['playable']:
            continue
        score = 0.0
        # Channel match matters a lot
        if a_norm and a_norm in norm(c['channel']):
            score += 3.0
        # Title similarity
        score += SequenceMatcher(None, t_norm, norm(c['title'])).ratio() * 2.0
        # View count (log-scale nudge)
        if v['views'] > 0:
            import math
            score += min(math.log10(v['views']) / 10, 0.7)
        # Prefer "Official" in title
        if 'official' in c['title'].lower():
            score += 0.3
        ranked.append((score, c, v))
    if not ranked:
        return None
    ranked.sort(key=lambda x: -x[0])
    return ranked[0]   # (score, candidate, validation)

def queue_current_status():
    """Fetch seed rows currently in the queue; return dict (artist_lower, title_lower) -> row."""
    url = f"{SURL}/rest/v1/voyo_upload_queue?requested_by_session=eq.seed-2025-2026&select=id,youtube_id,title,artist,status"
    req = urllib.request.Request(url, headers={'apikey': SKEY, 'Authorization': f'Bearer {SKEY}', 'Range': '0-5000'})
    with urllib.request.urlopen(req, timeout=15) as r:
        rows = json.loads(r.read())
    m = {}
    for r in rows:
        k = ((r.get('artist') or '').strip().lower(), (r.get('title') or '').strip().lower())
        m[k] = r
    return m

def upsert(ytid: str, title: str, artist: str):
    body = [{
        'youtube_id': ytid,
        'status': 'pending',
        'failure_count': 0,
        'last_error': None,
        'title': title,
        'artist': artist,
        'requested_by_session': 'seed-2025-2026',
    }]
    req = urllib.request.Request(
        f"{SURL}/rest/v1/voyo_upload_queue?on_conflict=youtube_id",
        data=json.dumps(body).encode(),
        method='POST',
        headers={
            'apikey': SKEY, 'Authorization': f'Bearer {SKEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status < 300
    except urllib.error.HTTPError as e:
        print(f"   upsert HTTP {e.code}: {e.read().decode()[:200]}", file=sys.stderr)
        return False

# ── Main ──────────────────────────────────────────────────────────────────
with open(SEED) as f:
    tracks = json.load(f)

if OFFSET > 0: tracks = tracks[OFFSET:]
if LIMIT  > 0: tracks = tracks[:LIMIT]

current_queue = queue_current_status() if ONLY_FAILED else {}

s = dict(considered=0, resolved=0, reused=0, no_candidate=0, no_playable=0, upserted=0, skipped=0, api_errors=0)

for i, t in enumerate(tracks, 1):
    title  = (t.get('title')  or '').strip()
    artist = (t.get('artist') or '').strip()
    if not title or not artist:
        s['skipped'] += 1; continue

    if ONLY_FAILED:
        row = current_queue.get((artist.lower(), title.lower()))
        if not row or row.get('status') != 'failed':
            s['skipped'] += 1; continue

    s['considered'] += 1
    try:
        cands = search_candidates(artist, title)
    except urllib.error.HTTPError as e:
        if e.code == 403:
            print(f"\n[{i}/{len(tracks)}] YT API quota/permission error — stopping.")
            s['api_errors'] += 1
            break
        s['api_errors'] += 1
        continue

    if not cands:
        s['no_candidate'] += 1
        print(f"[{i}/{len(tracks)}] x {artist} - {title} — no search candidates")
        continue

    val = validate_ids([c['id'] for c in cands])
    best = pick_best(artist, title, cands, val)
    if not best:
        s['no_playable'] += 1
        print(f"[{i}/{len(tracks)}] x {artist} - {title} — no playable candidate (searched {len(cands)})")
        continue

    score, c, v = best
    ytid = c['id']
    s['resolved'] += 1
    prefix = f"[{i}/{len(tracks)}] + {artist} - {title} -> {ytid} ({v['channel']}, {v['views']:,} views, score={score:.2f})"

    if DRY:
        print(prefix + '  (dry)')
        continue

    if upsert(ytid, title, artist):
        s['upserted'] += 1
        print(prefix)
    else:
        print(prefix + '  UPSERT FAILED')

print()
print('=' * 70)
for k, v in s.items():
    print(f"  {k:14s} {v}")
print('=' * 70)
if s['considered']:
    print(f"Playable hit rate: {s['resolved']}/{s['considered']} = {100*s['resolved']/s['considered']:.1f}%")
PY

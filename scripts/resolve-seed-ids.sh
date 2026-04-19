#!/bin/bash
# VOYO seed resolver — take curated (artist+title) seed list, resolve canonical
# YouTube IDs via yt-dlp ytsearch1 on the VPS, and upsert into voyo_upload_queue
# so Tier-A workers pick them up for R2 extraction.
#
# Runs locally. Uses ssh to the VPS for each yt-dlp call (the VPS has nightly
# yt-dlp + bgutil POT + Chrome profile cookies — Tier A setup). Upsert goes
# straight to Supabase REST with the anon key (queue has anon INSERT policy).
#
# Usage:
#   ./scripts/resolve-seed-ids.sh                            # default: only fill empty ids
#   SEED_FILE=path/to.json ./scripts/resolve-seed-ids.sh     # alt seed
#   VALIDATE_EXISTING=1 ./scripts/resolve-seed-ids.sh        # re-resolve ALL rows
#   DRY_RUN=1 ./scripts/resolve-seed-ids.sh                  # resolve, don't upsert
#   LIMIT=10 ./scripts/resolve-seed-ids.sh                   # first N tracks (smoke test)

set -u

SEED_FILE="${SEED_FILE:-/home/dash/voyo-music/data/seed-2025-2026/all-consolidated.json}"
SUPABASE_URL="${VOYO_SUPABASE_URL:-https://anmgyxhnyhbyxzpjhxgx.supabase.co}"
SUPABASE_KEY="${VOYO_SUPABASE_KEY:-$(grep -oE '^VITE_SUPABASE_ANON_KEY=.*' /home/dash/voyo-music/.env 2>/dev/null | head -1 | cut -d= -f2-)}"
VPS_HOST="${VPS_HOST:-vps}"
VALIDATE_EXISTING="${VALIDATE_EXISTING:-0}"
DRY_RUN="${DRY_RUN:-0}"
LIMIT="${LIMIT:-0}"
OFFSET="${OFFSET:-0}"

[ -z "$SUPABASE_KEY" ] && { echo "ERROR: VOYO_SUPABASE_KEY not set and not found in .env" >&2; exit 2; }
[ ! -f "$SEED_FILE" ] && { echo "ERROR: seed file not found: $SEED_FILE" >&2; exit 2; }

total=$(python3 -c "import json; print(len(json.load(open('$SEED_FILE'))))")
echo "seed     : $SEED_FILE ($total tracks)"
echo "vps      : $VPS_HOST"
echo "supabase : $SUPABASE_URL"
echo "mode     : $([ "$VALIDATE_EXISTING" = "1" ] && echo 're-resolve all' || echo 'only empty youtube_id')"
[ "$DRY_RUN" = "1" ] && echo "DRY RUN — no upserts"
[ "$LIMIT" != "0" ] && echo "limit    : $LIMIT"
echo

export SEED_FILE SUPABASE_URL SUPABASE_KEY VPS_HOST VALIDATE_EXISTING DRY_RUN LIMIT OFFSET
python3 <<'PY'
import json, os, re, subprocess, sys, urllib.request

SEED   = os.environ['SEED_FILE']
URL    = os.environ['SUPABASE_URL']
KEY    = os.environ['SUPABASE_KEY']
VPS    = os.environ['VPS_HOST']
VALID  = os.environ['VALIDATE_EXISTING'] == '1'
DRY    = os.environ['DRY_RUN'] == '1'
LIMIT  = int(os.environ['LIMIT'])
OFFSET = int(os.environ['OFFSET'])

with open(SEED) as f:
    tracks = json.load(f)
if OFFSET > 0:
    tracks = tracks[OFFSET:]
if LIMIT > 0:
    tracks = tracks[:LIMIT]

YTID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')

def resolve(title: str, artist: str) -> str | None:
    # ytsearch1 on the VPS. --flat-playlist + --print id returns just the ID.
    # Title/artist get single-quoted so yt-dlp sees them as one search term.
    q = f"{artist} {title} official audio".replace("'", " ")
    cmd = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
           VPS,
           f"yt-dlp --no-warnings --flat-playlist --print id 'ytsearch1:{q}' 2>/dev/null | head -1"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        out = (r.stdout or '').strip()
        return out if YTID_RE.match(out) else None
    except subprocess.TimeoutExpired:
        return None
    except Exception as e:
        print(f"   ssh error: {e}", file=sys.stderr)
        return None

def upsert(ytid: str, title: str, artist: str) -> bool:
    body = [{
        "youtube_id": ytid,
        "status": "pending",
        "title": title,
        "artist": artist,
        "requested_by_session": "seed-2025-2026",
    }]
    req = urllib.request.Request(
        f"{URL}/rest/v1/voyo_upload_queue?on_conflict=youtube_id",
        data=json.dumps(body).encode(),
        method='POST',
        headers={
            'apikey': KEY,
            'Authorization': f'Bearer {KEY}',
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
    except Exception as e:
        print(f"   upsert error: {e}", file=sys.stderr)
        return False

s = dict(already_had=0, resolved=0, no_match=0, upserted=0, failed=0, skipped=0)

for i, t in enumerate(tracks, 1):
    ytid   = (t.get('youtube_id') or '').strip()
    title  = (t.get('title') or '').strip()
    artist = (t.get('artist') or '').strip()
    if not title or not artist:
        s['skipped'] += 1
        continue

    if ytid and YTID_RE.match(ytid) and not VALID:
        s['already_had'] += 1
        prefix = f"[{i}/{len(tracks)}] = {artist} - {title}  ({ytid})"
    else:
        resolved = resolve(title, artist)
        if resolved:
            ytid = resolved
            s['resolved'] += 1
            prefix = f"[{i}/{len(tracks)}] + {artist} - {title} -> {ytid}"
        else:
            s['no_match'] += 1
            print(f"[{i}/{len(tracks)}] x {artist} - {title} — no match")
            continue

    if DRY:
        print(prefix + "  (dry)")
        continue

    if upsert(ytid, title, artist):
        s['upserted'] += 1
        print(prefix)
    else:
        s['failed'] += 1
        print(prefix + "  UPSERT FAILED")

print("")
print("=" * 64)
for k, v in s.items():
    print(f"  {k:14s} {v}")
print("=" * 64)
print(f"Queued into voyo_upload_queue: {s['upserted']} / {len(tracks)}")
if s['no_match']:
    print(f"No-match tracks need manual review (see `x` lines above).")
PY

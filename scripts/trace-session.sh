#!/bin/bash
# Render a session's trace timeline. Usage:
#   bash scripts/trace-session.sh                    — most recent session
#   bash scripts/trace-session.sh <session_id>       — specific
#   bash scripts/trace-session.sh --only bg          — only background events
#   bash scripts/trace-session.sh --from <ISO-time>  — events since X
set -e

AK="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4"
URL="https://anmgyxhnyhbyxzpjhxgx.supabase.co/rest/v1/voyo_playback_events"

SID=""
ONLY=""
FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2;;
    --from) FROM="$2"; shift 2;;
    *) SID="$1"; shift;;
  esac
done

# Discover most-recent session if not given
if [ -z "$SID" ]; then
  SID=$(curl -s -H "apikey: $AK" -H "Authorization: Bearer $AK" \
    "$URL?select=session_id&order=created_at.desc&limit=1" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['session_id'])")
  echo "Session: $SID (most recent)"
else
  echo "Session: $SID"
fi

Q="$URL?session_id=eq.$SID&select=event_type,track_id,track_title,error_code,is_background,meta,created_at&order=created_at.asc&limit=500"
[ -n "$FROM" ] && Q="$Q&created_at=gte.$FROM"

curl -s -H "apikey: $AK" -H "Authorization: Bearer $AK" "$Q" | \
python3 -c "
import json, sys
rows = json.load(sys.stdin)
if not rows: print('(no events)'); sys.exit()

only = '$ONLY'
def visible(r):
    if only == 'bg' and not r.get('is_background'): return False
    if only == 'fg' and r.get('is_background'): return False
    return True

first_ts = rows[0]['created_at']
from datetime import datetime
def parse(t):
    return datetime.fromisoformat(t.replace('Z','+00:00'))

first = parse(first_ts)
print(f'=== {len(rows)} events, {first.strftime(\"%H:%M:%S\")} → {parse(rows[-1][\"created_at\"]).strftime(\"%H:%M:%S\")} ===')
print()

shown = 0
for r in rows:
    if not visible(r): continue
    shown += 1
    t = parse(r['created_at'])
    delta = (t - first).total_seconds()
    bg = '🌙' if r.get('is_background') else '☀️'
    e = r['event_type']
    tid = (r.get('track_id') or '-')[:11]
    title = (r.get('track_title') or '')[:22]
    code = r.get('error_code') or ''
    meta = r.get('meta') or {}
    sub = meta.get('subtype') or ''
    why = meta.get('why') or meta.get('label') or meta.get('path') or meta.get('source') or ''
    extra_parts = []
    for k in ('hidden','attempt','cascade','err','storeIsPlaying','state','prevId','prevEndedRef'):
        if k in meta: extra_parts.append(f'{k}={meta[k]}')
    extra = ' '.join(extra_parts)
    label = f'{e}:{sub}' if sub else e
    print(f'  +{delta:7.2f}s {bg} {label:28} {tid:11} {why:20} {code:10} {extra[:70]}')
print()
print(f'(shown {shown}/{len(rows)})')"

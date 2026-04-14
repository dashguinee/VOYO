#!/bin/bash
# Live-tail trace events as you use the app. Auto-detects known pathologies.
# Usage:
#   bash scripts/trace-watch.sh              — watch most recent active session
#   bash scripts/trace-watch.sh <session_id> — watch specific
#   bash scripts/trace-watch.sh --any        — watch ALL events (any session)

AK="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4"
URL="https://anmgyxhnyhbyxzpjhxgx.supabase.co/rest/v1/voyo_playback_events"

MODE="auto"   # auto = recent session, any = all sessions, sid = specific
SID=""
case "$1" in
  --any) MODE="any";;
  "")    MODE="auto";;
  *)     MODE="sid"; SID="$1";;
esac

# Resolve session
if [ "$MODE" = "auto" ]; then
  SID=$(curl -s -H "apikey: $AK" -H "Authorization: Bearer $AK" \
    "$URL?select=session_id&order=created_at.desc&limit=1" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['session_id'])")
  echo "▸ Watching session: $SID"
elif [ "$MODE" = "any" ]; then
  echo "▸ Watching ALL events from any session"
else
  echo "▸ Watching session: $SID"
fi

echo "▸ Polling every 2s. Ctrl-C to stop."
echo "▸ Pathologies are auto-flagged in line."
echo ""

# Fetch initial cursor — only show events AFTER this point
LAST=$(date -u +"%Y-%m-%dT%H:%M:%S.%6N+00:00")

# Sliding window of recent events for pathology detection
python3 -u <<PY &
import json, urllib.request, time, sys, os
from collections import deque

AK = "$AK"
URL = "$URL"
MODE = "$MODE"
SID = "$SID"
LAST = "$LAST"
HEADERS = {'apikey': AK, 'Authorization': 'Bearer ' + AK}

# Pathology window — last 20 events to detect cross-event patterns
window = deque(maxlen=20)

# Pathology counters
pathologies = {
    'double_ended': 0,    # ended_fire X then ended_fire Y in <100ms
    'silent_stall': 0,    # play_start with no play_resolved within 10s
    'cookie_fail': 0,     # play_fail with vps_timeout
    'cascade': 0,         # 3+ skip_auto in 5s
    'stale_caught': 0,    # ended_dedup audio_not_ended_stale (v183 working)
}

def colored(s, c):
    codes = {'red': 91, 'gold': 33, 'green': 92, 'cyan': 96, 'gray': 90, 'magenta': 95}
    return f'\033[{codes.get(c, 0)}m{s}\033[0m'

def detect_pathologies(rows):
    if len(rows) < 2: return []
    flags = []
    last = rows[-1]
    e = last['event_type']
    meta = last.get('meta') or {}
    sub = meta.get('subtype', '')

    # v183 fix WORKING — stale ended caught
    if e == 'trace' and sub == 'ended_dedup' and meta.get('why') == 'audio_not_ended_stale':
        pathologies['stale_caught'] += 1
        flags.append(colored('  ✓ v183 caught a stale React onEnded duplicate', 'green'))

    # Double-ended (the bug v183 was meant to fix — should be 0)
    if e == 'trace' and sub == 'ended_fire':
        prevs = [r for r in list(window)[-5:-1] if (r.get('meta') or {}).get('subtype') == 'ended_fire']
        if prevs:
            flags.append(colored(f'  ⚠ DOUBLE ended_fire — {prevs[-1][\"track_id\"][:8]} then {last[\"track_id\"][:8]}', 'red'))
            pathologies['double_ended'] += 1

    # Cookie failure
    if e == 'play_fail' and (last.get('error_code') or '').startswith('vps'):
        pathologies['cookie_fail'] += 1
        flags.append(colored('  ⚠ extraction timeout (cookies likely dead or track restricted)', 'gold'))

    # Cascade detection — 3+ skip_auto in last 5s
    skips_5s = 0
    from datetime import datetime
    def parse(t): return datetime.fromisoformat(t.replace('Z','+00:00'))
    now_ts = parse(last['created_at'])
    for r in window:
        if r['event_type'] == 'skip_auto':
            try:
                if (now_ts - parse(r['created_at'])).total_seconds() < 5:
                    skips_5s += 1
            except: pass
    if e == 'skip_auto' and skips_5s >= 3:
        pathologies['cascade'] += 1
        flags.append(colored(f'  ⚠ cascade — {skips_5s} skips in 5s (extraction broken)', 'red'))

    return flags

def fmt(r, t0):
    from datetime import datetime
    t = datetime.fromisoformat(r['created_at'].replace('Z','+00:00'))
    delta = (t - t0).total_seconds()
    bg = '🌙' if r.get('is_background') else '☀️'
    e = r['event_type']
    tid = (r.get('track_id') or '-')[:11]
    title = (r.get('track_title') or '')[:22]
    code = r.get('error_code') or ''
    meta = r.get('meta') or {}
    sub = meta.get('subtype') or ''
    extra = ' '.join(f'{k}={v}' for k, v in meta.items() if k in ('hidden','attempt','cascade','err','why','path','from','source','audioEnded','readyState') and v is not None)[:60]
    label = f'{e}:{sub}' if sub else e
    color = 'gray'
    if e == 'play_success' or sub == 'play_resolved': color = 'green'
    elif e in ('play_fail','skip_auto') or sub in ('play_rejected','play_failure','audio_error','ended_dedup'): color = 'red'
    elif sub in ('ended_fire','next_call','load_enter'): color = 'cyan'
    elif sub in ('visibility','silent_wav_engage'): color = 'magenta'
    elif sub == 'ended_dedup' and meta.get('why') == 'audio_not_ended_stale': color = 'green'
    return colored(f'  +{delta:6.2f}s {bg} {label:24} {tid:11} {title[:22]:22} {code:12} {extra}', color)

t0 = None
last_iso = LAST

while True:
    try:
        q = f'{URL}?select=event_type,track_id,track_title,error_code,is_background,meta,session_id,created_at&order=created_at.asc&limit=200&created_at=gt.{last_iso}'
        if MODE == 'sid':
            q += f'&session_id=eq.{SID}'
        elif MODE == 'auto':
            q += f'&session_id=eq.{SID}'
        req = urllib.request.Request(q, headers=HEADERS)
        rows = json.loads(urllib.request.urlopen(req, timeout=10).read())
        if rows:
            from datetime import datetime
            if t0 is None:
                t0 = datetime.fromisoformat(rows[0]['created_at'].replace('Z','+00:00'))
            for r in rows:
                window.append(r)
                print(fmt(r, t0), flush=True)
                for flag in detect_pathologies(rows[:rows.index(r)+1]):
                    print(flag, flush=True)
            last_iso = rows[-1]['created_at']
        time.sleep(2)
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as ex:
        print(colored(f'  poll error: {ex}', 'gray'), flush=True)
        time.sleep(3)
PY

WATCHER_PID=$!
trap "kill $WATCHER_PID 2>/dev/null; echo ''; echo '— stopped —'; exit 0" INT
wait $WATCHER_PID

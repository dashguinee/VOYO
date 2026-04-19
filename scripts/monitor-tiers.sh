#!/bin/bash
# VOYO tier monitor — run hourly. Emits alerts if Tier A degrades or
# Webshare usage rises. Silent when healthy.

set -e
TIER_A_MIN_PCT=${TIER_A_MIN_PCT:-85}
WEBSHARE_MAX_PCT=${WEBSHARE_MAX_PCT:-5}
URL="${VOYO_SUPABASE_URL:-https://anmgyxhnyhbyxzpjhxgx.supabase.co}"
KEY="${VOYO_SUPABASE_ANON_KEY:-$(grep -oE 'VITE_SUPABASE_ANON_KEY=.*' /home/dash/voyo-music/.env 2>/dev/null | head -1 | cut -d= -f2)}"
[ -z "$KEY" ] && { echo "ERROR: VOYO_SUPABASE_ANON_KEY unset" >&2; exit 2; }

SINCE=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)
DATA=$(curl -s "$URL/rest/v1/voyo_playback_events?select=meta&event_type=eq.trace&created_at=gte.$SINCE" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Range: 0-49999" --max-time 15)

echo "$DATA" | TIER_A_MIN_PCT=$TIER_A_MIN_PCT WEBSHARE_MAX_PCT=$WEBSHARE_MAX_PCT python3 <<'PY'
import json, os, sys, collections
try: rows = json.loads(sys.stdin.read())
except: rows = []
tier_a_min = int(os.environ['TIER_A_MIN_PCT']); webshare_max = int(os.environ['WEBSHARE_MAX_PCT'])

sources = collections.Counter()
for r in rows:
    m = r.get('meta') or {}
    if m.get('subtype') == 'extract_tier':
        sources[m.get('tier','?')] += 1

total = sum(sources.values())
if total == 0:
    print('[tier-monitor] no extractions in the last hour — idle or degraded')
    sys.exit(0)

def pct(s): return 100 * sources.get(s,0)/total
noproxy = pct('noproxy'); pool = pct('pool'); home = pct('home_tunnel'); webshare = pct('webshare')
print(f'[tier-monitor] {total} extractions | noproxy={noproxy:.0f}% pool={pool:.0f}% home={home:.0f}% webshare={webshare:.0f}%')

alerts = []
if noproxy < tier_a_min: alerts.append(f'TIER A DEGRADED: noproxy={noproxy:.0f}% < {tier_a_min}%')
if webshare > webshare_max: alerts.append(f'WEBSHARE USAGE HIGH: {webshare:.0f}% > {webshare_max}%')
if alerts:
    for a in alerts: print(a, file=sys.stderr)
    sys.exit(1)
PY

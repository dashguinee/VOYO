#!/bin/bash
# VOYO Webshare usage readout.

set -e
URL="${VOYO_SUPABASE_URL:-https://anmgyxhnyhbyxzpjhxgx.supabase.co}"
KEY="${VOYO_SUPABASE_ANON_KEY:-$(grep -oE 'VITE_SUPABASE_ANON_KEY=.*' /home/dash/voyo-music/.env 2>/dev/null | head -1 | cut -d= -f2)}"
AVG_MB="${AVG_TRACK_MB:-6}"
CAP_MB="${WEBSHARE_CAP_MB:-1024}"
SINCE=$(date -u +%Y-%m-01T00:00:00)

DATA=$(curl -s "$URL/rest/v1/voyo_playback_events?select=meta&event_type=eq.trace&created_at=gte.$SINCE" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Range: 0-49999" --max-time 30)

echo "$DATA" | AVG_MB=$AVG_MB CAP_MB=$CAP_MB python3 <<'PY'
import json, os, sys, collections
try: rows = json.loads(sys.stdin.read())
except: rows = []
avg_mb = int(os.environ['AVG_MB']); cap_mb = int(os.environ['CAP_MB'])

c = collections.Counter()
for r in rows:
    m = r.get('meta') or {}
    if m.get('subtype') == 'extract_tier':
        c[m.get('tier','?')] += 1
total = sum(c.values())
if total == 0:
    print("No extraction events this month — either all plays hit R2 (ideal) or telemetry is down.")
    sys.exit(0)
def pct(s): return 100 * c.get(s,0)/total
def mb(s):  return c.get(s,0)*avg_mb
print(f"extractions this month: {total}")
print(f"  noproxy (Tier A):   {c.get('noproxy',0):>5}  {pct('noproxy'):.1f}%   ~{mb('noproxy')} MB  (free)")
print(f"  pool:               {c.get('pool',0):>5}  {pct('pool'):.1f}%   ~{mb('pool')} MB  (free)")
print(f"  home_tunnel:        {c.get('home_tunnel',0):>5}  {pct('home_tunnel'):.1f}%   ~{mb('home_tunnel')} MB  (free)")
print(f"  webshare:           {c.get('webshare',0):>5}  {pct('webshare'):.1f}%   ~{mb('webshare')} MB  (PAID)")
print()
wmb = mb('webshare'); used = 100*wmb/cap_mb
print(f"Webshare bandwidth: {wmb} MB / {cap_mb} MB cap ({used:.0f}%)")
if used > 80:   print("  ⚠ approaching plan cap")
elif used > 20: print("  some Tier A fall-through")
else:           print("  ✓ healthy — Webshare rarely used")
PY

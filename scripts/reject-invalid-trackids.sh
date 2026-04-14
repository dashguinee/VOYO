#!/bin/bash
# Reject non-YouTube-format track IDs early so client doesn't waste 20s of retries.
# Real YouTube IDs are exactly 11 chars, [A-Za-z0-9_-]. Anything else (vyo_*, VOYO_*,
# corrupted ids) gets an immediate 404 → client falls back to iframe path.

set -e
SRC=/home/ubuntu/voyo-proxy.js

sudo python3 <<'PY'
p = '/home/ubuntu/voyo-proxy.js'
s = open(p).read()

# Inject early validation right after extracting trackId from the request.
# Find the line that parses trackId from /voyo/audio/{trackId}.
old = "console.log(`[VOYO] Audio request: ${trackId} @ ${quality} (${bitrate})`);"
new = """console.log(`[VOYO] Audio request: ${trackId} @ ${quality} (${bitrate})`);
    // Reject IDs that aren't valid YouTube format. Saves 20s of pointless retries.
    if (!/^[A-Za-z0-9_-]{11}$/.test(trackId)) {
      console.log(`[VOYO] Rejecting invalid trackId format: ${trackId}`);
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid track ID format", trackId }));
      return;
    }"""

if old in s and 'Rejecting invalid trackId format' not in s:
  s = s.replace(old, new)
  open(p, 'w').write(s)
  print('patched')
else:
  print('skip — anchor not found or already patched')
PY

node --check "$SRC" && echo "syntax OK"
sudo pm2 restart voyo-audio --update-env
sleep 2

echo ""
echo "=== Test: vyo_-prefix should now 404 instantly, no retries ==="
curl -s -m 5 -o /tmp/x.bin "https://stream.zionsynapse.online:8443/voyo/audio/vyo_am9pRHYtU1E3NHc?quality=high" -w "  HTTP=%{http_code} time=%{time_total}s body=%{size_download}B\n"
head -c 100 /tmp/x.bin; echo
rm -f /tmp/x.bin

echo ""
echo "=== Sanity: real ID still works ==="
curl -s -I -m 30 "https://stream.zionsynapse.online:8443/voyo/audio/g_hgm2Mf6Ag?quality=high" | head -2

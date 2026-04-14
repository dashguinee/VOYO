#!/bin/bash
# Ship: 3-cookie rotation + R2 upload via edge worker. Minimal surface.

set -e

echo "=== 1. Filter + ship both new cookie files ==="
for pair in "(1).txt:002" "(2).txt:003"; do
  SRC="/mnt/c/Users/User/Downloads/www.youtube.com_cookies ${pair%:*}"
  ID="${pair##*:}"
  TMP="/tmp/cookies-${ID}-local.txt"
  awk -F'\t' 'BEGIN{print "# Netscape HTTP Cookie File"} $1 ~ /\.youtube\.com$/' "$SRC" > "$TMP"
  echo "  $ID: $(wc -l <"$TMP") lines"
  scp "$TMP" "vps:/tmp/cookies-${ID}.txt"
  rm "$TMP"
done

echo ""
echo "=== 2. Install rotation + R2 patch on VPS (single remote session) ==="
ssh vps 'bash -s' <<'REMOTE'
set -e

echo "--- Move new cookies into /opt/voyo/ with rotation naming ---"
sudo chattr -i /opt/voyo/cookies.txt 2>/dev/null || true
[ -f /opt/voyo/cookies.txt ] && sudo mv /opt/voyo/cookies.txt /opt/voyo/cookies-001.txt 2>/dev/null || true
sudo mv /tmp/cookies-002.txt /opt/voyo/cookies-002.txt
sudo mv /tmp/cookies-003.txt /opt/voyo/cookies-003.txt
sudo chown root:root /opt/voyo/cookies-*.txt
sudo chmod 600 /opt/voyo/cookies-*.txt
sudo ls -la /opt/voyo/cookies-*.txt

echo ""
echo "--- Rotation wrapper: random pick across cookies-NNN.txt ---"
sudo tee /usr/local/bin/yt-dlp-safe >/dev/null <<'WRAP'
#!/bin/bash
shopt -s nullglob
MASTERS=(/opt/voyo/cookies-[0-9][0-9][0-9].txt)
[ ${#MASTERS[@]} -eq 0 ] && MASTERS=(/opt/voyo/cookies.txt)
MASTER="${MASTERS[RANDOM % ${#MASTERS[@]}]}"
TMP=$(mktemp /tmp/ytc.XXXXXX)
chmod 600 "$TMP"
cp "$MASTER" "$TMP"
trap 'rm -f "$TMP"' EXIT
exec /usr/local/bin/yt-dlp --cookies "$TMP" "$@"
WRAP
sudo chmod 755 /usr/local/bin/yt-dlp-safe

echo ""
echo "--- Lock cookies to prevent any path from writing ---"
for f in /opt/voyo/cookies-*.txt; do sudo chattr +i "$f" 2>/dev/null || true; done

echo ""
echo "--- Smoke-test rotation (3 runs, any healthy account should return a googlevideo URL) ---"
for i in 1 2 3; do
  RES=$(sudo /usr/local/bin/yt-dlp-safe -f bestaudio --get-url "https://www.youtube.com/watch?v=g_hgm2Mf6Ag" 2>&1)
  if echo "$RES" | grep -q "googlevideo.com"; then echo "  run $i: ✅ URL returned"; else echo "  run $i: ❌ $(echo "$RES" | tail -1 | head -c 80)"; fi
done

echo ""
echo "--- Patch voyo-proxy.js: real R2 upload + edge-worker cache check ---"
SRC=/home/ubuntu/voyo-proxy.js
BAK="${SRC}.bak-r2-$(date +%Y%m%d-%H%M%S)"
sudo cp "$SRC" "$BAK"

sudo python3 <<'PY'
p = '/home/ubuntu/voyo-proxy.js'
s = open(p).read()

# 1) Replace stub uploadToR2 with real POST to edge worker
old = '''async function uploadToR2(filePath, key) {
  // TODO: implement S3-compatible upload to R2
  // For now, log the intent — the edge worker's existing upload path
  // handles R2 writes from the client side. This server-side upload
  // will be wired in the next sprint with proper AWS SDK v3.
  console.log(`[VOYO] R2 upload pending: ${key} (${filePath})`);
}'''
new = '''async function uploadToR2(filePath, key) {
  // Edge worker owns the R2 binding (wrangler.toml: VOYO_AUDIO).
  // VPS POSTs audio bytes; worker writes to R2 + upserts Supabase atomically.
  // Zero creds needed on VPS side. Key format: audio/{trackId}/{quality}.opus
  const m = key.match(/audio\\/([^/]+)\\/([^/]+)\\.opus/);
  if (!m) { console.error(`[VOYO] R2 upload: bad key ${key}`); return; }
  const [, trackId, quality] = m;
  try {
    const buf = fs.readFileSync(filePath);
    const url = `https://voyo-edge.dash-webtv.workers.dev/upload/${trackId}?q=${quality}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'audio/ogg' }, body: buf });
    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      console.log(`[VOYO] R2 uploaded ${trackId} (${buf.length}B, status=${j.status||'ok'})`);
    } else {
      console.error(`[VOYO] R2 upload HTTP ${res.status} for ${trackId}`);
    }
  } catch (e) {
    console.error(`[VOYO] R2 upload error ${trackId}: ${e.message}`);
  }
}'''
if old not in s:
  print('ERROR: stub uploadToR2 not found — may already be patched. Aborting to avoid double-patch.')
  import sys; sys.exit(1)
s = s.replace(old, new)

# 2) Point R2_BASE at the edge worker (was voyo-cdn which doesn't exist)
s = s.replace('const R2_BASE = "https://voyo-cdn.dash-webtv.workers.dev";',
              'const R2_BASE = "https://voyo-edge.dash-webtv.workers.dev";')

# 3) Fix cache-check URL to match edge worker's /audio?q= contract
s = s.replace('const r2Url = `${R2_BASE}/audio/${trackId}/${quality}.opus`;',
              'const r2Url = `${R2_BASE}/audio/${trackId}?q=${quality}`;')

open(p,'w').write(s)
print('patch applied: 3 replacements')
PY

echo ""
echo "--- Syntax check ---"
node --check /home/ubuntu/voyo-proxy.js && echo "OK"

echo ""
echo "--- Restart voyo-audio ---"
sudo pm2 restart voyo-audio --update-env
sleep 3
sudo pm2 list | grep voyo-audio

echo ""
echo "=== 3. End-to-end validation ==="
echo "--- Request 1: fresh extraction (no R2 cache yet) ---"
curl -s -m 90 -o /tmp/r1.opus "https://stream.zionsynapse.online:8443/voyo/audio/g_hgm2Mf6Ag?quality=high" -w "  HTTP=%{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s size=%{size_download}B\n"
file /tmp/r1.opus | head -1
rm -f /tmp/r1.opus

echo ""
echo "--- Wait 4s for async R2 upload ---"
sleep 4

echo ""
echo "--- /exists/ on edge worker (should show cached) ---"
curl -s "https://voyo-edge.dash-webtv.workers.dev/exists/g_hgm2Mf6Ag"; echo

echo ""
echo "--- Request 2: should now be 302 (cache hit) ---"
curl -s -I -m 30 "https://stream.zionsynapse.online:8443/voyo/audio/g_hgm2Mf6Ag?quality=high" | head -4

echo ""
echo "--- Recent logs ---"
sudo pm2 logs voyo-audio --lines 15 --nostream 2>&1 | tail -18
REMOTE

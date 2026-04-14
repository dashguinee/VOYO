#!/bin/bash
# Smart rotation wrapper (try accounts in shuffled order, fall through on cookie fail) + R2 upload patch

echo "=== 1. Install smart wrapper ==="
sudo tee /usr/local/bin/yt-dlp-safe >/dev/null <<'WRAP'
#!/bin/bash
# Smart rotation: shuffle account order, try each, fall through on cookie-auth failure.
# Net effect: as long as at least ONE account has valid cookies, requests succeed.
shopt -s nullglob
MASTERS=(/opt/voyo/cookies-[0-9][0-9][0-9].txt)
[ ${#MASTERS[@]} -eq 0 ] && MASTERS=(/opt/voyo/cookies.txt)

# Shuffle (bash-native Fisher-Yates)
for ((i=${#MASTERS[@]}-1; i>0; i--)); do
  j=$((RANDOM % (i+1))); tmp=${MASTERS[i]}; MASTERS[i]=${MASTERS[j]}; MASTERS[j]=$tmp
done

LAST_OUT=""
LAST_RC=1
for MASTER in "${MASTERS[@]}"; do
  TMP=$(mktemp /tmp/ytc.XXXXXX); chmod 600 "$TMP"; cp "$MASTER" "$TMP"
  LAST_OUT=$(/usr/local/bin/yt-dlp --cookies "$TMP" "$@" 2>&1)
  LAST_RC=$?
  rm -f "$TMP"
  if [ $LAST_RC -eq 0 ]; then
    echo "$LAST_OUT"
    exit 0
  fi
  # Cookie issue → try next account
  if echo "$LAST_OUT" | grep -qE "Sign in to confirm|cookies are no longer valid|cookies.*not valid"; then
    continue
  fi
  # Any other error (network, 429, video unavailable) → fail fast
  echo "$LAST_OUT" >&2
  exit $LAST_RC
done
# All accounts exhausted
echo "$LAST_OUT" >&2
exit $LAST_RC
WRAP
sudo chmod 755 /usr/local/bin/yt-dlp-safe

echo ""
echo "=== 2. Smoke-test smart wrapper (5 runs, expect all ✅) ==="
for i in 1 2 3 4 5; do
  OUT=$(sudo /usr/local/bin/yt-dlp-safe -f bestaudio --get-url "https://www.youtube.com/watch?v=g_hgm2Mf6Ag" 2>&1)
  if echo "$OUT" | grep -q "googlevideo.com"; then
    echo "  run $i: ✅"
  else
    echo "  run $i: ❌ $(echo "$OUT" | tail -1 | head -c 80)"
  fi
done

echo ""
echo "=== 3. Patch voyo-proxy.js — real R2 upload + correct R2 URLs ==="
SRC=/home/ubuntu/voyo-proxy.js
sudo cp "$SRC" "${SRC}.bak-$(date +%s)"

sudo python3 <<'PY'
p = '/home/ubuntu/voyo-proxy.js'
s = open(p).read()
changes = 0

old1 = '''async function uploadToR2(filePath, key) {
  // TODO: implement S3-compatible upload to R2
  // For now, log the intent — the edge worker's existing upload path
  // handles R2 writes from the client side. This server-side upload
  // will be wired in the next sprint with proper AWS SDK v3.
  console.log(`[VOYO] R2 upload pending: ${key} (${filePath})`);
}'''
new1 = '''async function uploadToR2(filePath, key) {
  const m = key.match(/audio\\/([^/]+)\\/([^/]+)\\.opus/);
  if (!m) { console.error(`[VOYO] R2 upload: bad key ${key}`); return; }
  const [, trackId, quality] = m;
  try {
    const buf = fs.readFileSync(filePath);
    const url = `https://voyo-edge.dash-webtv.workers.dev/upload/${trackId}?q=${quality}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'audio/ogg' }, body: buf });
    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      console.log(`[VOYO] R2 uploaded ${trackId} (${buf.length}B, ${j.status||'ok'})`);
    } else {
      console.error(`[VOYO] R2 upload HTTP ${res.status} for ${trackId}`);
    }
  } catch (e) {
    console.error(`[VOYO] R2 upload err ${trackId}: ${e.message}`);
  }
}'''
if old1 in s:
  s = s.replace(old1, new1); changes += 1

# Point R2_BASE at actual edge worker
if 'const R2_BASE = "https://voyo-cdn.dash-webtv.workers.dev";' in s:
  s = s.replace('const R2_BASE = "https://voyo-cdn.dash-webtv.workers.dev";',
                'const R2_BASE = "https://voyo-edge.dash-webtv.workers.dev";'); changes += 1

# Cache-check URL should match edge worker /audio?q= contract
if 'const r2Url = `${R2_BASE}/audio/${trackId}/${quality}.opus`;' in s:
  s = s.replace('const r2Url = `${R2_BASE}/audio/${trackId}/${quality}.opus`;',
                'const r2Url = `${R2_BASE}/audio/${trackId}?q=${quality}`;'); changes += 2  # appears twice

open(p,'w').write(s)
print(f'{changes} replacements applied')
PY

echo ""
echo "--- Confirm patches landed ---"
grep -c "voyo-edge.dash-webtv.workers.dev/upload" "$SRC"
grep -c "TODO: implement S3" "$SRC"

echo ""
echo "--- Syntax check ---"
node --check "$SRC" && echo "OK"

echo ""
echo "--- Restart voyo-audio ---"
sudo pm2 restart voyo-audio --update-env
sleep 3

echo ""
echo "=== 4. E2E validation ==="
echo "--- Req 1: fresh extraction ---"
curl -s -m 90 -o /tmp/r1.opus "https://stream.zionsynapse.online:8443/voyo/audio/g_hgm2Mf6Ag?quality=high" -w "  HTTP=%{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s size=%{size_download}B\n"
file /tmp/r1.opus | head -1
rm -f /tmp/r1.opus

sleep 5
echo ""
echo "--- R2 cache check ---"
curl -s "https://voyo-edge.dash-webtv.workers.dev/exists/g_hgm2Mf6Ag"; echo

echo ""
echo "--- Req 2: should be 302 (cache hit) ---"
curl -s -I -m 30 "https://stream.zionsynapse.online:8443/voyo/audio/g_hgm2Mf6Ag?quality=high" | head -4

echo ""
echo "--- Logs ---"
sudo pm2 logs voyo-audio --lines 10 --nostream 2>&1 | tail -15

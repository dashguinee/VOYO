#!/bin/bash
# Two issues:
# 1. yt-dlp needs WRITE on cookies.txt (SIDCC token refresh). Currently 640,
#    ubuntu only has read. If node spawns as non-root, it'd fail.
#    Actually pm2 runs voyo-audio as ROOT. So root has rw. Fine for production.
#    BUT the ubuntu test showed PermissionError because ubuntu has no write.
#    That's a RED HERRING — production runs as root.
#
# 2. voyo-proxy exec hides stderr via 2>/dev/null, so we can't see why it
#    really fails. AND exec timeout is 15s — tight. AND no HOME env set.
#
# Fix: show real error, bump timeout, test as root.

echo "=== 0. Cookies perms ==="
sudo chown root:root /opt/voyo/cookies.txt
sudo chmod 600 /opt/voyo/cookies.txt
ls -la /opt/voyo/cookies.txt

echo ""
echo "=== 1. Test as ROOT (production context) ==="
sudo -i bash -c '/usr/local/bin/yt-dlp --cookies /opt/voyo/cookies.txt -f "bestaudio" --get-url --no-warnings --geo-bypass "https://www.youtube.com/watch?v=g_hgm2Mf6Ag"' 2>&1 | tail -5

echo ""
echo "=== 2. Test via /bin/sh -c (what exec uses) AS ROOT ==="
sudo /bin/sh -c '/usr/local/bin/yt-dlp --cookies /opt/voyo/cookies.txt -f "bestaudio" --get-url --no-warnings --geo-bypass "https://www.youtube.com/watch?v=g_hgm2Mf6Ag"' 2>&1 | tail -5

echo ""
echo "=== 3. Patch voyo-proxy.js: remove 2>/dev/null, bump timeout, log stderr ==="
# Remove 2>/dev/null from the yt-dlp fallback cmd (line 338)
sudo sed -i 's| 2>/dev/null`;$|\`;|' /home/ubuntu/voyo-proxy.js
# Bump exec timeout from 15s to 30s
sudo sed -i 's|timeout: 15000|timeout: 30000|g' /home/ubuntu/voyo-proxy.js
echo "--- after patch ---"
grep -n -A1 '/usr/local/bin/yt-dlp' /home/ubuntu/voyo-proxy.js | head -10

echo ""
echo "=== 4. Add stderr logging in the exec callback ==="
# Replace the failure line with one that logs stderr
sudo python3 <<"PY"
import re
p = '/home/ubuntu/voyo-proxy.js'
s = open(p).read()
# Pattern: exec(cmd, { timeout: 30000 }, (err2, stdout2) => { ... if (err2) return reject(...
# Change to: exec(cmd, { timeout: 30000 }, (err2, stdout2, stderr2) => { if (err2) { console.error('[VOYO] yt-dlp stderr:', stderr2); return reject ...
s = s.replace(
    '(err2, stdout2) => {',
    '(err2, stdout2, stderr2) => {'
)
s = s.replace(
    "if (err2) return reject(new Error(`Both extraction methods failed`));",
    "if (err2) { console.error('[VOYO] yt-dlp err:', err2?.message, 'stderr:', stderr2?.toString()?.slice(0,300)); return reject(new Error('Both extraction methods failed')); }"
)
open(p,'w').write(s)
print('patched')
PY

echo "--- verify patch ---"
grep -n 'yt-dlp err:' /home/ubuntu/voyo-proxy.js

echo ""
echo "=== 5. Syntax check ==="
node --check /home/ubuntu/voyo-proxy.js && echo "OK"

echo ""
echo "=== 6. Restart + test ==="
sudo pm2 restart voyo-audio --update-env
sleep 4
curl -s -m 30 "https://stream.zionsynapse.online:8443/voyo/audio/g_hgm2Mf6Ag?quality=high" -o /tmp/o.bin -w "HTTP=%{http_code} time=%{time_total}s size=%{size_download}\n"
file /tmp/o.bin | head -1
head -c 300 /tmp/o.bin; echo
rm -f /tmp/o.bin

echo ""
echo "=== 7. Latest logs (look for yt-dlp err line) ==="
sudo pm2 logs voyo-audio --lines 20 --nostream 2>&1 | tail -25

echo ""
echo "=== 8. FULL DOWNLOAD TIMING (Mnike @ high = 256k Opus) ==="
curl -s -m 120 "https://stream.zionsynapse.online:8443/voyo/audio/g_hgm2Mf6Ag?quality=high" -o /tmp/mnike.opus -w "Mnike: HTTP=%{http_code} total=%{time_total}s ttfb=%{time_starttransfer}s size=%{size_download}B speed=%{speed_download}B/s\n"
ls -la /tmp/mnike.opus 2>/dev/null
file /tmp/mnike.opus 2>/dev/null | head -1

echo ""
echo "=== 9. Second track for average (Rick Astley, known cached) ==="
curl -s -m 120 "https://stream.zionsynapse.online:8443/voyo/audio/dQw4w9WgXcQ?quality=high" -o /tmp/rick.opus -w "Rick: HTTP=%{http_code} total=%{time_total}s ttfb=%{time_starttransfer}s size=%{size_download}B speed=%{speed_download}B/s\n"
ls -la /tmp/rick.opus 2>/dev/null
file /tmp/rick.opus 2>/dev/null | head -1

echo ""
echo "=== 10. Fresh-to-VPS track (BADMAN GANGSTA, was on blocklist) ==="
curl -s -m 120 "https://stream.zionsynapse.online:8443/voyo/audio/Zck0zkv67gs?quality=high" -o /tmp/badman.opus -w "BADMAN: HTTP=%{http_code} total=%{time_total}s ttfb=%{time_starttransfer}s size=%{size_download}B speed=%{speed_download}B/s\n"
file /tmp/badman.opus 2>/dev/null | head -1

rm -f /tmp/mnike.opus /tmp/rick.opus /tmp/badman.opus

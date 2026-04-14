# VPS Update — The 100% Unlock

**Problem**: YouTube rolled out PO Token (Proof of Origin) requirements. Edge Worker extraction is hitting the wall. VPS yt-dlp needs updates + cookies to recover.

**Server**: `stream.zionsynapse.online:8443`

## Quick path (5 minutes)

SSH in and run:

```bash
ssh root@stream.zionsynapse.online

# 1. Update yt-dlp to latest (nightly gets YouTube fixes within days)
pip install --upgrade --pre yt-dlp[default]

# OR if that's not pip-managed:
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp

# Verify version (should be 2026.x or later)
yt-dlp --version

# 2. Test extraction on a previously-failing track
yt-dlp -f bestaudio --get-url "https://www.youtube.com/watch?v=7On0yoL5eSU"

# If that works, you're good. If it says "Sign in to confirm", do step 3.
```

## If step 2 still fails — add cookies (biggest unlock)

```bash
# On your local machine with a logged-in YouTube account in Chrome/Firefox:
# 1. Install "Get cookies.txt LOCALLY" extension
# 2. Visit youtube.com (while signed in)
# 3. Click the extension, save cookies.txt
# 4. scp it to VPS:
scp cookies.txt root@stream.zionsynapse.online:/opt/voyo/cookies.txt

# Update the VPS's yt-dlp invocation to use cookies.
# Find the voyo-audio service file:
systemctl status voyo-audio  # or whatever runs the audio API

# The yt-dlp command should include:
#   --cookies /opt/voyo/cookies.txt
# OR --cookies-from-browser chrome  (if there's a headless Chrome installed)

# Restart the service:
systemctl restart voyo-audio
```

## Why this works

- **yt-dlp updates**: the yt-dlp maintainers keep pace with YouTube's API changes. Updates within days of every YouTube breaking change. `--pre yt-dlp[default]` gives you nightly builds with the freshest fixes.
- **Cookies**: a logged-in session bypasses age-gating, region blocks, rate limits, AND PO Token requirements. YouTube trusts authenticated requests much more than anonymous ones. Even a burner account works.

## Verify after

```bash
# From your local machine:
curl -I "https://stream.zionsynapse.online:8443/voyo/audio/7On0yoL5eSU?quality=high"

# Should return HTTP/1.1 200 OK with audio/ogg content-type.
# If it returns 500 "Extraction failed", cookies weren't applied. Check service logs.
```

## Long-term: auto-update yt-dlp weekly

Add to VPS crontab:

```
# Update yt-dlp every Sunday at 3am UTC
0 3 * * 0 pip install --upgrade --pre yt-dlp[default] && systemctl restart voyo-audio
```

This keeps the extractor fresh without manual intervention. YouTube changes something → yt-dlp releases fix within days → cron picks it up → VPS keeps working.

## What happens after

With yt-dlp updated + cookies added:
- 8% failure rate drops to <1% (only truly deleted/private videos fail)
- First-play latency improves (no PO token challenge)
- No more "Sign in to confirm" errors
- R2 flywheel accelerates (every successful extraction caches for everyone)

**This is the last real bottleneck. After this, VOYO is launch-ready.**

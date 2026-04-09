# VOYO Audio Pipeline

## Quick Start

### 1. Install Dependencies

```bash
# FFmpeg (for audio conversion)
sudo apt-get install ffmpeg

# yt-dlp (for YouTube downloads)
pip install yt-dlp

# boto3 (for R2 uploads)
pip install boto3

# Optional: deemix for Deezer FLAC (Tier A+B)
pip install deemix
```

### 2. Set up Cloudflare R2

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → R2
2. Create a bucket named `voyo-audio`
3. Create API token: R2 → Manage R2 API Tokens → Create API Token
4. Save your credentials:

```bash
export R2_ACCOUNT_ID='your-account-id'
export R2_ACCESS_KEY='your-access-key'
export R2_SECRET_KEY='your-secret-key'
export R2_BUCKET='voyo-audio'
```

### 3. Download Audio

```bash
# Download Tier A (5,324 tracks) - uses Deezer when available
python3 scripts/audio_pipeline.py --tier A --limit 100

# Download all Tier A
python3 scripts/audio_pipeline.py --tier A --limit 10000

# Download Tier B
python3 scripts/audio_pipeline.py --tier B --limit 10000

# Download everything
python3 scripts/audio_pipeline.py --all --limit 130000
```

### 4. Upload to R2

```bash
# Upload all quality tiers
python3 scripts/upload_to_r2.py

# Upload only 256k tier
python3 scripts/upload_to_r2.py --tier 256
```

## Quality Tiers

| Tier | Bitrate | Use Case |
|------|---------|----------|
| 64k | 64kbps Opus | Bad network / 2G |
| 128k | 128kbps Opus | 3G / Data saver |
| 192k | 192kbps Opus | 4G / LTE |
| 256k | 256kbps Opus | WiFi / 5G / Premium |

## Sources

- **Tier A+B**: Deezer FLAC → convert to Opus (best quality)
- **Tier C+D**: YouTube via yt-dlp → convert to Opus

## File Structure

```
audio_cache/
├── downloads/          # Temporary downloads
└── output/
    ├── 64/            # 64kbps files
    │   └── {youtube_id}.opus
    ├── 128/           # 128kbps files
    ├── 192/           # 192kbps files
    └── 256/           # 256kbps files
```

## R2 URL Pattern

```
https://voyo-audio.{account-id}.r2.dev/audio/{tier}/{youtube_id}.opus

Example:
https://voyo-audio.abc123.r2.dev/audio/256/dQw4w9WgXcQ.opus
```

## Integration with VOYO App

Update `audioEngine.ts` to use R2 URLs:

```typescript
const R2_BASE = 'https://voyo-audio.YOUR_ACCOUNT.r2.dev';

function getAudioUrl(trackId: string, quality: '64' | '128' | '192' | '256') {
  return `${R2_BASE}/audio/${quality}/${trackId}.opus`;
}
```

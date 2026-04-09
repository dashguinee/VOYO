# VOYO Music - Content Strategy Research

## Two Core Aspects

### 1. STREAMING (Play in app)
### 2. DOWNLOAD (Save for offline)

---

## STREAMING OPTIONS

### Option A: YouTube IFrame Embed (Current - FREE)
**What we have now**
```javascript
// Direct embed - no API key needed for playback
<iframe src="https://www.youtube.com/embed/{VIDEO_ID}?enablejsapi=1" />
```

**Pros:**
- Free, unlimited playback
- Official API, stable
- Supports all qualities

**Cons:**
- Shows YouTube branding
- Need API key for search (100 searches/day free)

---

### Option B: Invidious/Piped (Self-hosted YouTube proxy)
**How it works:**
- Open source YouTube frontend
- No official YouTube APIs used
- Can self-host for complete control
- Provides its own API

**Invidious API:**
```
GET /api/v1/videos/{id}     - Video details
GET /api/v1/search?q=query  - Search videos
GET /api/v1/trending        - Trending videos
```

**Public Instances:**
- https://invidious.io (list of instances)
- Can use any public instance or self-host

**Integration:**
```javascript
// Search via Invidious
const response = await fetch('https://invidious.snopyta.org/api/v1/search?q=afrobeats');
const videos = await response.json();

// Get video details
const video = await fetch('https://invidious.snopyta.org/api/v1/videos/VIDEO_ID');
```

**Pros:**
- No API key needed
- No rate limits (self-hosted)
- Privacy-focused
- Free

**Cons:**
- Public instances can go down
- Need to self-host for reliability

---

### Option C: Piped API (Modern Invidious alternative)
**Similar to Invidious but:**
- More modern architecture
- Better performance
- Used by ytify

**API Endpoints:**
```
GET /search?q=query&filter=music_songs
GET /streams/{videoId}
GET /trending?region=US
```

---

### Option D: noembed/oEmbed (Metadata only - no API key)
**For getting video info without API key:**
```javascript
// Get video title, thumbnail, etc.
const url = `https://noembed.com/embed?url=https://youtube.com/watch?v=${videoId}`;
const data = await fetch(url).then(r => r.json());
// Returns: title, author_name, thumbnail_url, etc.
```

**Best for:** Quick metadata lookup without quota

---

## DOWNLOAD OPTIONS

### Option A: Cobalt.tools API (RECOMMENDED)
**What it is:**
- Open source media downloader
- No ads, no tracking
- Supports YouTube up to 8K
- Has public API

**GitHub:** https://github.com/imputnet/cobalt

**How it works:**
```javascript
// POST to Cobalt API
const response = await fetch('https://api.cobalt.tools/api/json', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://www.youtube.com/watch?v=VIDEO_ID',
    vCodec: 'h264',
    vQuality: '720',
    aFormat: 'mp3'
  })
});
const result = await response.json();
// Returns download URL
```

**Self-hosting:**
- Can deploy own instance with Docker
- Full control, no rate limits

**Pros:**
- Free & open source
- High quality (up to 8K video, 320kbps audio)
- No account needed
- Can self-host

**Cons:**
- Public API now requires auth (2024)
- Need to self-host for unrestricted use

---

### Option B: yt-dlp Backend Service
**What it is:**
- Command-line tool (fork of youtube-dl)
- Most powerful extraction tool
- Supports 1000+ sites

**How MP3Juices/similar sites work:**
1. User submits YouTube URL
2. Backend runs yt-dlp command
3. Extracts audio/video stream
4. Returns download URL to user

**Backend Implementation (Node.js):**
```javascript
const { exec } = require('child_process');

app.post('/download', async (req, res) => {
  const { url, format } = req.body;

  // Extract audio
  const command = `yt-dlp -x --audio-format mp3 -o "downloads/%(id)s.%(ext)s" "${url}"`;

  exec(command, (error, stdout) => {
    if (error) return res.status(500).json({ error });
    res.json({ downloadUrl: `/downloads/${videoId}.mp3` });
  });
});
```

**Python version:**
```python
import yt_dlp

def download_audio(url):
    ydl_opts = {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '320',
        }],
        'outtmpl': 'downloads/%(id)s.%(ext)s',
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
```

**Requirements:**
- Server with yt-dlp installed
- ffmpeg for audio conversion
- Storage for temp files

---

### Option C: Hybrid Approach (Frontend + Backend)

**Frontend (VOYO App):**
```
1. Stream via YouTube IFrame (free)
2. Search via Invidious/Piped (no API key)
3. Download button calls our backend
```

**Backend (VOYO Download Service):**
```
1. Receive URL from frontend
2. Use yt-dlp to extract audio
3. Return download link
4. Auto-cleanup after download
```

---

## RECOMMENDED ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                     VOYO FRONTEND                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  STREAMING                      SEARCH/METADATA             │
│  ─────────                      ───────────────             │
│  YouTube IFrame API             Option 1: YouTube Data API  │
│  (free, unlimited)              (100 searches/day free)     │
│                                                             │
│                                 Option 2: Invidious API     │
│                                 (unlimited, no key)         │
│                                                             │
│                                 Option 3: Piped API         │
│                                 (unlimited, no key)         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     VOYO BACKEND                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  DOWNLOAD SERVICE                                           │
│  ────────────────                                           │
│  Option 1: Self-hosted Cobalt                               │
│  (Docker, full control)                                     │
│                                                             │
│  Option 2: yt-dlp service                                   │
│  (Node.js/Python + ffmpeg)                                  │
│                                                             │
│  Endpoints:                                                 │
│  POST /api/download { url, format }                         │
│  GET  /api/search?q=query                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## IMPLEMENTATION PRIORITY

### Phase 1: MVP (Current)
- [x] YouTube IFrame for streaming
- [x] Seed data (15 tracks)
- [ ] Add Invidious/Piped for search (no API key)

### Phase 2: Dynamic Content
- [ ] YouTube Data API for search (with key)
- [ ] Cache results to reduce quota usage
- [ ] Genre-based discovery

### Phase 3: Download Feature
- [ ] Deploy yt-dlp backend service
- [ ] Or self-host Cobalt
- [ ] Add download button to UI

### Phase 4: Full Independence
- [ ] Self-host Invidious/Piped
- [ ] Own CDN for popular tracks
- [ ] Offline mode with downloaded tracks

---

## LEGAL NOTES

- Streaming via embed = Legal (YouTube allows it)
- Downloading = Gray area (for personal use only)
- Cobalt's stance: "Can only download free & publicly accessible content"
- We should add disclaimer: "Download for personal use only"

---

## QUICK START - Adding Invidious Search

```typescript
// src/services/youtube.ts

const INVIDIOUS_INSTANCE = 'https://invidious.snopyta.org';

export async function searchVideos(query: string, limit = 20) {
  const url = `${INVIDIOUS_INSTANCE}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
  const response = await fetch(url);
  const results = await response.json();

  return results.slice(0, limit).map((video: any) => ({
    id: video.videoId,
    title: video.title,
    artist: video.author,
    youtubeVideoId: video.videoId,
    coverUrl: video.videoThumbnails[0]?.url,
    duration: video.lengthSeconds,
  }));
}

export async function getVideoDetails(videoId: string) {
  const url = `${INVIDIOUS_INSTANCE}/api/v1/videos/${videoId}`;
  const response = await fetch(url);
  return response.json();
}

export async function getTrending(region = 'US') {
  const url = `${INVIDIOUS_INSTANCE}/api/v1/trending?type=music&region=${region}`;
  const response = await fetch(url);
  return response.json();
}
```

---

## Sources

### Streaming
- [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference)
- [Invidious - Open Source YouTube Frontend](https://invidious.io/)
- [Piped - YouTube Alternative](https://github.com/TeamPiped/Piped)
- [noembed - oEmbed Service](https://noembed.com/)

### Download
- [Cobalt.tools](https://cobalt.tools/) - [GitHub](https://github.com/imputnet/cobalt)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [MP3Juices Review](https://www.nextgenphone.co.uk/mp3juices-cc-review/)

### Related Tools
- [ytify - YouTube Music Player](https://medevel.com/ytify-youtube/)
- [FreeTube - Desktop Client](https://freetubeapp.io/)

---

---

## ALL YOUTUBE ALTERNATIVES (2025 Complete List)

### Web Frontends (Can use their APIs)

| Name | Type | Status 2025 | API | Best For |
|------|------|-------------|-----|----------|
| **Piped** | YouTube Frontend | Active | Yes - [OpenAPI](https://github.com/TeamPiped/OpenAPI) | Web streaming |
| **Invidious** | YouTube Frontend | Active | Yes | Privacy, self-host |
| **Hyperpipe** | YouTube Music | Active | Uses Piped | Music-only |
| **ViewTube** | YouTube Frontend | Active | Uses Invidious | Self-host |
| **CloudTube** | YouTube Frontend | Active | Uses NewLeaf | Lightweight |
| **Beatbump** | YouTube Music | **DEAD** | - | Was good for music |
| **Poketube** | YouTube Frontend | Active | - | Privacy |

### Mobile Apps (Reference for features)

| Name | Platform | Status 2025 | Features |
|------|----------|-------------|----------|
| **NewPipe** | Android | Active | No Google, downloads, background play |
| **LibreTube** | Android | Active | Uses Piped API |
| **Tubular** | Android | Active | SponsorBlock + Dislike counts |
| **PipePipe** | Android | Active | YouTube + NicoNico + Bilibili |
| **FreeTube** | Desktop | Active | Windows/Mac/Linux |
| **Harmony Music** | Android/Windows | Active | Flutter, Piped integration |

### Download Tools

| Name | Type | Status 2025 | API |
|------|------|-------------|-----|
| **Cobalt** | Web/API | Active (auth required on public) | Yes |
| **yt-dlp** | CLI | Active | Python API |
| **youtube-dl** | CLI | Slow updates | Python API |

---

## RECOMMENDED STACK FOR VOYO (2025)

### Streaming (Frontend)
```
Primary: YouTube IFrame API (official, stable)
Fallback: Piped API (no rate limits)
```

### Search & Metadata
```
Primary: Piped API (free, unlimited)
  - https://pipedapi.kavin.rocks/search?q=afrobeats
  - https://pipedapi.kavin.rocks/streams/{videoId}

Fallback: Invidious API
  - https://invidious.snopyta.org/api/v1/search?q=afrobeats
```

### Download (Backend)
```
Option 1: Self-hosted Cobalt (Docker)
Option 2: yt-dlp service (Node.js/Python)
```

---

## PIPED API QUICK REFERENCE (2025)

```typescript
// Public instances: https://github.com/TeamPiped/Piped/wiki/Instances

const PIPED_API = 'https://pipedapi.kavin.rocks';

// Search
GET ${PIPED_API}/search?q=afrobeats&filter=music_songs

// Get video streams
GET ${PIPED_API}/streams/{videoId}

// Trending
GET ${PIPED_API}/trending?region=NG

// Channel
GET ${PIPED_API}/channel/{channelId}

// Playlists
GET ${PIPED_API}/playlists/{playlistId}
```

**Response includes:**
- videoId
- title
- uploaderName (artist)
- thumbnail
- duration
- audioStreams[] (direct URLs!)
- videoStreams[] (direct URLs!)

**Key advantage:** Piped returns DIRECT stream URLs - no need for YouTube embed!

---

## GAME CHANGER: Seamless Audio ↔ Video Switching

### The Magic: Same Position, Different Stream

Piped returns **BOTH audio AND video** streams for every video. This enables:

```typescript
// 1. User is in Audio Mode (Portrait VOYO)
const audioPlayer = document.getElementById('audio') as HTMLAudioElement;
audioPlayer.src = audioStreamUrl;
audioPlayer.play();

// 2. User triple-taps → Video Mode
const currentPosition = audioPlayer.currentTime; // Save position!
audioPlayer.pause();

// 3. Load video, resume at SAME position
const videoPlayer = document.getElementById('video') as HTMLVideoElement;
videoPlayer.src = videoStreamUrl;
videoPlayer.currentTime = currentPosition; // Seamless!
videoPlayer.play();

// 4. User exits Video Mode → back to audio
const videoPosition = videoPlayer.currentTime;
videoPlayer.pause();
audioPlayer.currentTime = videoPosition;
audioPlayer.play();
```

### Benefits:
- **Seamless transition** - no restart, continues exactly where you were
- **Data saving** - audio mode uses ~10x less bandwidth than video
- **Background play** - audio works when screen off (mobile)
- **Full UI control** - no YouTube branding, pure VOYO

---

## GAME CHANGER: Direct Audio Streaming via Piped

```typescript
// Instead of YouTube iframe, we can stream directly!

async function getAudioStreamUrl(videoId: string) {
  const response = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
  const data = await response.json();

  // Get best audio stream
  const audioStream = data.audioStreams
    .filter(s => s.mimeType.includes('audio'))
    .sort((a, b) => b.bitrate - a.bitrate)[0];

  return audioStream.url; // Direct MP3/AAC URL!
}

// Use in HTML5 Audio
const audio = new Audio(audioStreamUrl);
audio.play();
```

**This means:**
- No YouTube branding
- No iframe
- Pure audio player
- Full control over UI
- Background play on mobile!

---

## Sources (2025)

### APIs & Frontends
- [Piped GitHub](https://github.com/TeamPiped/Piped) - [API Docs](https://github.com/TeamPiped/OpenAPI)
- [Invidious](https://invidious.io/) - [GitHub](https://github.com/iv-org/invidious)
- [Hyperpipe](https://hyperpipe.surge.sh/) - YouTube Music frontend
- [Open Source Music Streaming Apps List](https://github.com/chayotic/Open-Source-Music-Streaming-Apps)
- [Alternative Front-ends List](https://github.com/mendel5/alternative-front-ends)

### Download Tools
- [Cobalt](https://cobalt.tools/) - [GitHub](https://github.com/imputnet/cobalt)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)

### Mobile References
- [NewPipe](https://newpipe.net/)
- [LibreTube](https://github.com/libre-tube/LibreTube)
- [FreeTube](https://freetubeapp.io/)

---

*Last Updated: December 4, 2025*
*Research for VOYO Music by DASUPERHUB*

# Z3 MISSION: Integrate Piped Playlists as VOYO Albums

## WHO YOU ARE
You are Z3, a backend integration engineer on the VOYO Music team. You understand that VOYO needs ALBUMS to feel like a real music platform. YouTube has millions of albums disguised as playlists. Your job is to find them and bring them into VOYO as browsable, playable albums.

## THE VISION (WHY)
Users expect to:
- Browse artist discographies (albums)
- Play full albums in order
- See "New Album from [Artist]" in their feed
- Add entire albums to their queue

YouTube Music Topic channels and artist playlists ARE albums - they're just not presented that way. We're going to present them properly.

## THE PIPED API (Your Tool)

Piped is a privacy-focused YouTube frontend with a public API. We use it to search and get playlist data.

### Base URL
```
https://pipedapi.kavin.rocks
```

### Key Endpoints

**Search for Playlists:**
```
GET /search?q={query}&filter=playlists
```
Response:
```json
{
  "items": [
    {
      "type": "playlist",
      "url": "/playlist?list=PLAYLIST_ID",
      "name": "Album Name",
      "thumbnail": "https://...",
      "uploaderName": "Artist - Topic",
      "videos": 12
    }
  ]
}
```

**Get Playlist Details:**
```
GET /playlists/{playlistId}
```
Response:
```json
{
  "name": "Album Name",
  "uploader": "Artist - Topic",
  "uploaderAvatar": "https://...",
  "bannerUrl": "https://...",
  "videos": 12,
  "relatedStreams": [
    {
      "url": "/watch?v=VIDEO_ID",
      "title": "Track Name",
      "thumbnail": "https://...",
      "duration": 234,
      "uploaderName": "Artist"
    }
  ]
}
```

### YouTube Music Topic Channels
YouTube auto-generates "Topic" channels for artists with structured playlists:
- `Artist Name - Topic` → Channel with all their music
- Playlists like "Artist Name - Album Name" contain full albums
- Search: `"Artist Name" album playlist` usually finds them

### Playlist ID Extraction
From URL `/playlist?list=PLxxxxxxxxx`, extract `PLxxxxxxxxx`

## THE CODEBASE CONTEXT

### Files You'll Work With:

1. **`src/services/api.ts`** - Add new functions here
   - Already has `searchMusic()` using our backend
   - You'll add `searchAlbums()` and `getAlbumTracks()`

2. **`src/types/index.ts`** - Add Album type
   ```typescript
   export interface Album {
     id: string;           // Playlist ID
     name: string;         // Album name
     artist: string;       // Extracted from uploader
     thumbnail: string;    // Album art
     trackCount: number;   // Number of tracks
     tracks?: Track[];     // Loaded lazily
   }
   ```

3. **`src/store/playerStore.ts`** - Add album queue function
   - `playAlbum(album: Album)` - Load tracks and play

4. **`src/data/tracks.ts`** - May need to add track creation helper
   - Convert Piped stream to VOYO Track format

## THE TASK (WHAT)

### Step 1: Add Piped Service Functions

Create `src/services/piped.ts`:

```typescript
const PIPED_API = 'https://pipedapi.kavin.rocks';

export interface PipedPlaylist {
  id: string;
  name: string;
  artist: string;
  thumbnail: string;
  trackCount: number;
}

export interface PipedTrack {
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
}

/**
 * Search for albums (playlists) on YouTube via Piped
 */
export async function searchAlbums(query: string, limit: number = 10): Promise<PipedPlaylist[]> {
  const response = await fetch(
    `${PIPED_API}/search?q=${encodeURIComponent(query + ' album')}&filter=playlists`
  );

  if (!response.ok) throw new Error('Album search failed');

  const data = await response.json();

  return data.items
    .filter((item: any) => item.type === 'playlist')
    .slice(0, limit)
    .map((item: any) => ({
      id: extractPlaylistId(item.url),
      name: cleanAlbumName(item.name),
      artist: cleanArtistName(item.uploaderName),
      thumbnail: item.thumbnail,
      trackCount: item.videos || 0,
    }));
}

/**
 * Get tracks from an album/playlist
 */
export async function getAlbumTracks(playlistId: string): Promise<PipedTrack[]> {
  const response = await fetch(`${PIPED_API}/playlists/${playlistId}`);

  if (!response.ok) throw new Error('Album fetch failed');

  const data = await response.json();

  return data.relatedStreams.map((stream: any) => ({
    videoId: extractVideoId(stream.url),
    title: stream.title,
    artist: cleanArtistName(stream.uploaderName || data.uploader),
    duration: stream.duration,
    thumbnail: stream.thumbnail,
  }));
}

// Helpers
function extractPlaylistId(url: string): string {
  const match = url.match(/list=([^&]+)/);
  return match ? match[1] : url;
}

function extractVideoId(url: string): string {
  const match = url.match(/v=([^&]+)/);
  return match ? match[1] : url.replace('/watch?v=', '');
}

function cleanAlbumName(name: string): string {
  // Remove common suffixes like "(Full Album)" etc
  return name.replace(/\s*\(Full Album\)/i, '').trim();
}

function cleanArtistName(name: string): string {
  // Remove "- Topic" suffix from YouTube Music channels
  return name.replace(/\s*-\s*Topic$/i, '').trim();
}
```

### Step 2: Add to Types

In `src/types/index.ts`, add:
```typescript
export interface Album {
  id: string;
  name: string;
  artist: string;
  thumbnail: string;
  trackCount: number;
  tracks?: Track[];
  source: 'piped' | 'local';
}
```

### Step 3: Create Album-to-Track Converter

```typescript
/**
 * Convert Piped track to VOYO Track format
 */
export function pipedTrackToVoyoTrack(pipedTrack: PipedTrack, albumName?: string): Track {
  return {
    id: `piped_${pipedTrack.videoId}`,
    title: pipedTrack.title,
    artist: pipedTrack.artist,
    album: albumName || 'Unknown Album',
    trackId: pipedTrack.videoId,
    coverUrl: pipedTrack.thumbnail,
    duration: pipedTrack.duration,
    tags: [], // Could infer from title/artist
    mood: null,
    region: null,
    oyeScore: 0,
    createdAt: new Date().toISOString(),
  };
}
```

### Step 4: Add Album Actions to Player Store

In `playerStore.ts`:
```typescript
// Add to interface
playAlbum: (albumId: string) => Promise<void>;
queueAlbum: (albumId: string) => Promise<void>;

// Implementation
playAlbum: async (albumId: string) => {
  const pipedTracks = await getAlbumTracks(albumId);
  const tracks = pipedTracks.map(t => pipedTrackToVoyoTrack(t));

  if (tracks.length > 0) {
    // Play first track
    get().setCurrentTrack(tracks[0]);
    // Queue the rest
    tracks.slice(1).forEach(track => get().addToQueue(track));
  }
},

queueAlbum: async (albumId: string) => {
  const pipedTracks = await getAlbumTracks(albumId);
  const tracks = pipedTracks.map(t => pipedTrackToVoyoTrack(t));
  tracks.forEach(track => get().addToQueue(track));
},
```

### Step 5: Create Album Card Component

For use in HomeFeed shelves:
```typescript
const AlbumCard = ({ album, onPlay }: { album: Album; onPlay: () => void }) => (
  <motion.button
    className="flex-shrink-0 w-36"
    onClick={onPlay}
    whileHover={{ scale: 1.05 }}
    whileTap={{ scale: 0.95 }}
  >
    <div className="w-36 h-36 rounded-xl overflow-hidden mb-2 relative">
      <img src={album.thumbnail} className="w-full h-full object-cover" />
      <div className="absolute bottom-2 right-2 bg-black/60 px-2 py-0.5 rounded-full">
        <span className="text-white text-xs">{album.trackCount} tracks</span>
      </div>
    </div>
    <p className="text-white text-sm font-medium truncate">{album.name}</p>
    <p className="text-white/50 text-xs truncate">{album.artist}</p>
  </motion.button>
);
```

## HOW TO VERIFY (SELF-ASSESSMENT)

1. **Search test**: `searchAlbums("Burna Boy")` returns his albums
2. **Track load test**: `getAlbumTracks(albumId)` returns track list
3. **Playback test**: Clicking album plays first track, queues rest
4. **Format test**: Tracks play correctly (videoId works with our audio system)

Test queries:
- "Burna Boy Love Damini album"
- "Wizkid Made in Lagos album"
- "Davido Timeless album"
- "Rema Rave & Roses album"

## TECHNICAL CONSTRAINTS

- Piped API has rate limits - cache results where possible
- Some playlists may be unavailable - handle errors gracefully
- Video IDs from Piped work with our existing audio extraction
- Keep the service stateless - no localStorage caching in services

## ERROR HANDLING

```typescript
try {
  const albums = await searchAlbums(query);
} catch (error) {
  console.error('Album search failed:', error);
  return []; // Return empty, don't crash
}
```

## OUTPUT REQUIREMENTS

1. Complete `src/services/piped.ts` with all functions
2. Type additions to `src/types/index.ts`
3. Store additions to `src/store/playerStore.ts`
4. AlbumCard component (can be in HomeFeed.tsx or separate)
5. Test results showing successful album search and playback
6. List of working album queries for African artists

## GO TIME

You're connecting VOYO to the world's largest music library. Every album on YouTube becomes a VOYO album. Users can now explore full artist discographies, not just single tracks.

Make the connection clean, reliable, and fast. Handle errors gracefully. When it works, it should feel like magic - search for an artist, see their albums, tap to play.

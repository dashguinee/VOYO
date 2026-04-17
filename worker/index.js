/**
 * VOYO Music - Cloudflare Worker v7
 *
 * ZERO-GAP ARCHITECTURE:
 * - Supabase = Source of Truth (what's cached)
 * - R2 = Dumb Storage (just bytes)
 * - Worker = Single Gateway (atomic operations)
 *
 * ENDPOINTS:
 * - /exists/{id}   → Query Supabase for cache status
 * - /audio/{id}    → Stream from R2
 * - /extract/{id}  → YouTube extraction (best quality)
 * - /upload/{id}   → ATOMIC: R2 put + Supabase upsert
 * - /stream?v={id} → Get extraction URL (legacy)
 * - /thumb/{id}    → Thumbnail proxy
 * - /debug?v={id}  → Probe every client, return per-client diagnostics
 *
 * Edge = 300+ locations worldwide = FAST
 *
 * ───────────────────────────────────────────────────────────────
 * 2026-04-11: YouTube extraction fix
 *  - ANDROID_TESTSUITE was rejected by YouTube mid-2024 → removed
 *  - Old ANDROID/IOS clientVersions aged out → bumped to late-2024
 *  - Added ANDROID_VR (Quest 3) — stable + barely throttled
 *  - Added WEB_EMBEDDED_PLAYER fallback
 *  - signatureTimestamp bumped 19950 → 20250
 *  - Search endpoint now uses WEB client (ANDROID gets 400s)
 * ───────────────────────────────────────────────────────────────
 */

// Fallback InnerTube signatureTimestamp. YouTube rotates this every 1-2 weeks.
// We now fetch it DYNAMICALLY at runtime (see getSignatureTimestamp below) so
// the worker never goes stale. This constant is only used if the fetch fails.
// Last known good: 20551 (2026-04-14).
const FALLBACK_SIGNATURE_TIMESTAMP = 20551;

// In-memory cache for STS + visitorData. The worker instance stays warm
// for minutes to hours. Refresh every 6 hours.
let _cachedSTS = null;
let _cachedVisitor = null;
let _cachedAt = 0;
const CACHE_MS = 6 * 60 * 60 * 1000; // 6h

// Fetch BOTH STS and real visitorData in one call. YouTube bot detection is
// much harder to pass with a fake random visitor ID — using a real one from
// a fresh homepage session dramatically improves success rate.
async function refreshYouTubeSession() {
  try {
    const res = await fetch('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`session probe HTTP ${res.status}`);
    const html = await res.text();

    // Extract STS
    const stsMatch = html.match(/(?:"signatureTimestamp":|"STS":)(\d+)/);
    if (stsMatch) {
      const sts = parseInt(stsMatch[1], 10);
      if (sts >= 20000 && sts <= 30000) _cachedSTS = sts;
    }

    // Extract visitorData — YouTube embeds it in ytcfg / ytInitialData.
    // Formats: "visitorData":"CgtV...==" or "VISITOR_DATA":"CgtV..."
    const vdMatch = html.match(/"(?:visitorData|VISITOR_DATA)"\s*:\s*"([^"]+)"/);
    if (vdMatch && vdMatch[1].length > 10) {
      _cachedVisitor = vdMatch[1];
    }

    _cachedAt = Date.now();
    console.log(`[Session] STS=${_cachedSTS} visitorData=${_cachedVisitor?.slice(0, 16)}...`);
  } catch (err) {
    console.log(`[Session] Refresh failed: ${err.message}`);
  }
}

async function getSignatureTimestamp() {
  if (!_cachedSTS || (Date.now() - _cachedAt) > CACHE_MS) {
    await refreshYouTubeSession();
  }
  return _cachedSTS || FALLBACK_SIGNATURE_TIMESTAMP;
}

async function getVisitorData() {
  if (!_cachedVisitor || (Date.now() - _cachedAt) > CACHE_MS) {
    await refreshYouTubeSession();
  }
  // Fallback: generate a plausible-looking token if fetch failed
  if (!_cachedVisitor) {
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(18)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return 'CgtV' + rand;
  }
  return _cachedVisitor;
}

// InnerTube public API key (shared by all YouTube clients — not a secret,
// embedded in ytcfg on youtube.com). Used only as the ?key= query param.
const INNERTUBE_API_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';

// VPS audio proxy — fallback when all InnerTube clients fail.
// The VPS runs yt-dlp with Chrome browser cookies (not datacenter IP blocked).
const VPS_AUDIO_URL = 'https://stream.zionsynapse.online:8443';

// In-memory PoToken cache — fetched from VPS bgutil-pot service.
// PoTokens prove a real Chrome instance signed the request (bypasses bot check).
let _cachedPoToken = null;
let _cachedPoTokenAt = 0;
const POT_CACHE_MS = 25 * 60 * 1000; // 25 min (bgutil tokens expire ~30 min)

async function fetchPoToken(videoId) {
  if (_cachedPoToken && (Date.now() - _cachedPoTokenAt) < POT_CACHE_MS) {
    return _cachedPoToken;
  }
  try {
    const r = await fetch(`${VPS_AUDIO_URL}/voyo/pot?v=${videoId}`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.poToken) {
      _cachedPoToken = d.poToken;
      _cachedPoTokenAt = Date.now();
      return d.poToken;
    }
  } catch (_) {}
  return null;
}

// Client configurations ranked by success rate (best → worst).
// IOS is the most reliable for audio extraction as of late-2025; returns
// un-ciphered URLs. ANDROID_VR is less throttled but sometimes returns
// lower-bitrate formats. WEB_EMBEDDED_PLAYER is the final browser fallback.
// Client configurations — UPDATED 2026-04-12.
// YouTube periodically blocks old client versions. These are the latest
// working versions as of Q2 2026. Priority: IOS > ANDROID_VR > WEB_CREATOR.
//
// ANDROID_MUSIC removed — YouTube requires sign-in for all music clients.
// WEB_EMBEDDED_PLAYER removed — returns "unavailable" for most videos.
// TVHTML5 removed — "no longer supported" error.
// Added WEB_CREATOR — returns unciphered URLs, no sign-in required.
// Added MWEB — mobile web, different bot-detection surface.
const CLIENTS = [
  {
    name: 'IOS',
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '19.45.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.2.1.22C161',
        hl: 'en',
        gl: 'US',
      }
    },
    userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_2_1 like Mac OS X; en_US)'
  },
  {
    name: 'ANDROID_VR',
    context: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.62.27',
        deviceMake: 'Oculus',
        deviceModel: 'Quest 3',
        androidSdkVersion: 34,
        osName: 'Android',
        osVersion: '14',
        hl: 'en',
        gl: 'US',
      }
    },
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 14; en_US; Quest 3)'
  },
  {
    name: 'WEB_CREATOR',
    context: {
      client: {
        clientName: 'WEB_CREATOR',
        clientVersion: '1.20260401.01.00',
        hl: 'en',
        gl: 'US',
      }
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
  },
  {
    name: 'ANDROID',
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '19.44.38',
        androidSdkVersion: 34,
        osName: 'Android',
        osVersion: '14',
        hl: 'en',
        gl: 'US',
      }
    },
    userAgent: 'com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip'
  },
  {
    // MWEB — mobile web client, different bot-detection surface than desktop clients.
    // Uses the same InnerTube key but presents as a mobile browser (lower scrutiny).
    name: 'MWEB',
    context: {
      client: {
        clientName: 'MWEB',
        clientVersion: '2.20240726.01.00',
        hl: 'en',
        gl: 'US',
      }
    },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
  },
];

async function tryClient(videoId, clientConfig, signatureTimestamp, poToken) {
  // Use REAL visitorData fetched from an actual YouTube homepage session.
  // A fake random ID triggers "Sign in to confirm you're not a bot" on
  // datacenter IPs. A real one (cached 6h) dramatically improves success.
  const visitorId = await getVisitorData();

  const body = {
    videoId: videoId,
    context: {
      ...clientConfig.context,
      client: {
        ...clientConfig.context.client,
        visitorData: visitorId,
      },
    },
    playbackContext: {
      contentPlaybackContext: {
        signatureTimestamp: signatureTimestamp,
        html5Preference: 'HTML5_PREF_WANTS'
      }
    },
    contentCheckOk: true,
    racyCheckOk: true
  };

  // Include PoToken when available — proves a real Chrome browser signed the
  // request, which bypasses YouTube's datacenter-IP bot detection.
  if (poToken) {
    body.serviceIntegrityDimensions = { poToken };
  }

  const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}&prettyPrint=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': clientConfig.userAgent,
      'X-YouTube-Client-Name': clientConfig.context.client.clientName,
      'X-YouTube-Client-Version': clientConfig.context.client.clientVersion,
      'X-Goog-Visitor-Id': visitorId,
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify(body)
  });

  // Surface HTTP errors — YouTube sometimes returns 400/403 with an HTML
  // body, which used to crash the old extractor silently.
  if (!response.ok) {
    let body = '';
    try { body = (await response.text()).slice(0, 200); } catch (_) {}
    return {
      __httpError: true,
      status: response.status,
      statusText: response.statusText,
      bodyPreview: body
    };
  }

  try {
    return await response.json();
  } catch (err) {
    return { __parseError: true, message: err.message };
  }
}

function extractBestAudio(data) {
  if (data?.__httpError) {
    return { error: `InnerTube HTTP ${data.status} ${data.statusText}: ${data.bodyPreview}` };
  }
  if (data?.__parseError) {
    return { error: `InnerTube JSON parse failed: ${data.message}` };
  }
  if (!data || typeof data !== 'object') {
    return { error: 'InnerTube returned empty response' };
  }

  if (data.playabilityStatus?.status !== 'OK') {
    return {
      error: data.playabilityStatus?.reason
        || data.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.reason?.simpleText
        || `Not playable (${data.playabilityStatus?.status || 'UNKNOWN'})`
    };
  }

  const formats = data.streamingData?.adaptiveFormats || [];
  const audioFormats = formats.filter(f => f.mimeType?.startsWith('audio/'));

  if (audioFormats.length === 0) {
    return { error: 'No audio formats in adaptiveFormats' };
  }

  // BEST QUALITY: Prefer itag 251 (opus 160k) / 140 (aac 128k), then sort by bitrate.
  // opus/webm typically has higher bitrates (160kbps) vs mp4/aac (128kbps).
  const sortedByQuality = audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const bestAudio = sortedByQuality[0];

  console.log(`[Quality] Best: ${bestAudio.mimeType} @ ${bestAudio.bitrate}bps | Available: ${sortedByQuality.map(f => `${f.mimeType?.split(';')[0]}@${f.bitrate}`).join(', ')}`);

  if (!bestAudio.url) {
    return { error: 'URL requires deciphering', cipher: !!bestAudio.signatureCipher };
  }

  return {
    url: bestAudio.url,
    mimeType: bestAudio.mimeType,
    bitrate: bestAudio.bitrate,
    contentLength: bestAudio.contentLength,
    quality: bestAudio.audioQuality || 'AUDIO_QUALITY_MEDIUM',
    itag: bestAudio.itag,
    title: data.videoDetails?.title,
    author: data.videoDetails?.author,
    lengthSeconds: data.videoDetails?.lengthSeconds,
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        edge: true,
        clients: CLIENTS.length,
        clientNames: CLIENTS.map(c => c.name),
        signatureTimestamp: await getSignatureTimestamp(),
        r2: !!env.VOYO_AUDIO,
        version: 'v7'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ========================================
    // R2 AUDIO STREAMING - Primary path (95%)
    // ========================================

    // Check if audio exists - Supabase first, R2 fallback
    // Zero-gap: Supabase is source of truth
    if (url.pathname.startsWith('/exists/')) {
      const videoId = url.pathname.split('/')[2];
      if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return new Response(JSON.stringify({ exists: false, error: 'Invalid ID' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        // TRY SUPABASE FIRST (source of truth)
        if (env.SUPABASE_URL && env.SUPABASE_KEY) {
          const supabaseResponse = await fetch(
            `${env.SUPABASE_URL}/rest/v1/voyo_tracks?youtube_id=eq.${videoId}&select=r2_cached,r2_quality,r2_size`,
            {
              headers: {
                'apikey': env.SUPABASE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_KEY}`,
              }
            }
          );

          if (supabaseResponse.ok) {
            const rows = await supabaseResponse.json();
            if (rows.length > 0 && rows[0].r2_cached !== null) {
              const track = rows[0];
              if (track.r2_cached) {
                return new Response(JSON.stringify({
                  exists: true,
                  high: track.r2_quality === '128',
                  low: track.r2_quality === '64',
                  size: track.r2_size || 0,
                  source: 'supabase'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              } else {
                return new Response(JSON.stringify({
                  exists: false,
                  high: false,
                  low: false,
                  size: 0,
                  source: 'supabase'
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            }
          }
        }

        // FALLBACK: Check R2 directly (for tracks not yet in Supabase or migration pending)
        const [high, low] = await Promise.all([
          env.VOYO_AUDIO.head(`128/${videoId}.opus`),
          env.VOYO_AUDIO.head(`64/${videoId}.opus`)
        ]);

        return new Response(JSON.stringify({
          exists: !!(high || low),
          high: !!high,
          low: !!low,
          size: high?.size || low?.size || 0,
          source: 'r2'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ exists: false, error: err.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Stream audio from R2
    // Files stored as: 128/{videoId}.opus or 64/{videoId}.opus
    if (url.pathname.startsWith('/audio/')) {
      const videoId = url.pathname.split('/')[2];
      const quality = url.searchParams.get('q') || 'high'; // high = 128kbps, low = 64kbps

      if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return new Response(JSON.stringify({ error: 'Invalid video ID' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        // Determine path based on quality (files stored in quality-prefixed folders)
        const primaryPath = quality === 'low' ? `64/${videoId}.opus` : `128/${videoId}.opus`;
        const object = await env.VOYO_AUDIO.get(primaryPath);

        if (!object) {
          // Try fallback to other quality
          const fallbackPath = quality === 'low' ? `128/${videoId}.opus` : `64/${videoId}.opus`;
          const fallback = await env.VOYO_AUDIO.get(fallbackPath);

          if (!fallback) {
            return new Response(JSON.stringify({ error: 'Not in R2', videoId }), {
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Serve fallback
          return new Response(fallback.body, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'audio/opus',
              'Content-Length': fallback.size,
              'Cache-Control': 'public, max-age=31536000', // 1 year
              'X-VOYO-Source': 'r2-fallback',
              'X-VOYO-Quality': quality === 'low' ? '128' : '64'
            }
          });
        }

        // Serve the requested quality
        return new Response(object.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'audio/opus',
            'Content-Length': object.size,
            'Cache-Control': 'public, max-age=31536000', // 1 year
            'X-VOYO-Source': 'r2',
            'X-VOYO-Quality': quality === 'low' ? '64' : '128'
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Thumbnail proxy (avoid CORS issues)
    if (url.pathname.startsWith('/thumb/')) {
      const videoId = url.pathname.split('/')[2];
      const quality = url.searchParams.get('q') || 'hqdefault'; // maxresdefault, hqdefault, mqdefault, default

      if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return new Response('Invalid ID', { status: 400, headers: corsHeaders });
      }

      try {
        const thumbUrl = `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
        const thumbResponse = await fetch(thumbUrl);

        if (!thumbResponse.ok) {
          // Fallback to lower quality
          const fallbackUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
          const fallback = await fetch(fallbackUrl);

          return new Response(fallback.body, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'image/jpeg',
              'Cache-Control': 'public, max-age=86400' // 1 day
            }
          });
        }

        return new Response(thumbResponse.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=86400' // 1 day
          }
        });
      } catch (err) {
        return new Response('Thumbnail error', { status: 500, headers: corsHeaders });
      }
    }

    // ========================================
    // YOUTUBE EXTRACTION - Fallback path (5%)
    // ========================================

    // Extract audio stream with multi-client fallback
    if (url.pathname === '/stream') {
      const videoId = url.searchParams.get('v');
      if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return new Response(JSON.stringify({ error: 'Invalid video ID' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const attempts = [];
      const [sts, poToken] = await Promise.all([getSignatureTimestamp(), fetchPoToken(videoId)]);
      if (poToken) console.log(`[Stream] ${videoId} using PoToken (bgutil-pot)`);

      // Try each client until one works
      for (const client of CLIENTS) {
        try {
          const data = await tryClient(videoId, client, sts, poToken);
          const result = extractBestAudio(data);

          if (result.url) {
            console.log(`[Stream] ${videoId} → ${client.name} OK (itag ${result.itag}, ${result.bitrate}bps)`);
            return new Response(JSON.stringify({
              ...result,
              client: client.name,
              triedClients: [...attempts.map(a => a.client), client.name]
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          attempts.push({ client: client.name, error: result.error });
          console.log(`[Stream] ${videoId} ${client.name} FAIL: ${result.error}`);
        } catch (err) {
          attempts.push({ client: client.name, error: err.message });
          console.log(`[Stream] ${videoId} ${client.name} THROW: ${err.message}`);
        }
      }

      // All InnerTube clients failed — fall back to VPS stream URL.
      // VPS uses Chrome cookies + yt-dlp (not datacenter-IP blocked).
      console.log(`[Stream] ${videoId} all clients failed, returning VPS fallback URL`);
      return new Response(JSON.stringify({
        url: `${VPS_AUDIO_URL}/voyo/audio/${videoId}?quality=high`,
        source: 'vps_fallback',
        client: 'vps',
        triedClients: attempts.map(a => a.client),
        attempts
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ========================================
    // EXTRACT + STREAM - Full audio extraction (replaces Fly.io)
    // ========================================
    // Returns actual audio bytes, not just URL. Handles CORS.
    if (url.pathname.startsWith('/extract/')) {
      const videoId = url.pathname.split('/')[2];
      if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return new Response(JSON.stringify({ error: 'Invalid video ID' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Try each client until one works
      let audioUrl = null;
      let mimeType = 'audio/mp4';
      const extractAttempts = [];
      const [sts, poToken] = await Promise.all([getSignatureTimestamp(), fetchPoToken(videoId)]);
      if (poToken) console.log(`[Extract] ${videoId} using PoToken (bgutil-pot)`);

      for (const client of CLIENTS) {
        try {
          const data = await tryClient(videoId, client, sts, poToken);
          const result = extractBestAudio(data);

          if (result.url) {
            audioUrl = result.url;
            mimeType = result.mimeType || 'audio/mp4';
            console.log(`[Extract] ${videoId} → ${client.name} OK (itag ${result.itag})`);
            break;
          }
          extractAttempts.push({ client: client.name, error: result.error });
          console.log(`[Extract] ${videoId} ${client.name} FAIL: ${result.error}`);
        } catch (err) {
          extractAttempts.push({ client: client.name, error: err.message });
          console.log(`[Extract] ${videoId} ${client.name} THROW: ${err.message}`);
        }
      }

      if (!audioUrl) {
        // All InnerTube clients failed. Return 502 so VPS falls through to
        // yt-dlp instead of receiving a 302 redirect that loops back to itself.
        // (VPS calls /extract → 302 to VPS → VPS rejects 302 as error → circuit
        // breaker trips. Returning 502 is cleaner: VPS records edge failure and
        // skips edge for 60s, going straight to yt-dlp which is what we want.)
        console.log(`[Extract] ${videoId} all clients failed`);
        return new Response(JSON.stringify({ error: 'All InnerTube clients failed' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Fetch and stream the audio bytes
      try {
        const audioResponse = await fetch(audioUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Range': request.headers.get('Range') || 'bytes=0-',
          }
        });

        if (!audioResponse.ok) {
          return new Response(JSON.stringify({ error: `Fetch failed: ${audioResponse.status}` }), {
            status: audioResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Stream response with CORS headers
        const responseHeaders = {
          ...corsHeaders,
          'Content-Type': mimeType.split(';')[0],
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
          'X-VOYO-Source': 'extract'
        };

        if (audioResponse.headers.get('Content-Length')) {
          responseHeaders['Content-Length'] = audioResponse.headers.get('Content-Length');
        }
        if (audioResponse.headers.get('Content-Range')) {
          responseHeaders['Content-Range'] = audioResponse.headers.get('Content-Range');
        }

        return new Response(audioResponse.body, {
          status: audioResponse.status,
          headers: responseHeaders
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // CORS Proxy - Forward requests to YouTube with CORS headers
    // This allows client-side youtubei.js to use Cloudflare's trusted IPs
    if (url.pathname === '/proxy') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        // Forward the request to YouTube
        const proxyResponse = await fetch(targetUrl, {
          method: request.method,
          headers: {
            'User-Agent': 'com.google.ios.youtube/19.32.8 (iPhone16,2; U; CPU iOS 17_6_1 like Mac OS X; en_US)',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Origin': 'https://www.youtube.com',
            'Referer': 'https://www.youtube.com/',
          },
          body: request.method === 'POST' ? await request.text() : undefined,
        });

        // Clone response and add CORS headers
        const responseBody = await proxyResponse.arrayBuffer();
        const responseHeaders = new Headers(proxyResponse.headers);

        // Add CORS headers
        Object.entries(corsHeaders).forEach(([key, value]) => {
          responseHeaders.set(key, value);
        });

        return new Response(responseBody, {
          status: proxyResponse.status,
          headers: responseHeaders
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Debug endpoint — probe EVERY client for a videoId and report
    // per-client diagnostics. Invaluable when YouTube breaks something.
    //
    //   GET /debug?v={id}              → probe all CLIENTS
    //   GET /debug?v={id}&client=IOS   → probe just one
    if (url.pathname === '/debug') {
      const videoId = url.searchParams.get('v');
      const only = url.searchParams.get('client');

      if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return new Response(JSON.stringify({ error: 'Invalid video ID' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const targets = only
        ? CLIENTS.filter(c => c.name === only)
        : CLIENTS;

      if (targets.length === 0) {
        return new Response(JSON.stringify({
          error: `Unknown client: ${only}`,
          available: CLIENTS.map(c => c.name)
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const results = [];
      const stsDiag = await getSignatureTimestamp();
      for (const client of targets) {
        const started = Date.now();
        try {
          const data = await tryClient(videoId, client, stsDiag);
          const extracted = extractBestAudio(data);

          results.push({
            client: client.name,
            clientVersion: client.context.client.clientVersion,
            ms: Date.now() - started,
            httpError: data?.__httpError
              ? { status: data.status, bodyPreview: data.bodyPreview }
              : null,
            playabilityStatus: data?.playabilityStatus?.status || null,
            playabilityReason: data?.playabilityStatus?.reason || null,
            hasStreamingData: !!data?.streamingData,
            formatCount: data?.streamingData?.adaptiveFormats?.length || 0,
            audioFormatCount: (data?.streamingData?.adaptiveFormats || [])
              .filter(f => f.mimeType?.startsWith('audio/')).length,
            extractSuccess: !!extracted.url,
            extractError: extracted.error || null,
            bestAudio: extracted.url ? {
              itag: extracted.itag,
              mimeType: extracted.mimeType,
              bitrate: extracted.bitrate,
              quality: extracted.quality
            } : null,
            videoDetails: data?.videoDetails ? {
              title: data.videoDetails.title,
              author: data.videoDetails.author,
              lengthSeconds: data.videoDetails.lengthSeconds,
            } : null
          });
        } catch (err) {
          results.push({
            client: client.name,
            clientVersion: client.context.client.clientVersion,
            ms: Date.now() - started,
            throw: err.message
          });
        }
      }

      const winners = results.filter(r => r.extractSuccess).map(r => r.client);

      return new Response(JSON.stringify({
        videoId,
        signatureTimestamp: stsDiag,
        totalClients: targets.length,
        winners,
        anyWorked: winners.length > 0,
        results
      }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ========================================
    // R2 COLLECTIVE UPLOAD - ATOMIC (R2 + Supabase)
    // Zero-gap: Both succeed or neither
    // ========================================
    if (url.pathname.startsWith('/upload/') && request.method === 'POST') {
      const videoId = url.pathname.split('/')[2];
      const quality = url.searchParams.get('q') || 'high'; // high = 128kbps folder
      const title = url.searchParams.get('title') || '';
      const artist = url.searchParams.get('artist') || '';

      if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return new Response(JSON.stringify({ error: 'Invalid video ID' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        const qualityFolder = quality === 'low' ? '64' : '128';

        // Check if already exists in R2
        const existingCheck = await env.VOYO_AUDIO.head(`${qualityFolder}/${videoId}.opus`);

        if (existingCheck) {
          // Already in R2, ensure Supabase is synced
          if (env.SUPABASE_URL && env.SUPABASE_KEY) {
            // Update ALL matching records (youtube_id is not unique)
            await fetch(`${env.SUPABASE_URL}/rest/v1/voyo_tracks?youtube_id=eq.${videoId}`, {
              method: 'PATCH',
              headers: {
                'apikey': env.SUPABASE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                r2_cached: true,
                r2_quality: qualityFolder,
                r2_size: existingCheck.size,
                r2_cached_at: new Date().toISOString()
              })
            });
          }

          return new Response(JSON.stringify({
            success: true,
            status: 'already_exists',
            videoId,
            quality: qualityFolder
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Get audio data from request body
        const audioData = await request.arrayBuffer();

        if (!audioData || audioData.byteLength < 1000) {
          return new Response(JSON.stringify({ error: 'Invalid audio data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // STEP 1: Upload to R2
        await env.VOYO_AUDIO.put(`${qualityFolder}/${videoId}.opus`, audioData, {
          httpMetadata: {
            contentType: 'audio/opus',
          },
          customMetadata: {
            uploadedAt: new Date().toISOString(),
            source: 'user-boost',
          }
        });

        console.log(`[R2] Uploaded ${videoId} to ${qualityFolder}/ (${audioData.byteLength} bytes)`);

        // STEP 2: Update Supabase (atomic - if this fails, delete from R2)
        if (env.SUPABASE_URL && env.SUPABASE_KEY) {
          try {
            // Update ALL matching records (youtube_id is not unique)
            const supabaseResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/voyo_tracks?youtube_id=eq.${videoId}`, {
              method: 'PATCH',
              headers: {
                'apikey': env.SUPABASE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                r2_cached: true,
                r2_quality: qualityFolder,
                r2_size: audioData.byteLength,
                r2_cached_at: new Date().toISOString()
              })
            });

            if (!supabaseResponse.ok) {
              // ROLLBACK: Delete from R2 if Supabase fails
              console.error(`[Supabase] Update failed, rolling back R2 upload for ${videoId}`);
              await env.VOYO_AUDIO.delete(`${qualityFolder}/${videoId}.opus`);
              const errorText = await supabaseResponse.text();
              return new Response(JSON.stringify({
                success: false,
                error: 'Supabase update failed',
                details: errorText
              }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }

            console.log(`[Supabase] Updated ${videoId} with r2_cached=true`);
          } catch (supabaseErr) {
            // ROLLBACK: Delete from R2 if Supabase fails
            console.error(`[Supabase] Error, rolling back R2 upload for ${videoId}:`, supabaseErr);
            await env.VOYO_AUDIO.delete(`${qualityFolder}/${videoId}.opus`);
            return new Response(JSON.stringify({
              success: false,
              error: 'Supabase update failed',
              details: supabaseErr.message
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }

        return new Response(JSON.stringify({
          success: true,
          status: 'uploaded',
          videoId,
          quality: qualityFolder,
          size: audioData.byteLength,
          supabase_synced: !!(env.SUPABASE_URL && env.SUPABASE_KEY)
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        console.error(`[Upload] Error for ${videoId}:`, err);
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ========================================
    // RECONCILIATION - Sync R2 file to Supabase
    // Call this for orphaned R2 files
    // ========================================
    if (url.pathname.startsWith('/reconcile/') && request.method === 'POST') {
      const videoId = url.pathname.split('/')[2];

      if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return new Response(JSON.stringify({ error: 'Invalid video ID' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        // Check R2 for this file
        const [high, low] = await Promise.all([
          env.VOYO_AUDIO.head(`128/${videoId}.opus`),
          env.VOYO_AUDIO.head(`64/${videoId}.opus`)
        ]);

        if (!high && !low) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Not found in R2'
          }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const qualityFolder = high ? '128' : '64';
        const size = high?.size || low?.size || 0;

        // Update ALL matching records in Supabase (youtube_id is not unique)
        if (env.SUPABASE_URL && env.SUPABASE_KEY) {
          await fetch(`${env.SUPABASE_URL}/rest/v1/voyo_tracks?youtube_id=eq.${videoId}`, {
            method: 'PATCH',
            headers: {
              'apikey': env.SUPABASE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              r2_cached: true,
              r2_quality: qualityFolder,
              r2_size: size,
              r2_cached_at: new Date().toISOString()
            })
          });
        }

        return new Response(JSON.stringify({
          success: true,
          videoId,
          quality: qualityFolder,
          size
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ========================================
    // VIDEO FEED - Moments video from R2
    // ========================================

    // Check if video exists in R2 for a moment
    if (url.pathname.match(/^\/r2\/feed\/[^/]+\/check$/)) {
      const sourceId = url.pathname.split('/')[3];
      if (!sourceId) {
        return new Response(JSON.stringify({ exists: false, error: 'Missing source_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        // Check Supabase for r2_video_key first
        if (env.SUPABASE_URL && env.SUPABASE_KEY) {
          const supabaseResponse = await fetch(
            `${env.SUPABASE_URL}/rest/v1/voyo_moments?source_id=eq.${sourceId}&select=r2_video_key`,
            {
              headers: {
                'apikey': env.SUPABASE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_KEY}`,
              }
            }
          );

          if (supabaseResponse.ok) {
            const rows = await supabaseResponse.json();
            if (rows.length > 0 && rows[0].r2_video_key) {
              // Verify it actually exists in R2
              const obj = await env.VOYO_AUDIO.head(rows[0].r2_video_key);
              return new Response(JSON.stringify({
                exists: !!obj,
                size: obj?.size || 0,
                key: rows[0].r2_video_key,
                source: 'supabase'
              }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          }
        }

        // Fallback: check R2 directly with common patterns
        const patterns = [
          `moments/tiktok/${sourceId}.mp4`,
          `moments/instagram/${sourceId}.mp4`,
          `moments/youtube/${sourceId}.mp4`,
        ];

        for (const key of patterns) {
          const obj = await env.VOYO_AUDIO.head(key);
          if (obj) {
            return new Response(JSON.stringify({
              exists: true,
              size: obj.size,
              key,
              source: 'r2-scan'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }

        return new Response(JSON.stringify({ exists: false }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ exists: false, error: err.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Stream video from R2 for a moment
    if (url.pathname.match(/^\/r2\/feed\/[^/]+$/) && !url.pathname.endsWith('/check')) {
      const sourceId = url.pathname.split('/')[3];
      if (!sourceId) {
        return new Response(JSON.stringify({ error: 'Missing source_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        let r2Key = null;

        // Check Supabase for the key
        if (env.SUPABASE_URL && env.SUPABASE_KEY) {
          const supabaseResponse = await fetch(
            `${env.SUPABASE_URL}/rest/v1/voyo_moments?source_id=eq.${sourceId}&select=r2_video_key`,
            {
              headers: {
                'apikey': env.SUPABASE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_KEY}`,
              }
            }
          );

          if (supabaseResponse.ok) {
            const rows = await supabaseResponse.json();
            if (rows.length > 0 && rows[0].r2_video_key) {
              r2Key = rows[0].r2_video_key;
            }
          }
        }

        // Fallback: try common patterns
        if (!r2Key) {
          const patterns = [
            `moments/tiktok/${sourceId}.mp4`,
            `moments/instagram/${sourceId}.mp4`,
            `moments/youtube/${sourceId}.mp4`,
          ];
          for (const key of patterns) {
            const exists = await env.VOYO_AUDIO.head(key);
            if (exists) { r2Key = key; break; }
          }
        }

        if (!r2Key) {
          return new Response(JSON.stringify({ error: 'Video not found', sourceId }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Stream the video
        const object = await env.VOYO_AUDIO.get(r2Key);
        if (!object) {
          return new Response(JSON.stringify({ error: 'R2 object missing', key: r2Key }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const responseHeaders = {
          ...corsHeaders,
          'Content-Type': 'video/mp4',
          'Content-Length': object.size,
          'Cache-Control': 'public, max-age=31536000',
          'X-VOYO-Source': 'r2-video',
          'Accept-Ranges': 'bytes',
        };

        // Handle Range requests for video seeking
        const rangeHeader = request.headers.get('Range');
        if (rangeHeader) {
          const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = rangeMatch[2] ? parseInt(rangeMatch[2]) : object.size - 1;

            const rangedObject = await env.VOYO_AUDIO.get(r2Key, {
              range: { offset: start, length: end - start + 1 }
            });

            return new Response(rangedObject.body, {
              status: 206,
              headers: {
                ...responseHeaders,
                'Content-Range': `bytes ${start}-${end}/${object.size}`,
                'Content-Length': end - start + 1,
              }
            });
          }
        }

        return new Response(object.body, { headers: responseHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ========================================
    // SEARCH - YouTube search via InnerTube
    // ========================================
    // Uses WEB client. The ANDROID client was returning 400 on the search
    // endpoint as of Apr-2026. WEB is the most stable for /search specifically
    // and supports the videoRenderer shape used by the parser below.
    if (url.pathname === '/api/search') {
      const query = url.searchParams.get('q');
      const limit = parseInt(url.searchParams.get('limit') || '20');

      if (!query) {
        return new Response(JSON.stringify({ error: 'Missing q parameter' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const webContext = {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20241205.01.00',
          hl: 'en',
          gl: 'US',
          clientFormFactor: 'UNKNOWN_FORM_FACTOR',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36,gzip(gfe)',
        }
      };

      try {
        // Use YouTube Innertube search API directly
        const searchResponse = await fetch(
          `https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_API_KEY}&prettyPrint=false`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'X-YouTube-Client-Name': '1',
              'X-YouTube-Client-Version': '2.20241205.01.00',
              'Origin': 'https://www.youtube.com',
              'Referer': 'https://www.youtube.com/',
              'Accept': 'application/json',
              'Accept-Language': 'en-US,en;q=0.9',
            },
            body: JSON.stringify({
              query: query,
              context: webContext,
              params: 'EgIQAQ%3D%3D' // Filter: videos only (safe default, works across clients)
            })
          }
        );

        if (!searchResponse.ok) {
          let errBody = '';
          try { errBody = (await searchResponse.text()).slice(0, 300); } catch (_) {}
          console.log(`[Search] ${query} → HTTP ${searchResponse.status}: ${errBody}`);
          return new Response(JSON.stringify({
            error: `YouTube search failed: ${searchResponse.status}`,
            bodyPreview: errBody
          }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const data = await searchResponse.json();

        // Parse InnerTube search results. Structure:
        //  contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[]
        //    .itemSectionRenderer.contents[]  ← where videoRenderer lives
        const items = [];
        const primary = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
          || data?.contents; // fallback for mobile client shapes
        const sections = primary?.sectionListRenderer?.contents || [];

        const extractRun = (textObj) =>
          textObj?.runs?.map(r => r.text).join('') || textObj?.simpleText || '';

        for (const section of sections) {
          const renderers = section?.itemSectionRenderer?.contents || [];
          for (const renderer of renderers) {
            const video = renderer?.videoRenderer
              || renderer?.compactVideoRenderer
              || renderer?.videoWithContextRenderer;
            if (!video) continue;
            const videoId = video.videoId
              || video.navigationEndpoint?.watchEndpoint?.videoId;
            if (!videoId) continue;

            items.push({
              id: videoId,
              title: extractRun(video.title) || extractRun(video.headline),
              artist: extractRun(video.longBylineText) || extractRun(video.shortBylineText) || extractRun(video.ownerText),
              thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
              duration: extractRun(video.lengthText),
              views: extractRun(video.viewCountText),
            });

            if (items.length >= limit) break;
          }
          if (items.length >= limit) break;
        }

        return new Response(JSON.stringify({
          items,
          count: items.length,
          source: 'innertube-web'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        console.log(`[Search] ${query} THROW: ${err.message}`);
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ========================================
    // CDN ART - Album artwork proxy (replaces Fly.io /cdn/art/)
    // ========================================
    if (url.pathname.startsWith('/cdn/art/')) {
      const trackId = url.pathname.split('/')[3];
      const quality = url.searchParams.get('quality') || 'high';

      if (!trackId) {
        return new Response('Missing track ID', { status: 400, headers: corsHeaders });
      }

      const thumbQuality = quality === 'high' ? 'maxresdefault' : 'hqdefault';
      const thumbUrl = `https://i.ytimg.com/vi/${trackId}/${thumbQuality}.jpg`;

      try {
        const thumbResponse = await fetch(thumbUrl);

        if (!thumbResponse.ok) {
          const fallback = await fetch(`https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`);
          return new Response(fallback.body, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'image/jpeg',
              'Cache-Control': 'public, max-age=86400'
            }
          });
        }

        return new Response(thumbResponse.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=86400'
          }
        });
      } catch (err) {
        return new Response('Art error', { status: 500, headers: corsHeaders });
      }
    }

    return new Response('VOYO Edge Worker v7 - Unified Gateway (IOS + ANDROID_VR + WEB_EMBEDDED)', { headers: corsHeaders });
  }
};

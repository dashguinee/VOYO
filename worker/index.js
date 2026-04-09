/**
 * VOYO Music - Cloudflare Worker v4
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
 *
 * Edge = 300+ locations worldwide = FAST
 */

// Client configurations ranked by success rate
const CLIENTS = [
  {
    name: 'ANDROID_TESTSUITE',
    context: {
      client: {
        clientName: 'ANDROID_TESTSUITE',
        clientVersion: '1.9',
        androidSdkVersion: 30,
        hl: 'en',
        gl: 'US',
      }
    },
    userAgent: 'com.google.android.youtube/1.9 (Linux; U; Android 11) gzip'
  },
  {
    name: 'ANDROID_MUSIC',
    context: {
      client: {
        clientName: 'ANDROID_MUSIC',
        clientVersion: '6.42.52',
        androidSdkVersion: 30,
        hl: 'en',
        gl: 'US',
      }
    },
    userAgent: 'com.google.android.apps.youtube.music/6.42.52 (Linux; U; Android 11) gzip'
  },
  {
    name: 'ANDROID',
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '19.09.37',
        androidSdkVersion: 30,
        hl: 'en',
        gl: 'US',
      }
    },
    userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip'
  },
  {
    name: 'IOS',
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '19.09.3',
        deviceModel: 'iPhone14,3',
        hl: 'en',
        gl: 'US',
      }
    },
    userAgent: 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)'
  },
  {
    name: 'TV_EMBEDDED',
    context: {
      client: {
        clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
        clientVersion: '2.0',
        hl: 'en',
        gl: 'US',
      },
      thirdParty: {
        embedUrl: 'https://www.youtube.com/'
      }
    },
    userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) SamsungBrowser/5.0 TV Safari/538.1'
  }
];

async function tryClient(videoId, clientConfig) {
  const response = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': clientConfig.userAgent,
      'X-YouTube-Client-Name': clientConfig.context.client.clientName,
      'X-YouTube-Client-Version': clientConfig.context.client.clientVersion,
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/',
    },
    body: JSON.stringify({
      videoId: videoId,
      context: clientConfig.context,
      playbackContext: {
        contentPlaybackContext: {
          signatureTimestamp: 19950 // Recent signature timestamp
        }
      },
      contentCheckOk: true,
      racyCheckOk: true
    })
  });

  return response.json();
}

function extractBestAudio(data) {
  if (data.playabilityStatus?.status !== 'OK') {
    return { error: data.playabilityStatus?.reason || 'Not playable' };
  }

  const formats = data.streamingData?.adaptiveFormats || [];
  const audioFormats = formats.filter(f => f.mimeType?.startsWith('audio/'));

  if (audioFormats.length === 0) {
    return { error: 'No audio formats' };
  }

  // BEST QUALITY: Sort ALL formats by bitrate, take highest
  // opus/webm typically has higher bitrates (160kbps) vs mp4/aac (128kbps)
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
    title: data.videoDetails?.title,
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
        r2: !!env.VOYO_AUDIO,
        version: 'v3'
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

      const errors = [];

      // Try each client until one works
      for (const client of CLIENTS) {
        try {
          const data = await tryClient(videoId, client);
          const result = extractBestAudio(data);

          if (result.url) {
            return new Response(JSON.stringify({
              ...result,
              client: client.name // Tell us which client worked
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          errors.push({ client: client.name, error: result.error });
        } catch (err) {
          errors.push({ client: client.name, error: err.message });
        }
      }

      // All clients failed
      return new Response(JSON.stringify({
        error: 'All clients failed',
        attempts: errors
      }), {
        status: 403,
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

      for (const client of CLIENTS) {
        try {
          const data = await tryClient(videoId, client);
          const result = extractBestAudio(data);

          if (result.url) {
            audioUrl = result.url;
            mimeType = result.mimeType || 'audio/mp4';
            console.log(`[Extract] Success with ${client.name}: ${videoId}`);
            break;
          }
        } catch (err) {
          // Try next client
        }
      }

      if (!audioUrl) {
        return new Response(JSON.stringify({ error: 'Extraction failed' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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
            'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
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

    // Debug endpoint - test specific client
    if (url.pathname === '/debug') {
      const videoId = url.searchParams.get('v');
      const clientName = url.searchParams.get('client') || 'ANDROID_TESTSUITE';

      if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return new Response(JSON.stringify({ error: 'Invalid video ID' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const client = CLIENTS.find(c => c.name === clientName) || CLIENTS[0];

      try {
        const data = await tryClient(videoId, client);
        return new Response(JSON.stringify({
          client: client.name,
          playabilityStatus: data.playabilityStatus,
          hasStreamingData: !!data.streamingData,
          formatCount: data.streamingData?.adaptiveFormats?.length || 0,
          videoDetails: data.videoDetails ? {
            title: data.videoDetails.title,
            author: data.videoDetails.author,
            lengthSeconds: data.videoDetails.lengthSeconds,
          } : null
        }, null, 2), {
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
    // SEARCH - YouTube search via Piped API (replaces Fly.io /api/search)
    // ========================================
    if (url.pathname === '/api/search') {
      const query = url.searchParams.get('q');
      const limit = parseInt(url.searchParams.get('limit') || '20');

      if (!query) {
        return new Response(JSON.stringify({ error: 'Missing q parameter' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        // Use YouTube Innertube search API directly (same clients as extraction)
        const searchResponse = await fetch(
          'https://www.youtube.com/youtubei/v1/search?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
              'X-YouTube-Client-Name': 'ANDROID',
              'X-YouTube-Client-Version': '19.09.37',
            },
            body: JSON.stringify({
              query: query,
              context: {
                client: {
                  clientName: 'ANDROID',
                  clientVersion: '19.09.37',
                  androidSdkVersion: 30,
                  hl: 'en',
                  gl: 'US',
                }
              },
              params: 'EgWKAQIIAWoMEA4QChADEAQQCRAF' // Music filter
            })
          }
        );

        if (!searchResponse.ok) {
          return new Response(JSON.stringify({ error: `YouTube search failed: ${searchResponse.status}` }), {
            status: searchResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const data = await searchResponse.json();

        // Parse Innertube search results
        const items = [];
        const contents = data?.contents?.sectionListRenderer?.contents || [];
        for (const section of contents) {
          const renderers = section?.itemSectionRenderer?.contents || [];
          for (const renderer of renderers) {
            const video = renderer?.compactVideoRenderer || renderer?.videoWithContextRenderer || renderer?.videoRenderer;
            if (!video) continue;
            const videoId = video.videoId || video.navigationEndpoint?.watchEndpoint?.videoId;
            if (!videoId) continue;

            items.push({
              id: videoId,
              title: video.title?.runs?.[0]?.text || video.headline?.runs?.[0]?.text || '',
              artist: video.longBylineText?.runs?.[0]?.text || video.shortBylineText?.runs?.[0]?.text || '',
              thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
              duration: video.lengthText?.runs?.[0]?.text || video.lengthText?.simpleText || '',
            });

            if (items.length >= limit) break;
          }
          if (items.length >= limit) break;
        }

        return new Response(JSON.stringify({ items, source: 'innertube' }), {
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

    return new Response('VOYO Edge Worker v6 - Unified Gateway', { headers: corsHeaders });
  }
};

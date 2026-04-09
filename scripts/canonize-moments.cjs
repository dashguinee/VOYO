#!/usr/bin/env node

/**
 * VOYO Moments Canonizer
 *
 * Reads metadata files from Instagram, TikTok, and YouTube siphon content
 * and upserts them into the voyo_moments Supabase table.
 *
 * Supported metadata formats:
 *   - yt-dlp .info.json files (has `extractor` field) → Instagram/YouTube
 *   - Siphon .mp4.json files (has `post_shortcode` field) → Instagram
 *   - TikTok API .mp4.json/.mp3.json files (has `stats.diggCount`) → TikTok
 *
 * Usage:
 *   node canonize-moments.cjs                          # Process all platforms
 *   node canonize-moments.cjs --platform tiktok        # TikTok only
 *   node canonize-moments.cjs --platform tiktok,youtube # TikTok + YouTube
 *   node canonize-moments.cjs --dry-run                # Preview without inserting
 *   node canonize-moments.cjs --limit 10               # Process only first 10 files
 *   node canonize-moments.cjs --dry-run --limit 5
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

const PLATFORM_DIRS = {
  instagram: '/home/dash/.zion/renaissance/siphon/content/instagram',
  tiktok: '/home/dash/.zion/renaissance/siphon/content/tiktok',
  youtube: '/home/dash/.zion/renaissance/siphon/content/youtube',
};
const ALL_PLATFORMS = Object.keys(PLATFORM_DIRS);
const BATCH_SIZE = 100;

// ─── CLI Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const platformIdx = args.indexOf('--platform');
const PLATFORMS = platformIdx !== -1
  ? args[platformIdx + 1].split(',').map(p => p.trim().toLowerCase()).filter(p => ALL_PLATFORMS.includes(p))
  : ALL_PLATFORMS;

// ─── Content Type Detection ──────────────────────────────────────────────────

const CONTENT_TYPE_RULES = [
  {
    type: 'dance',
    keywords: [
      'dance', 'dancing', 'danse', 'danser', 'choreo', 'choreography',
      'twerk', 'afrodance', 'afrobeat', 'amapiano', 'ndombolo',
      'azonto', 'gwara', 'shaku', 'zanku', 'legwork', 'gbese',
      'disponible', 'challenge'
    ]
  },
  {
    type: 'comedy',
    keywords: [
      'comedy', 'funny', 'skit', 'humor', 'humour', 'joke', 'jokes',
      'laugh', 'lol', 'lmao', 'hilarious', 'prank', 'meme',
      'nollywood', 'naija comedy', 'wahala', 'wetin'
    ]
  },
  {
    type: 'cover',
    keywords: [
      'cover', 'remix', 'acoustic', 'unplugged', 'reprise', 'version'
    ]
  },
  {
    type: 'live',
    keywords: [
      'live', 'concert', 'performance', 'stage', 'festival', 'show',
      'en direct', 'spectacle'
    ]
  },
  {
    type: 'fashion',
    keywords: [
      'fashion', 'style', 'outfit', 'ootd', 'drip', 'swag',
      'mode', 'lookbook', 'fit check', 'fitcheck'
    ]
  },
  {
    type: 'sports',
    keywords: [
      'football', 'soccer', 'basketball', 'gym', 'workout', 'fitness',
      'training', 'sport', 'goal', 'match'
    ]
  },
  {
    type: 'tutorial',
    keywords: [
      'tutorial', 'how to', 'howto', 'learn', 'tuto', 'step by step',
      'diy', 'tips', 'guide'
    ]
  },
  {
    type: 'lip_sync',
    keywords: [
      'lip sync', 'lipsync', 'lip-sync', 'playback', 'singing along'
    ]
  },
  {
    type: 'reaction',
    keywords: [
      'reaction', 'react', 'reacting', 'watching'
    ]
  }
];

function detectContentType(text) {
  if (!text) return 'original';
  const lower = text.toLowerCase();
  for (const rule of CONTENT_TYPE_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule.type;
    }
  }
  return 'original';
}

// ─── Hashtag Extraction ──────────────────────────────────────────────────────

function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#[\w\u00C0-\u024F]+/g);
  if (!matches) return [];
  return [...new Set(matches.map(t => t.toLowerCase()))];
}

// ─── Cultural Tag Detection ──────────────────────────────────────────────────

const CULTURAL_INDICATORS = [
  // Nigeria
  { tags: ['nigeria', 'naija'], keywords: ['naija', 'lagos', 'abuja', 'nigeria', 'nollywood', 'pidgin', 'jollof', 'owambe', 'aso ebi', 'yoruba', 'igbo', 'hausa'] },
  // Senegal
  { tags: ['senegal'], keywords: ['dakar', 'senegal', 'sénégal', 'wolof', 'kebetu', 'thiès', 'mbalax'] },
  // Guinea
  { tags: ['guinea', 'conakry'], keywords: ['conakry', 'guinea', 'guinée', 'guinee', 'soussou', 'malinké', 'peul', 'kankan'] },
  // Ivory Coast
  { tags: ['ivory coast', 'cote divoire'], keywords: ['abidjan', 'ivory coast', "cote d'ivoire", 'côte d\'ivoire', 'ivoirien', 'drogba', 'zouglou', 'coupé décalé'] },
  // Ghana
  { tags: ['ghana'], keywords: ['accra', 'ghana', 'ghanaian', 'azonto', 'highlife', 'jollof'] },
  // South Africa
  { tags: ['south africa', 'mzansi'], keywords: ['mzansi', 'amapiano', 'south africa', 'johannesburg', 'joburg', 'soweto', 'cape town', 'gqom', 'kwaito'] },
  // Congo / DRC
  { tags: ['congo', 'drc'], keywords: ['congo', 'congolais', 'congolese', 'kinshasa', 'ndombolo', 'rumba', 'brazzaville', 'lingala'] },
  // Cameroon
  { tags: ['cameroon'], keywords: ['cameroon', 'cameroun', 'douala', 'yaoundé', 'makossa', 'bikutsi'] },
  // Tanzania
  { tags: ['tanzania'], keywords: ['tanzania', 'bongo flava', 'dar es salaam', 'singeli'] },
  // Kenya
  { tags: ['kenya'], keywords: ['kenya', 'nairobi', 'gengetone', 'genge'] },
  // Morocco
  { tags: ['morocco'], keywords: ['morocco', 'maroc', 'casablanca', 'rabat', 'chaabi'] },
  // Algeria
  { tags: ['algeria'], keywords: ['algeria', 'algérie', 'rai', 'alger'] },
  // Mali
  { tags: ['mali'], keywords: ['mali', 'bamako', 'malien'] },
  // Burkina Faso
  { tags: ['burkina faso'], keywords: ['burkina', 'ouagadougou', 'burkinabé'] },
  // Togo
  { tags: ['togo'], keywords: ['togo', 'lomé', 'togolais'] },
  // Benin
  { tags: ['benin'], keywords: ['benin', 'bénin', 'cotonou', 'béninois'] },
  // Africa general
  { tags: ['africa'], keywords: ['africa', 'afrique', 'african', 'africain'] },
  // France / diaspora
  { tags: ['france', 'diaspora'], keywords: ['paris', 'france', 'français', 'french', 'marseille', 'lyon'] },
  // UK / diaspora
  { tags: ['uk', 'diaspora'], keywords: ['london', 'uk', 'united kingdom', 'british', 'manchester'] },
  // USA / diaspora
  { tags: ['usa', 'diaspora'], keywords: ['usa', 'america', 'new york', 'atlanta', 'houston', 'brooklyn'] },
];

function detectCulturalTags(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const detected = new Set();
  for (const indicator of CULTURAL_INDICATORS) {
    for (const kw of indicator.keywords) {
      if (lower.includes(kw)) {
        indicator.tags.forEach(t => detected.add(t));
        break; // one keyword match is enough per indicator group
      }
    }
  }
  return [...detected];
}

// ─── Virality Score ──────────────────────────────────────────────────────────

function calculateViralityScore(likeCount, commentCount, viewCount) {
  const raw = (likeCount || 0) * 1 + (commentCount || 0) * 3 + (viewCount || 0) * 0.01;
  // Cap at 100 for heat_score mapping
  return Math.round(raw);
}

function calculateHeatScore(viralityScore) {
  // Map virality to 0-100 heat score
  // 0-1000 → 0-20, 1000-10000 → 20-40, 10000-100000 → 40-60, 100000-500000 → 60-80, 500000+ → 80-100
  if (viralityScore <= 0) return 0;
  if (viralityScore < 1000) return Math.round((viralityScore / 1000) * 20);
  if (viralityScore < 10000) return Math.round(20 + ((viralityScore - 1000) / 9000) * 20);
  if (viralityScore < 100000) return Math.round(40 + ((viralityScore - 10000) / 90000) * 20);
  if (viralityScore < 500000) return Math.round(60 + ((viralityScore - 100000) / 400000) * 20);
  return Math.min(100, Math.round(80 + ((viralityScore - 500000) / 500000) * 20));
}

// ─── Transform raw JSON → voyo_moments row ──────────────────────────────────

// Detect format: yt-dlp .info.json vs TikTok API vs siphon .mp4.json
function isYtDlpFormat(raw) {
  return !!(raw.extractor || raw.extractor_key || raw.webpage_url_domain);
}

function isTikTokFormat(raw) {
  return !!(raw.stats && ('diggCount' in raw.stats || 'playCount' in raw.stats) && raw.author);
}

function transformToMoment(raw, platformHint) {
  // Handle three formats: yt-dlp (.info.json), TikTok API, and siphon (.mp4.json)
  if (isYtDlpFormat(raw)) {
    return transformYtDlp(raw, platformHint);
  }
  if (isTikTokFormat(raw)) {
    return transformTikTok(raw);
  }
  return transformSiphon(raw);
}

// yt-dlp .info.json format (id, title, channel, uploader, like_count, etc.)
function transformYtDlp(raw, platformHint) {
  const description = raw.description || '';
  const combinedText = `${raw.title || ''} ${description}`;

  const likeCount = raw.like_count || 0;
  const commentCount = raw.comment_count || 0;
  const viewCount = raw.view_count || 0;
  const viralityScore = calculateViralityScore(likeCount, commentCount, viewCount);

  // Detect platform from extractor or use hint
  let sourcePlatform = platformHint || 'instagram';
  const extractor = (raw.extractor || raw.extractor_key || '').toLowerCase();
  if (extractor.includes('youtube')) {
    // YouTube Shorts are < 61 seconds
    const duration = raw.duration || 0;
    sourcePlatform = duration <= 60 ? 'youtube_shorts' : 'youtube';
  } else if (extractor.includes('tiktok')) {
    sourcePlatform = 'tiktok';
  }

  // Build source URL based on platform
  let sourceUrl = raw.webpage_url;
  if (!sourceUrl) {
    if (sourcePlatform === 'youtube' || sourcePlatform === 'youtube_shorts') {
      sourceUrl = `https://www.youtube.com/watch?v=${raw.id}`;
    } else {
      sourceUrl = `https://www.instagram.com/reel/${raw.id}/`;
    }
  }

  return {
    source_platform: sourcePlatform,
    source_id: raw.id,
    source_url: sourceUrl,
    title: raw.title || raw.fulltitle || `Video by ${raw.channel || 'unknown'}`,
    description: description || null,
    creator_username: raw.channel ? raw.channel.toLowerCase() : null,
    creator_name: raw.uploader || null,
    thumbnail_url: raw.thumbnail || null,
    duration_seconds: raw.duration ? Math.round(raw.duration) : 30,
    hook_start_seconds: 0,
    parent_track_id: null,
    parent_track_title: null,
    parent_track_artist: null,
    track_match_confidence: 0.5,
    track_match_method: 'gemini',
    content_type: detectContentType(combinedText),
    vibe_tags: extractHashtags(description),
    cultural_tags: detectCulturalTags(combinedText),
    view_count: viewCount,
    like_count: likeCount,
    share_count: 0,
    comment_count: commentCount,
    voyo_plays: 0,
    voyo_skips: 0,
    voyo_full_song_taps: 0,
    voyo_reactions: 0,
    virality_score: viralityScore,
    conversion_rate: 0,
    heat_score: calculateHeatScore(viralityScore),
    discovered_by: 'siphon',
    verified: false,
    featured: false,
    is_active: true,
  };
}

// Siphon .mp4.json format (post_id, post_shortcode, username, fullname, likes, etc.)
function transformSiphon(raw) {
  const description = raw.description || '';
  const bio = raw.user?.biography || raw.user?.biography_with_entities?.raw_text || '';
  const combinedText = `${raw.title || ''} ${description} ${bio}`;

  const likeCount = raw.likes || 0;
  const commentCount = typeof raw.comments === 'number' ? raw.comments : 0;
  const viewCount = raw.view_count || raw.views || 0;
  const viralityScore = calculateViralityScore(likeCount, commentCount, viewCount);

  // Use post_shortcode as source_id (the Instagram reel code like 'DR9MYydjTVA')
  const sourceId = raw.post_shortcode || raw.shortcode || raw.post_id;

  return {
    source_platform: 'instagram',
    source_id: sourceId,
    source_url: raw.post_url || `https://www.instagram.com/reel/${sourceId}/`,
    title: raw.title || `Video by ${raw.username || 'unknown'}`,
    description: description || null,
    creator_username: raw.username ? raw.username.toLowerCase() : null,
    creator_name: raw.fullname || raw.full_name || null,
    thumbnail_url: raw.display_url || raw.thumbnail || null,
    duration_seconds: raw.duration ? Math.round(raw.duration) : 30,
    hook_start_seconds: 0,
    parent_track_id: null,
    parent_track_title: null,
    parent_track_artist: null,
    track_match_confidence: 0.5,
    track_match_method: 'gemini',
    content_type: detectContentType(combinedText),
    vibe_tags: extractHashtags(description),
    cultural_tags: detectCulturalTags(combinedText),
    view_count: viewCount,
    like_count: likeCount,
    share_count: 0,
    comment_count: commentCount,
    voyo_plays: 0,
    voyo_skips: 0,
    voyo_full_song_taps: 0,
    voyo_reactions: 0,
    virality_score: viralityScore,
    conversion_rate: 0,
    heat_score: calculateHeatScore(viralityScore),
    discovered_by: 'siphon',
    verified: false,
    featured: false,
    is_active: true,
  };
}

// TikTok API .mp4.json format (id, desc, author, stats, music, etc.)
function transformTikTok(raw) {
  const description = raw.desc || raw.description || '';
  const musicTitle = raw.music?.title || '';
  const musicAuthor = raw.music?.authorName || '';
  const combinedText = `${description} ${musicTitle} ${musicAuthor}`;

  // TikTok stats can be numbers or strings
  const stats = raw.stats || {};
  const statsV2 = raw.statsV2 || {};
  const likeCount = parseInt(statsV2.diggCount || stats.diggCount || 0, 10);
  const commentCount = parseInt(statsV2.commentCount || stats.commentCount || 0, 10);
  const viewCount = parseInt(statsV2.playCount || stats.playCount || 0, 10);
  const shareCount = parseInt(statsV2.shareCount || stats.shareCount || 0, 10);
  const viralityScore = calculateViralityScore(likeCount, commentCount, viewCount);

  const authorUsername = raw.author?.uniqueId || raw.user?.uniqueId || null;
  const authorNickname = raw.author?.nickname || raw.user?.nickname || null;

  const sourceId = String(raw.id);
  const duration = raw.video?.duration || raw.music?.duration || raw.duration || 30;

  return {
    source_platform: 'tiktok',
    source_id: sourceId,
    source_url: `https://www.tiktok.com/@${authorUsername || 'user'}/video/${sourceId}`,
    title: description
      ? description.substring(0, 200)
      : `Video by ${authorUsername || 'unknown'}`,
    description: description || null,
    creator_username: authorUsername ? authorUsername.toLowerCase() : null,
    creator_name: authorNickname || null,
    thumbnail_url: (() => {
      const url = raw.video?.cover || raw.video?.originCover || null;
      // TikTok CDN URLs can be very long; truncate to 2000 chars
      return url && url.length > 2000 ? url.substring(0, 2000) : url;
    })(),
    duration_seconds: Math.round(duration),
    hook_start_seconds: 0,
    parent_track_id: null,
    parent_track_title: musicTitle && musicTitle !== 'original sound' ? musicTitle : null,
    parent_track_artist: musicAuthor || null,
    track_match_confidence: 0.5,
    track_match_method: 'gemini',
    content_type: detectContentType(combinedText),
    vibe_tags: extractHashtags(description),
    cultural_tags: detectCulturalTags(combinedText),
    view_count: viewCount,
    like_count: likeCount,
    share_count: shareCount,
    comment_count: commentCount,
    voyo_plays: 0,
    voyo_skips: 0,
    voyo_full_song_taps: 0,
    voyo_reactions: 0,
    virality_score: viralityScore,
    conversion_rate: 0,
    heat_score: calculateHeatScore(viralityScore),
    discovered_by: 'siphon',
    verified: false,
    featured: false,
    is_active: true,
  };
}

// ─── File Discovery ──────────────────────────────────────────────────────────

function findMetadataFiles(dir) {
  const results = [];

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      console.error(`  [WARN] Cannot read directory: ${currentDir} - ${err.message}`);
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.info.json') || entry.name.endsWith('.mp4.json') || entry.name.endsWith('.mp3.json'))) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  VOYO MOMENTS CANONIZER - Multi-Platform (IG + TT + YT)    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  if (DRY_RUN) {
    console.log('  [MODE] DRY RUN - no data will be inserted');
  }
  if (LIMIT < Infinity) {
    console.log(`  [MODE] LIMIT = ${LIMIT} files`);
  }
  console.log(`  [PLATFORMS] ${PLATFORMS.join(', ')}`);
  console.log('');

  // 1. Discover files across all selected platforms
  console.log('  [1/4] Scanning for metadata files (.info.json + .mp4.json + .mp3.json)...');
  const platformFiles = {}; // { platform: [filePaths] }
  let totalFiles = 0;

  for (const platform of PLATFORMS) {
    const dir = PLATFORM_DIRS[platform];
    if (!fs.existsSync(dir)) {
      console.log(`         [${platform.toUpperCase()}] Directory not found: ${dir} - skipping`);
      platformFiles[platform] = [];
      continue;
    }
    const files = findMetadataFiles(dir);
    platformFiles[platform] = files;
    totalFiles += files.length;
    console.log(`         [${platform.toUpperCase()}] Found ${files.length} metadata files in ${dir}`);
  }

  if (totalFiles === 0) {
    console.log('  [DONE] No metadata files found across any platform. Exiting.');
    return;
  }

  // Apply limit across all files
  let allFiles = [];
  for (const platform of PLATFORMS) {
    for (const f of platformFiles[platform]) {
      allFiles.push({ filePath: f, platform });
    }
  }
  if (LIMIT < allFiles.length) {
    allFiles = allFiles.slice(0, LIMIT);
    console.log(`         Limited to ${allFiles.length} files total`);
  }

  // 2. Parse and transform
  console.log('  [2/4] Parsing and transforming...');
  const moments = [];
  const parseErrors = [];
  const platformCounts = {};

  for (const { filePath, platform } of allFiles) {
    try {
      const rawText = fs.readFileSync(filePath, 'utf8');
      const raw = JSON.parse(rawText);

      // All formats need some ID field
      if (!raw.id && !raw.post_shortcode && !raw.post_id) {
        parseErrors.push({ file: filePath, error: 'Missing id/post_shortcode/post_id field' });
        continue;
      }

      const moment = transformToMoment(raw, platform);
      moments.push(moment);
      platformCounts[moment.source_platform] = (platformCounts[moment.source_platform] || 0) + 1;
    } catch (err) {
      parseErrors.push({ file: filePath, error: err.message });
    }
  }

  // Deduplicate by (source_platform, source_id)
  const seenIds = new Map();
  for (const m of moments) {
    const key = `${m.source_platform}::${m.source_id}`;
    const existing = seenIds.get(key);
    // Keep the one with higher virality score
    if (!existing || m.virality_score > existing.virality_score) {
      seenIds.set(key, m);
    }
  }
  const dedupedMoments = [...seenIds.values()];
  const dupeCount = moments.length - dedupedMoments.length;
  moments.length = 0;
  moments.push(...dedupedMoments);

  console.log(`         Parsed: ${moments.length + dupeCount} | Errors: ${parseErrors.length} | Deduped: ${dupeCount} -> ${moments.length} unique`);
  for (const [plat, count] of Object.entries(platformCounts)) {
    console.log(`         [${plat.toUpperCase()}] ${count} moments`);
  }

  if (parseErrors.length > 0 && parseErrors.length <= 20) {
    for (const pe of parseErrors) {
      console.log(`         [ERR] ${path.basename(pe.file)}: ${pe.error}`);
    }
  } else if (parseErrors.length > 20) {
    console.log(`         [ERR] ${parseErrors.length} parse errors (showing first 5):`);
    for (const pe of parseErrors.slice(0, 5)) {
      console.log(`         [ERR] ${path.basename(pe.file)}: ${pe.error}`);
    }
  }

  if (moments.length === 0) {
    console.log('  [DONE] No valid moments to process. Exiting.');
    return;
  }

  // 3. Preview (dry run or first few per platform)
  console.log('');
  console.log('  [3/4] Preview (first 3 moments):');
  const preview = moments.slice(0, 3);
  for (const m of preview) {
    console.log(`         ┌ [${m.source_platform.toUpperCase()}] ${m.source_id}`);
    console.log(`         │ title: ${(m.title || '').substring(0, 80)}`);
    console.log(`         │ creator: @${m.creator_username} (${m.creator_name})`);
    console.log(`         │ duration: ${m.duration_seconds}s | type: ${m.content_type}`);
    console.log(`         │ likes: ${m.like_count.toLocaleString()} | comments: ${m.comment_count.toLocaleString()} | views: ${m.view_count.toLocaleString()}`);
    console.log(`         │ virality: ${m.virality_score.toLocaleString()} | heat: ${m.heat_score}`);
    console.log(`         │ vibe_tags: [${m.vibe_tags.slice(0, 5).join(', ')}${m.vibe_tags.length > 5 ? '...' : ''}]`);
    console.log(`         │ cultural_tags: [${m.cultural_tags.join(', ')}]`);
    if (m.parent_track_title) {
      console.log(`         │ music: ${m.parent_track_title} by ${m.parent_track_artist}`);
    }
    console.log(`         └ url: ${m.source_url}`);
    console.log('');
  }

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would upsert ' + moments.length + ' moments. Exiting without insert.');
    printSummary(moments);
    return;
  }

  // 4. Upsert in batches
  console.log(`  [4/4] Upserting ${moments.length} moments in batches of ${BATCH_SIZE}...`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let successCount = 0;
  let errorCount = 0;
  const upsertErrors = [];

  const totalBatches = Math.ceil(moments.length / BATCH_SIZE);
  for (let i = 0; i < moments.length; i += BATCH_SIZE) {
    const batch = moments.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    try {
      const { data, error } = await supabase
        .from('voyo_moments')
        .upsert(batch, {
          onConflict: 'source_platform,source_id',
          ignoreDuplicates: false,
        })
        .select('source_id');

      if (error) {
        console.error(`         [BATCH ${batchNum}/${totalBatches}] BATCH ERROR: ${error.message} - retrying individually...`);
        // Fallback: try each record individually to isolate the bad one(s)
        let batchOk = 0;
        let batchFail = 0;
        for (const record of batch) {
          try {
            const { data: d2, error: e2 } = await supabase
              .from('voyo_moments')
              .upsert([record], { onConflict: 'source_platform,source_id', ignoreDuplicates: false })
              .select('source_id');
            if (e2) {
              batchFail++;
              if (batchFail <= 3) {
                console.error(`           [SKIP] ${record.source_id}: ${e2.message}`);
              }
            } else {
              batchOk++;
            }
          } catch (innerErr) {
            batchFail++;
          }
        }
        successCount += batchOk;
        errorCount += batchFail;
        console.log(`         [BATCH ${batchNum}/${totalBatches}] Retry: ${batchOk} OK, ${batchFail} failed`);
        if (batchFail > 0) {
          upsertErrors.push({ batch: batchNum, error: `${error.message} (${batchFail} individual failures)` });
        }
      } else {
        const count = data ? data.length : batch.length;
        successCount += count;
        const pct = Math.round(((i + batch.length) / moments.length) * 100);
        console.log(`         [BATCH ${batchNum}/${totalBatches}] ${count} upserted (${pct}% complete)`);
      }
    } catch (err) {
      console.error(`         [BATCH ${batchNum}/${totalBatches}] EXCEPTION: ${err.message}`);
      errorCount += batch.length;
      upsertErrors.push({ batch: batchNum, error: err.message });
    }
  }

  // 5. Final summary
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                        RESULTS                              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Platforms:        ${PLATFORMS.join(', ').padEnd(40)} ║`);
  console.log(`║  Files scanned:    ${String(allFiles.length).padStart(8)}                                  ║`);
  console.log(`║  Parse errors:     ${String(parseErrors.length).padStart(8)}                                  ║`);
  console.log(`║  Moments prepared: ${String(moments.length).padStart(8)}                                  ║`);
  console.log(`║  Upserted OK:      ${String(successCount).padStart(8)}                                  ║`);
  console.log(`║  Upsert errors:    ${String(errorCount).padStart(8)}                                  ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (upsertErrors.length > 0) {
    console.log('');
    console.log('  Upsert error details:');
    for (const ue of upsertErrors) {
      console.log(`    Batch ${ue.batch}: ${ue.error}`);
    }
  }

  printSummary(moments);
}

function printSummary(moments) {
  // Platform distribution
  const platformCount = {};
  for (const m of moments) {
    platformCount[m.source_platform] = (platformCount[m.source_platform] || 0) + 1;
  }

  console.log('');
  console.log('  Platform distribution:');
  const sortedPlatforms = Object.entries(platformCount).sort((a, b) => b[1] - a[1]);
  for (const [platform, count] of sortedPlatforms) {
    const bar = '█'.repeat(Math.min(30, Math.round((count / moments.length) * 30)));
    console.log(`    ${platform.padEnd(16)} ${bar} ${count}`);
  }

  // Content type distribution
  const typeCount = {};
  for (const m of moments) {
    typeCount[m.content_type] = (typeCount[m.content_type] || 0) + 1;
  }

  // Cultural tag distribution
  const cultureCount = {};
  for (const m of moments) {
    for (const tag of m.cultural_tags) {
      cultureCount[tag] = (cultureCount[tag] || 0) + 1;
    }
  }

  console.log('');
  console.log('  Content type distribution:');
  const sortedTypes = Object.entries(typeCount).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    const bar = '█'.repeat(Math.min(30, Math.round((count / moments.length) * 30)));
    console.log(`    ${type.padEnd(12)} ${bar} ${count}`);
  }

  if (Object.keys(cultureCount).length > 0) {
    console.log('');
    console.log('  Cultural tag distribution:');
    const sortedCulture = Object.entries(cultureCount).sort((a, b) => b[1] - a[1]);
    for (const [tag, count] of sortedCulture.slice(0, 15)) {
      const bar = '█'.repeat(Math.min(20, Math.round((count / moments.length) * 20)));
      console.log(`    ${tag.padEnd(16)} ${bar} ${count}`);
    }
  }

  // Top moments by virality
  console.log('');
  console.log('  Top 5 moments by virality:');
  const topMoments = [...moments].sort((a, b) => b.virality_score - a.virality_score).slice(0, 5);
  for (let i = 0; i < topMoments.length; i++) {
    const m = topMoments[i];
    console.log(`    ${i + 1}. @${m.creator_username} - ${m.title.substring(0, 40)} (virality: ${m.virality_score.toLocaleString()}, heat: ${m.heat_score})`);
  }

  console.log('');
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

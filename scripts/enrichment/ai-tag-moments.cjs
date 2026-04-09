#!/usr/bin/env node
/**
 * VOYO MOMENTS AI CULTURAL TAGGING v1.0
 *
 * Uses Gemini 2.0 Flash to infer cultural_tags for moments that don't have them.
 * Analyzes creator_name, creator_username, description, title, vibe_tags, content_type
 * to determine country and region of origin.
 *
 * Usage:
 *   node scripts/enrichment/ai-tag-moments.cjs                    # Run all
 *   node scripts/enrichment/ai-tag-moments.cjs --limit=100        # Process 100 moments
 *   node scripts/enrichment/ai-tag-moments.cjs --dry-run          # Preview without updating
 *   node scripts/enrichment/ai-tag-moments.cjs --dry-run --limit=20  # Preview 20
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIG
// ============================================

const SUPABASE_HOST = 'anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

const GEMINI_API_KEY = 'AIzaSyD7x2ITG1TiyVkKBag7ETb0Vd-zNG7RRoE';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_HOST = 'generativelanguage.googleapis.com';

const LOG_FILE = path.join(__dirname, 'ai-tag.log');
const PROGRESS_FILE = path.join(__dirname, 'ai-tag-progress.json');

// Parse CLI args
const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const LIMIT = parseInt(ARGS.find(a => a.startsWith('--limit='))?.split('=')[1]) || 0;

// Batch sizes
const FETCH_BATCH = 100;     // How many moments to fetch from Supabase at a time
const GEMINI_BATCH = 20;     // How many moments per Gemini API call
const GEMINI_DELAY_MS = 1200; // Delay between Gemini calls (free tier: ~15 RPM)
const UPDATE_CONCURRENCY = 10; // Parallel Supabase updates

// ============================================
// LOGGING
// ============================================

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ============================================
// HTTP HELPERS
// ============================================

function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Request timeout (60s)'));
    });
    if (body) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(bodyStr);
    }
    req.end();
  });
}

// ============================================
// SUPABASE HELPERS
// ============================================

async function supabaseGet(queryPath) {
  const res = await httpsRequest({
    hostname: SUPABASE_HOST,
    path: `/rest/v1/${queryPath}`,
    method: 'GET',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'count=exact',
    },
  });

  if (res.status >= 400) {
    throw new Error(`Supabase GET ${res.status}: ${res.data.slice(0, 300)}`);
  }

  const count = res.headers['content-range']?.split('/')[1];
  return {
    data: JSON.parse(res.data),
    totalCount: count ? parseInt(count) : null,
  };
}

async function supabasePatch(queryPath, body) {
  const res = await httpsRequest({
    hostname: SUPABASE_HOST,
    path: `/rest/v1/${queryPath}`,
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
  }, body);

  if (res.status >= 400) {
    throw new Error(`Supabase PATCH ${res.status}: ${res.data.slice(0, 300)}`);
  }
  return res;
}

// ============================================
// GEMINI HELPER
// ============================================

async function callGemini(prompt, retryCount = 0) {
  const body = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  };

  const res = await httpsRequest({
    hostname: GEMINI_HOST,
    path: `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  }, body);

  if (res.status === 429 || res.status >= 500) {
    if (retryCount < 2) {
      const waitMs = (retryCount + 1) * 5000;
      log(`  Gemini ${res.status}, retrying in ${waitMs / 1000}s (attempt ${retryCount + 1})...`);
      await sleep(waitMs);
      return callGemini(prompt, retryCount + 1);
    }
    throw new Error(`Gemini API ${res.status} after ${retryCount + 1} attempts: ${res.data.slice(0, 300)}`);
  }

  if (res.status >= 400) {
    throw new Error(`Gemini API ${res.status}: ${res.data.slice(0, 300)}`);
  }

  const parsed = JSON.parse(res.data);
  const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned empty response');
  }

  // Parse JSON from response — handle potential markdown wrapping
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Failed to parse Gemini JSON: ${cleaned.slice(0, 300)}`);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================
// BUILD GEMINI PROMPT
// ============================================

function buildPrompt(moments) {
  const momentLines = moments.map((m, i) => {
    const parts = [`${i + 1}. ID: ${m.id}`];
    if (m.creator_username) parts.push(`Creator: @${m.creator_username}`);
    if (m.creator_name) parts.push(`Name: "${m.creator_name}"`);
    if (m.title && m.title !== `Video by ${m.creator_username}`) parts.push(`Title: "${m.title}"`);
    if (m.description) parts.push(`Desc: "${m.description.slice(0, 200)}"`);
    if (m.vibe_tags && m.vibe_tags.length > 0) parts.push(`Tags: ${m.vibe_tags.slice(0, 10).join(', ')}`);
    if (m.content_type) parts.push(`Type: ${m.content_type}`);
    return parts.join(' | ');
  }).join('\n');

  return `You are a cultural classification expert for African and diaspora music/dance content from social media.

Given these social media moment metadata, infer the most likely country and region for each.

RULES:
- Only tag if you have REASONABLE confidence from the signals (name patterns, language, hashtags, description content)
- If no clear signal exists, return empty tags array for that moment
- Use ONLY these valid values:

Countries: nigeria, ghana, kenya, south-africa, senegal, algeria, guinea, ivory-coast, congo, cameroon, tanzania, ethiopia, uganda, mali, benin, togo, burkina-faso, madagascar, mozambique, angola, uk, usa, france, jamaica, brazil, portugal
Regions: west-africa, east-africa, southern-africa, central-africa, north-africa, diaspora, caribbean, lusophone-africa

SIGNALS TO USE:
- Nigerian names (Adeola, Chioma, Obi, Emeka...), Ghanaian (Kwame, Kofi, Ama...), Kenyan (Wanjiku, Kamau...), etc.
- Hashtags: #naija=Nigeria, #amapiano=South Africa, #gengetone=Kenya, #azonto=Ghana, #afrobeats=Nigeria (usually), #coupe-decale=Ivory Coast, #mbalax=Senegal, #bongo=Tanzania, #ndombolo=Congo
- Language: Yoruba/Pidgin=Nigeria, Twi=Ghana, Swahili=Kenya/Tanzania, Wolof=Senegal, Portuguese=Angola/Mozambique, French=Francophone Africa
- Location mentions in description (Lagos, Accra, Nairobi, Dakar, Johannesburg, etc.)
- "Ug" suffix in names often = Uganda
- Brazilian/Portuguese creator names with African dance content = brazil or lusophone-africa

Return a JSON array with EXACTLY ${moments.length} items (one per moment, in order):
[{ "id": "moment-uuid", "tags": ["country", "region"] }, ...]

If no confident inference, return: { "id": "moment-uuid", "tags": [] }

MOMENTS:
${momentLines}`;
}

// ============================================
// PROGRESS TRACKING
// ============================================

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    } catch {
      return { processed: 0, tagged: 0, skipped: 0, errors: 0, lastOffset: 0 };
    }
  }
  return { processed: 0, tagged: 0, skipped: 0, errors: 0, lastOffset: 0 };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ============================================
// MAIN
// ============================================

async function main() {
  log('============================================');
  log('VOYO MOMENTS AI CULTURAL TAGGING v1.0');
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  log(`Limit: ${LIMIT || 'ALL'}`);
  log('============================================');

  // Get total count
  const { totalCount } = await supabaseGet(
    'voyo_moments?select=id&cultural_tags=eq.%7B%7D&limit=1'
  );
  log(`Total moments needing tags: ${totalCount}`);

  const effectiveLimit = LIMIT > 0 ? Math.min(LIMIT, totalCount) : totalCount;
  log(`Will process: ${effectiveLimit} moments`);
  log(`Gemini batches: ~${Math.ceil(effectiveLimit / GEMINI_BATCH)} calls`);
  log(`Estimated time: ~${Math.ceil(effectiveLimit / GEMINI_BATCH * GEMINI_DELAY_MS / 1000 / 60)} minutes`);
  log('');

  let totalProcessed = 0;
  let totalTagged = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let fetchOffset = 0;

  while (totalProcessed < effectiveLimit) {
    // Fetch a batch of untagged moments
    const remaining = effectiveLimit - totalProcessed;
    const fetchSize = Math.min(FETCH_BATCH, remaining);

    log(`--- Fetching batch at offset ${fetchOffset} (${fetchSize} moments) ---`);

    const { data: moments } = await supabaseGet(
      `voyo_moments?select=id,creator_username,creator_name,description,title,vibe_tags,content_type&cultural_tags=eq.%7B%7D&limit=${fetchSize}&offset=${fetchOffset}`
    );

    if (moments.length === 0) {
      log('No more untagged moments found. Done.');
      break;
    }

    log(`Fetched ${moments.length} moments`);

    // Process in Gemini-sized batches
    for (let i = 0; i < moments.length; i += GEMINI_BATCH) {
      const geminiBatch = moments.slice(i, i + GEMINI_BATCH);
      const batchNum = Math.floor((totalProcessed + i) / GEMINI_BATCH) + 1;

      log(`  Gemini batch ${batchNum}: ${geminiBatch.length} moments...`);

      let results;
      try {
        const prompt = buildPrompt(geminiBatch);
        results = await callGemini(prompt);
      } catch (err) {
        log(`  ERROR in Gemini call: ${err.message}`);
        totalErrors += geminiBatch.length;
        totalProcessed += geminiBatch.length;
        // On Gemini error, skip this batch but keep offset moving
        // Since we query with offset, and these aren't updated, we need to
        // advance the offset to avoid re-fetching the same ones
        fetchOffset += geminiBatch.length;
        await sleep(GEMINI_DELAY_MS);
        continue;
      }

      if (!Array.isArray(results)) {
        log(`  ERROR: Gemini returned non-array: ${JSON.stringify(results).slice(0, 200)}`);
        totalErrors += geminiBatch.length;
        totalProcessed += geminiBatch.length;
        fetchOffset += geminiBatch.length;
        await sleep(GEMINI_DELAY_MS);
        continue;
      }

      // Build a map of results by ID for reliable matching
      const resultMap = {};
      for (const r of results) {
        if (r && r.id) {
          resultMap[r.id] = r.tags || [];
        }
      }

      // Also handle index-based matching if IDs don't match (Gemini sometimes truncates UUIDs)
      const updatesToApply = [];
      for (let j = 0; j < geminiBatch.length; j++) {
        const moment = geminiBatch[j];
        let tags = resultMap[moment.id];

        // Fallback: match by index if ID lookup fails
        if (!tags && results[j]) {
          tags = results[j].tags || [];
        }

        if (tags && tags.length > 0) {
          // Validate tags — only allow known values
          const validTags = tags.filter(t => isValidTag(t));
          if (validTags.length > 0) {
            updatesToApply.push({ id: moment.id, cultural_tags: validTags });
          } else {
            totalSkipped++;
          }
        } else {
          totalSkipped++;
        }
      }

      // Apply updates to Supabase
      if (updatesToApply.length > 0) {
        if (DRY_RUN) {
          for (const u of updatesToApply) {
            const m = geminiBatch.find(m => m.id === u.id);
            log(`    [DRY] ${m?.creator_username || 'unknown'} => ${JSON.stringify(u.cultural_tags)}`);
          }
          totalTagged += updatesToApply.length;
        } else {
          // Update in parallel with concurrency limit
          for (let k = 0; k < updatesToApply.length; k += UPDATE_CONCURRENCY) {
            const updateBatch = updatesToApply.slice(k, k + UPDATE_CONCURRENCY);
            const updateResults = await Promise.all(
              updateBatch.map(async (u) => {
                try {
                  await supabasePatch(
                    `voyo_moments?id=eq.${u.id}`,
                    { cultural_tags: u.cultural_tags }
                  );
                  return true;
                } catch (err) {
                  log(`    Update error for ${u.id}: ${err.message}`);
                  return false;
                }
              })
            );
            const succeeded = updateResults.filter(Boolean).length;
            totalTagged += succeeded;
            totalErrors += updateResults.length - succeeded;
          }
        }
        log(`    Tagged: ${updatesToApply.length}, Skipped (no signal): ${geminiBatch.length - updatesToApply.length}`);
      } else {
        log(`    No tags inferred for this batch`);
      }

      totalProcessed += geminiBatch.length;

      // If not dry run, we don't advance offset because tagged moments
      // won't appear in the next query (they now have cultural_tags).
      // Only advance offset for moments that were NOT tagged.
      if (!DRY_RUN) {
        fetchOffset += (geminiBatch.length - updatesToApply.length);
      } else {
        // In dry run, nothing changes in DB so we must advance offset
        fetchOffset += geminiBatch.length;
      }

      // Rate limit Gemini
      await sleep(GEMINI_DELAY_MS);
    }

    // Log running totals
    log(`  Progress: ${totalProcessed}/${effectiveLimit} processed, ${totalTagged} tagged, ${totalSkipped} skipped, ${totalErrors} errors`);
  }

  // Final report
  log('');
  log('============================================');
  log('AI TAGGING COMPLETE');
  log('============================================');
  log(`Total processed:  ${totalProcessed}`);
  log(`Total tagged:     ${totalTagged}`);
  log(`Total skipped:    ${totalSkipped} (no clear cultural signal)`);
  log(`Total errors:     ${totalErrors}`);
  log(`Tag rate:         ${totalProcessed > 0 ? ((totalTagged / totalProcessed) * 100).toFixed(1) : 0}%`);
  log('============================================');

  // Save final stats
  saveProgress({
    completed: new Date().toISOString(),
    processed: totalProcessed,
    tagged: totalTagged,
    skipped: totalSkipped,
    errors: totalErrors,
    dryRun: DRY_RUN,
  });
}

// ============================================
// TAG VALIDATION
// ============================================

const VALID_COUNTRIES = new Set([
  'nigeria', 'ghana', 'kenya', 'south-africa', 'senegal', 'algeria',
  'guinea', 'ivory-coast', 'congo', 'cameroon', 'tanzania', 'ethiopia',
  'uganda', 'mali', 'benin', 'togo', 'burkina-faso', 'madagascar',
  'mozambique', 'angola', 'uk', 'usa', 'france', 'jamaica', 'brazil',
  'portugal', 'south africa', 'ivory coast', 'burkina faso',
]);

const VALID_REGIONS = new Set([
  'west-africa', 'east-africa', 'southern-africa', 'central-africa',
  'north-africa', 'diaspora', 'caribbean', 'lusophone-africa',
]);

function isValidTag(tag) {
  if (!tag || typeof tag !== 'string') return false;
  const normalized = tag.toLowerCase().trim();
  return VALID_COUNTRIES.has(normalized) || VALID_REGIONS.has(normalized);
}

// ============================================
// RUN
// ============================================

main().catch(err => {
  log(`FATAL ERROR: ${err.message}`);
  console.error(err);
  process.exit(1);
});

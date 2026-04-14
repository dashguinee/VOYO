/**
 * Generate VOYO icon set via Imagen 3 (Gemini API).
 * Run: node scripts/generate-voyo-icons.cjs
 *
 * Produces glossy 3D icons with VOYO DNA:
 *  - Bronze-gold (#C9A96C) + amethyst purple (#8B5CF6) palette
 *  - Premium glossy/metallic finish
 *  - African textile / kente-pattern hint where appropriate
 *  - Transparent or near-black background
 *  - 1024x1024 PNG, saved to public/icons/
 */

const fs = require('fs');
const path = require('path');

const KEY = require('dotenv').config({ path: path.join(__dirname, '..', '.env') }).parsed.VITE_GEMINI_API_KEY;
if (!KEY) { console.error('No VITE_GEMINI_API_KEY found in .env'); process.exit(1); }

const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Shared style preamble — applied to every prompt for visual consistency.
const STYLE = [
  'Premium 3D rendered icon, glossy reflective surface,',
  'metallic bronze-gold (#C9A96C, #E8D09E) and deep amethyst purple (#8B5CF6, #6B46C1) gradient palette,',
  'subtle inner glow, soft volumetric lighting, octane-render quality,',
  'thin geometric African textile pattern detail (kente / mudcloth lines) carved into the bronze surface,',
  'centered composition, minimal background (very dark warm-amber #0B0703 or transparent),',
  'sharp focused subject filling 75% of frame, professional product-icon aesthetic,',
  'no text, no letters, no words, just the symbol.',
].join(' ');

const ICONS = [
  {
    name: 'music-note',
    prompt: `${STYLE} A single elegant musical note (eighth note) sculpted in glossy bronze-gold metal with amethyst purple highlights along the edges. The note flag has a subtle kente-pattern micro-texture.`,
  },
  {
    name: 'vinyl-disc',
    prompt: `${STYLE} A glossy vinyl record viewed from a slight angle, deep black grooves catching warm bronze-gold reflections, the center label is amethyst purple with a small embossed star. Reflective surface like wet vinyl under stage lights.`,
  },
  {
    name: 'radio-vibes',
    prompt: `${STYLE} Three concentric radio-wave arcs radiating outward from a small bronze-gold orb, the arcs blend from bronze (inner) to amethyst purple (outer), each arc has a soft glow. Premium broadcast / radio symbol.`,
  },
  {
    name: 'compass-disco',
    prompt: `${STYLE} An ornate compass-rose with eight cardinal points, sculpted in bronze-gold metal, central gem is amethyst purple. The compass has tiny African geometric carvings around the rim. Premium navigation / Disco symbol.`,
  },
  {
    name: 'heart-like',
    prompt: `${STYLE} A 3D rounded heart sculpted in bronze-gold with a glossy lacquered finish, tiny amethyst purple dot at the center top, soft inner glow making it feel warm. Slight liquid / molten quality.`,
  },
  {
    name: 'sparkle-smart',
    prompt: `${STYLE} A four-pointed sparkle / star burst, bronze-gold rays with amethyst purple core, twinkling jewel-like quality, soft chromatic aberration on the points. Premium "smart" / AI / magic symbol.`,
  },
  {
    name: 'orb-artist',
    prompt: `${STYLE} A polished spherical orb, bronze-gold lower hemisphere transitioning to amethyst purple upper hemisphere with a clear horizon line. Tiny kente-pattern dust ring around the equator. Represents an artist / persona.`,
  },
  {
    name: 'bucket-queue',
    prompt: `${STYLE} A modern minimalist bucket / vessel viewed from the front, bronze-gold metallic body with amethyst purple inside catching light, three musical notes floating just above the rim. Premium "queue" symbol.`,
  },
];

async function generateOne(icon) {
  console.log(`→ Generating: ${icon.name}`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${KEY}`;
  const body = {
    instances: [{ prompt: icon.prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: '1:1',
      personGeneration: 'dont_allow',
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`  ✗ HTTP ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) {
    console.error(`  ✗ No image bytes in response: ${JSON.stringify(data).slice(0, 200)}`);
    return null;
  }
  const outPath = path.join(OUT_DIR, `${icon.name}.png`);
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`  ✓ Saved ${outPath} (${kb}KB)`);
  return outPath;
}

(async () => {
  console.log(`Generating ${ICONS.length} VOYO icons → ${OUT_DIR}\n`);
  const results = [];
  // Sequential to avoid Imagen rate limits
  for (const icon of ICONS) {
    const p = await generateOne(icon);
    results.push({ name: icon.name, path: p });
    await new Promise(r => setTimeout(r, 1000)); // 1s pacing
  }
  console.log('\n=== Summary ===');
  results.forEach(r => console.log(`  ${r.path ? '✓' : '✗'} ${r.name}`));
})();

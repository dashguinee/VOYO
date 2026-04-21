/**
 * Generate 4 VOYO vibe art pieces via Gemini (Imagen 3).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const envText = fs.readFileSync('/home/dash/voyo-music/.env', 'utf8');
const apiKey = (envText.match(/^VITE_GEMINI_API_KEY=(.+)$/m) || [])[1];
if (!apiKey) { console.error('no key'); process.exit(1); }

const VIBES = [
  { id: 'chill',      prompt: 'Afro-futurist editorial portrait of a serene young Black woman wearing a luminous iridescent headwrap woven with soft fiber-optic thread, bronze-gold catch-lights on her skin, deep amethyst and indigo shadows, dreamy cinematic bokeh, calm contemplative expression, premium magazine aesthetic, no brand text, vertical 9:16 composition, rich warm film grain' },
  { id: 'party',      prompt: 'Afro-futurist editorial portrait of a young Black dancer mid-motion under bronze-gold spotlights, flowing metallic garment with Kente-inspired geometric panels, streaks of amber confetti light, deep amethyst atmospheric haze, dynamic joyful energy, premium editorial poster, no brand text, vertical 9:16 composition' },
  { id: 'late-night', prompt: 'Afro-futurist editorial portrait of a young Black figure in a sleek asymmetric jacket against deep violet night fog, warm amber rim-light from the side, mysterious and cinematic, quiet confident posture, noir premium editorial aesthetic, bronze-gold accents, no brand text, vertical 9:16 composition' },
  { id: 'workout',    prompt: 'Afro-futurist editorial portrait of a powerful young Black athlete in motion, bronze-gold body highlights against deep amethyst, woven kinetic fabric with Kente-inspired geometric power lines radiating outward, strong determined expression, premium athletic editorial aesthetic, no brand text, vertical 9:16 composition' },
];

function gemImagen(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '9:16' },
    });
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data.slice(0, 500) }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  const outDir = '/home/dash/voyo-music/public/vibes';
  for (const v of VIBES) {
    console.log(`[${v.id}] generating via imagen-3.0...`);
    const resp = await gemImagen(v.prompt);
    if (resp.status !== 200) {
      console.error(`[${v.id}] HTTP ${resp.status}:`, JSON.stringify(resp.body).slice(0, 400));
      continue;
    }
    const b64 = resp.body?.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) {
      console.error(`[${v.id}] no image bytes:`, JSON.stringify(resp.body).slice(0, 400));
      continue;
    }
    const dest = path.join(outDir, `ai-${v.id}.png`);
    fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
    console.log(`[${v.id}] saved ${dest} (${Math.round(fs.statSync(dest).size / 1024)}K)`);
  }
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });

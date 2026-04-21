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
  { id: 'chill',      prompt: 'Warm amber dusk over an empty African savanna, silhouettes of baobab trees against a deep violet twilight sky, soft bronze-gold light, dreamy cinematic bokeh, film-grain texture, rich warm tones, premium editorial aesthetic, no people, vertical composition, Afro-futurist mood, calm and contemplative' },
  { id: 'party',      prompt: 'Vibrant Afro-futurist dance energy in rich bronze-gold and amethyst purple, abstract geometric Adinkra-inspired symbols radiating outward, warm confetti-like sparks of amber light, deep velvet background, dynamic motion blur, premium editorial poster, no people, vertical composition, joyful kinetic energy' },
  { id: 'late-night', prompt: 'Lagos skyline at 3am, deep violet cinematic sky, warm amber window lights in the distance, ethereal fog rolling between buildings, mysterious and cinematic, Afro-futurist noir mood, premium editorial photography aesthetic, no people, vertical composition, bronze-gold highlights' },
  { id: 'workout',    prompt: 'Bold Afro-futurist kinetic energy pattern, deep amethyst violet and electric bronze-gold, radiating geometric power lines remixed from West African Kente cloth patterns, premium athletic poster aesthetic, abstract no people, vertical composition, strong dynamic motion, powerful' },
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

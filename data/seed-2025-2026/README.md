# VOYO seed catalog — 2025-2026 Black + African music injection

Curated research output from 4 parallel agents, 2026-04-19.

## Files

- `afrobeats-amapiano-francophone.json` — 126 tracks (Burna Boy, Wizkid, Tyla, Uncle Waffles, Aya Nakamura, Damso, Grand P, Sidiki Diabaté, etc.)
- `black-us-hiphop-rnb.json` — 160 tracks (Kendrick, Drake, SZA, Doechii, Mac Miller, Playboi Carti, Beyoncé, etc.)
- `caribbean-latin-brazilian.json` — 80 tracks (Bad Bunny, Karol G, Shenseea, Anitta, Rosalía, Rutshelle Guillaume, etc.)
- `francophone-gospel-guinea-east-diaspora.json` — 124 tracks (Fally Ipupa, Mercy Chinwo, Grand P, Diamond Platnumz, Stormzy, etc.)
- `all-consolidated.json` — merged, deduped-by-(artist+title) → **478 unique tracks** (43% arrive with a candidate `youtube_id`, rest are empty — resolver fills them all)

## Critical ingest caveat

**The `youtube_id` field in these files is UNVALIDATED.** Agents admitted IDs may be wrong or hallucinated. Expect 15-40% invalidation rate.

Before queueing for extraction, run `scripts/resolve-seed-ids.sh` — it uses yt-dlp ytsearch on the VPS to find the real canonical YouTube ID for each track based on `artist + title`. Then upserts into `voyo_upload_queue` for Tier-A extraction.

## Ingest flow

```
all-consolidated.json
   ↓ (resolve-seed-ids.sh — ytsearch on VPS for each entry)
voyo_upload_queue rows with real youtube_id
   ↓ (GH Actions worker picks up, or VPS Tier A on demand)
R2 voyo-audio bucket
   ↓ (users play, instant hit)
✓
```

At ~6 MB average per track × 478 tracks = ~2.9 GB R2 storage (~$0.04/month). Extraction bandwidth via Tier A = $0.

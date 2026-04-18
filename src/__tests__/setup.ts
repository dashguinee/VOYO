// Vitest setup — runs before every test file.
// Stubs browser globals that our modules reach for but aren't present in
// jsdom by default. Add more as needed.

import { vi } from 'vitest';

// supabase + telemetry — don't actually hit network in tests.
vi.mock('../services/telemetry', () => ({
  trace: vi.fn(),
  logPlaybackEvent: vi.fn(),
}));

// api.ts — return empty R2 by default.
vi.mock('../services/api', () => ({
  checkR2Cache: vi.fn(async () => ({ exists: false, url: null, hasHigh: false, hasLow: false, quality: null })),
}));

// trackBlocklist — tests can selectively override
vi.mock('../services/trackBlocklist', () => ({
  isBlocked: vi.fn(() => false),
  markBlocked: vi.fn(),
}));

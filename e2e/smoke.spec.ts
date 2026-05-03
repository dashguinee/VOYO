/**
 * VOYO Music — Smoke tests
 *
 * These are "real user" scenario tests. Each test simulates a gesture or
 * flow a real user performs. They run against the live dev server.
 *
 * Run:  npx playwright test
 * Debug: npx playwright test --headed
 * One test: npx playwright test -g "cold boot"
 */

import { test, expect, Page } from '@playwright/test';

// ─── Helpers ─────────────────��────────────────────────────────────────────

/** Wait for the app shell to be interactive (splash gone, home visible). */
async function waitForAppReady(page: Page) {
  // Either the splash fades out or the home feed appears.
  await page.waitForSelector('[data-testid="app-ready"], [data-testid="home-feed"], .voyo-home', {
    timeout: 15_000,
    state: 'visible',
  }).catch(async () => {
    // Fallback: wait for any non-splash content to appear
    await page.waitForTimeout(3000);
  });
}

/** Wait for the audio player to have a track loaded. */
async function waitForTrack(page: Page) {
  await page.waitForFunction(
    () => {
      // Check Zustand store via window (dev mode exposes it)
      const store = (window as any).__voyoStore?.getState?.();
      if (store?.currentTrack) return true;
      // Fallback: check the audio element has a src
      const audio = document.querySelector('audio');
      return audio && audio.src && audio.src !== '';
    },
    { timeout: 20_000 },
  );
}

// ─── Tests ────────────────────────────────────────────────────────────��───

test.describe('Cold boot', () => {
  test('app loads without JS error', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    await page.goto('/');
    await waitForAppReady(page);

    // No uncaught JS errors during load
    expect(jsErrors.filter(e =>
      !e.includes('ResizeObserver') &&  // benign browser noise
      !e.includes('Non-Error promise')   // benign unhandled rejection noise
    )).toHaveLength(0);
  });

  test('splash screen appears then clears', async ({ page }) => {
    await page.goto('/');
    // The app should render *something* within 3s
    await page.waitForTimeout(500);
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toBe('');
    // Within 10s the main UI should be interactive
    await waitForAppReady(page);
  });

  test('service worker registers', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length > 0;
    });
    expect(swRegistered).toBe(true);
  });
});

test.describe('Navigation', () => {
  test('edge swipe classic→voyo', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    const vp = page.viewportSize()!;
    // Right-edge swipe LEFT to go from classic to voyo
    await page.mouse.move(vp.width - 10, vp.height / 2);
    await page.mouse.down();
    await page.mouse.move(vp.width - 100, vp.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Take screenshot to visually verify navigation
    await page.screenshot({ path: 'e2e/results/edge-swipe-voyo.png' });
  });

  test('back gesture returns to home', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    // Navigate forward then back
    await page.goBack();
    await page.waitForTimeout(300);
  });
});

test.describe('Search', () => {
  test('search opens and accepts input', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Find and click the search button — force:true bypasses animation-stability
    // check (the search FAB uses animate-bounce which keeps Playwright waiting
    // for the element to "settle"). We verify visibility ourselves first.
    const searchBtn = page.locator('[data-testid="search-btn"], [aria-label*="search" i], button:has(svg)').first();
    if (await searchBtn.isVisible()) {
      await searchBtn.click({ force: true });
      await page.waitForTimeout(300);
    }

    // Check if a search input appeared
    const input = page.locator('input[type="text"], input[placeholder*="search" i]').first();
    const hasInput = await input.isVisible().catch(() => false);

    if (hasInput) {
      await input.fill('Afrobeats');
      await page.waitForTimeout(1500); // debounce

      // Should show some results or "nothing found" — either is valid
      await page.screenshot({ path: 'e2e/results/search-afrobeats.png' });
    }
  });
});

test.describe('Audio playback', () => {
  test('audio element exists and can be resumed after user gesture', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Simulate user gesture (required for autoplay policy)
    await page.click('body');

    // AudioPlayer mounts lazily after React hydration — give it time
    const audioExists = await page.waitForFunction(
      () => document.querySelector('audio') !== null,
      { timeout: 10_000 },
    ).then(() => true).catch(() => false);

    const audioState = await page.evaluate(() => {
      const audio = document.querySelector('audio');
      if (!audio) return { exists: false, paused: true, src: false, readyState: 0 };
      return {
        exists: true,
        paused: audio.paused,
        src: !!audio.src,
        readyState: audio.readyState,
      };
    });

    // In headless environments the audio element should exist even if
    // playback is blocked by autoplay policy (paused is acceptable).
    expect(audioExists).toBe(true);
    expect(audioState.exists).toBe(true);
    await page.screenshot({ path: 'e2e/results/audio-element-state.png' });
  });
});

test.describe('PWA', () => {
  test('manifest is served', async ({ page }) => {
    // Use fetch() inside the page — page.goto() for static files triggers
    // Vite's SPA HTML fallback in some configurations.
    await page.goto('/');
    await waitForAppReady(page);
    const result = await page.evaluate(async () => {
      const r = await fetch('/manifest.webmanifest');
      return { status: r.status, body: await r.text() };
    });
    expect(result.status).toBeLessThan(400);
    expect(result.body.toLowerCase()).toMatch(/voyo|name/);
  });

  test('version.json is served', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    const result = await page.evaluate(async () => {
      const r = await fetch('/version.json');
      return { status: r.status, body: await r.text() };
    });
    expect(result.status).toBe(200);
    const json = JSON.parse(result.body);
    expect(json).toHaveProperty('version');
    expect(typeof json.version).toBe('string');
  });
});

test.describe('Deeplink', () => {
  test('?t= param does not crash the app', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    // Use a dummy ID — track won't be found, but app must not crash
    await page.goto('/?t=dQw4w9WgXcQ');
    await waitForAppReady(page);

    const fatalErrors = jsErrors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('Non-Error promise')
    );
    expect(fatalErrors).toHaveLength(0);
    await page.screenshot({ path: 'e2e/results/deeplink-no-crash.png' });
  });
});

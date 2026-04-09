#!/usr/bin/env python3
"""
VOYO Database Feeder Script
Populates the collective brain with African music

Run this when the app has been idle for at least 60 seconds
to avoid rate limit issues.

Usage:
  python3 scripts/feed-database.py [--full] [--test]

Options:
  --full   Run the full 60+ query build (takes ~5 minutes)
  --test   Just run a single test search
"""

from playwright.sync_api import sync_playwright
import time
import sys
import json

def check_rate_limit():
    """Check if VOYO API is rate limited"""
    import urllib.request
    try:
        req = urllib.request.Request(
            'https://voyo-music-api.fly.dev/api/search?q=test&limit=1',
            headers={'User-Agent': 'VOYO-Feeder/1.0'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            if 'error' in data:
                return data.get('retryAfter', 60)
            return 0
    except Exception as e:
        print(f"Rate limit check failed: {e}")
        return 30

def run_feeder(mode='test'):
    print("=" * 60)
    print("VOYO DATABASE FEEDER")
    print("=" * 60)
    print(f"Mode: {mode}")
    print()

    # Check rate limit first
    print("[1/5] Checking API rate limit...")
    retry_after = check_rate_limit()
    if retry_after > 0:
        print(f"      Rate limited! Waiting {retry_after}s...")
        time.sleep(retry_after + 5)
        print("      Rate limit should be reset now!")
    else:
        print("      API is available!")

    fed_total = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        def handle_console(msg):
            if '[Feeder]' in msg.text:
                print(f"  {msg.text}")

        page.on('console', handle_console)

        # Navigate to VOYO
        print("[2/5] Navigating to VOYO...")
        page.goto('http://localhost:5173', timeout=60000)
        page.wait_for_load_state('domcontentloaded')
        print("      VOYO loaded!")

        # Wait for app to settle
        print("[3/5] Waiting for app to settle (10s)...")
        time.sleep(10)

        # Check feedDatabase is available
        print("[4/5] Checking feedDatabase...")
        has_feeder = page.evaluate('typeof window.feedDatabase !== "undefined"')
        if not has_feeder:
            print("      ERROR: window.feedDatabase not found!")
            browser.close()
            return 0

        print("      feedDatabase available!")

        # Run the appropriate function
        print("[5/5] Running feeder...")
        print()

        if mode == 'test':
            result = page.evaluate('''
                (async () => {
                    const fed = await window.feedDatabase.search('Burna Boy', 5);
                    return { fed };
                })()
            ''')
            fed_total = result.get('fed', 0)
            print(f"Test search: {fed_total} tracks fed")

        elif mode == 'full':
            print("Running full build (this takes ~5 minutes)...")
            print("-" * 60)
            result = page.evaluate('''
                (async () => {
                    try {
                        const result = await window.feedDatabase.build();
                        return {
                            success: true,
                            queriesRun: result.queriesRun,
                            tracksFed: result.tracksFed,
                            duration: result.duration
                        };
                    } catch (e) {
                        return { success: false, error: e.message };
                    }
                })()
            ''')
            print("-" * 60)
            if result.get('success'):
                fed_total = result.get('tracksFed', 0)
                print(f"Queries run: {result.get('queriesRun', 0)}")
                print(f"Tracks fed: {fed_total}")
                print(f"Duration: {result.get('duration', 0):.1f}s")
            else:
                print(f"Build failed: {result.get('error', 'Unknown')}")

        browser.close()

    print()
    print("=" * 60)
    print(f"COMPLETE - {fed_total} tracks fed to Supabase")
    print("=" * 60)

    return fed_total

if __name__ == '__main__':
    mode = 'test'
    if '--full' in sys.argv:
        mode = 'full'
    elif '--test' in sys.argv:
        mode = 'test'

    fed = run_feeder(mode)
    sys.exit(0 if fed > 0 else 1)

#!/usr/bin/env python3
"""
Test VOYO Database Sync
Verifies that tracks are being synced to video_intelligence
"""

from playwright.sync_api import sync_playwright
import time
import json
import urllib.request

SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4'

def get_db_count():
    """Get current count from video_intelligence"""
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/video_intelligence?select=youtube_id&limit=1000',
        headers={
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}'
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            return len(data)
    except Exception as e:
        print(f"Error getting count: {e}")
        return -1

def test_sync():
    print("=" * 60)
    print("VOYO DATABASE SYNC TEST")
    print("=" * 60)
    print()

    # Get initial count
    initial_count = get_db_count()
    print(f"[1/5] Initial DB count: {initial_count} tracks")

    sync_messages = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        def handle_console(msg):
            text = msg.text
            if 'Sync' in text or 'sync' in text or 'video_intelligence' in text:
                sync_messages.append(text)
                print(f"  SYNC: {text}")

        page.on('console', handle_console)

        # Navigate to VOYO
        print("[2/5] Loading VOYO...")
        page.goto('http://localhost:5174', timeout=60000)
        page.wait_for_load_state('domcontentloaded')
        print("      VOYO loaded!")

        # Wait for startup syncs
        print("[3/5] Waiting for startup syncs (10s)...")
        time.sleep(10)

        # Check count after startup
        after_startup = get_db_count()
        print(f"      DB count after startup: {after_startup} tracks")
        if after_startup > initial_count:
            print(f"      ✅ +{after_startup - initial_count} new tracks from startup!")

        # Test search sync
        print("[4/5] Testing search sync...")
        try:
            # Open search
            page.keyboard.press('/')
            time.sleep(1)

            # Type search query
            page.keyboard.type('Davido')
            time.sleep(3)

            after_search = get_db_count()
            print(f"      DB count after search: {after_search} tracks")
            if after_search > after_startup:
                print(f"      ✅ +{after_search - after_startup} new tracks from search!")
        except Exception as e:
            print(f"      Search test failed: {e}")
            after_search = after_startup

        # Final count
        print("[5/5] Final results...")
        time.sleep(2)
        final_count = get_db_count()

        browser.close()

    print()
    print("=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"Initial count:  {initial_count}")
    print(f"Final count:    {final_count}")
    print(f"New tracks:     +{final_count - initial_count}")
    print()

    if sync_messages:
        print("Sync messages captured:")
        for msg in sync_messages[-10:]:
            print(f"  - {msg}")

    print()
    if final_count > initial_count:
        print("✅ SYNC IS WORKING!")
    else:
        print("⚠️  No new tracks synced (may already be in DB)")

if __name__ == '__main__':
    test_sync()

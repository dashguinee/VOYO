#!/usr/bin/env python3
"""
VOYO Database Feeder Script
Runs the buildAfricanMusicDatabase function via browser console
"""

from playwright.sync_api import sync_playwright
import time
import sys

def run_database_feeder():
    print("=" * 60)
    print("VOYO DATABASE FEEDER")
    print("=" * 60)
    print("Starting browser to run database feeding...")
    print()

    with sync_playwright() as p:
        # Launch browser (headless for automation)
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to VOYO
        print("[1/4] Navigating to VOYO...")
        page.goto('http://localhost:5173', timeout=60000)
        page.wait_for_load_state('domcontentloaded')
        print("      VOYO loaded successfully!")

        # Wait for the app to initialize (VOYO needs time for React + scouts)
        print("[2/4] Waiting for app initialization...")
        time.sleep(5)

        # Check if feedDatabase is available
        print("[3/4] Checking if feedDatabase is available...")
        has_feeder = page.evaluate('typeof window.feedDatabase !== "undefined"')

        if not has_feeder:
            print("      ERROR: window.feedDatabase not found!")
            print("      The DatabaseFeeder may not be imported in App.tsx")
            browser.close()
            return False

        print("      feedDatabase is available!")

        # Get current database stats first
        print("[4/4] Running buildAfricanMusicDatabase()...")
        print("      This may take several minutes (60+ YouTube API queries)")
        print()

        # Run the build function and collect results
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
                } catch (error) {
                    return {
                        success: false,
                        error: error.message
                    };
                }
            })()
        ''')

        if result.get('success'):
            print("=" * 60)
            print("DATABASE BUILD COMPLETE!")
            print("=" * 60)
            print(f"Queries run: {result.get('queriesRun', 0)}")
            print(f"Tracks fed to Supabase: {result.get('tracksFed', 0)}")
            print(f"Duration: {result.get('duration', 0):.1f}s")
        else:
            print("=" * 60)
            print("DATABASE BUILD FAILED!")
            print("=" * 60)
            print(f"Error: {result.get('error', 'Unknown error')}")

        browser.close()
        return result.get('success', False)

if __name__ == '__main__':
    success = run_database_feeder()
    sys.exit(0 if success else 1)

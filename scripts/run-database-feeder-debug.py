#!/usr/bin/env python3
"""
VOYO Database Feeder Script - Debug Version
Captures console logs to diagnose issues
"""

from playwright.sync_api import sync_playwright
import time
import sys

def run_database_feeder():
    print("=" * 60)
    print("VOYO DATABASE FEEDER - DEBUG MODE")
    print("=" * 60)
    print("Starting browser with console logging...")
    print()

    console_messages = []
    feeder_messages = []

    with sync_playwright() as p:
        # Launch browser (headless for automation)
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console messages
        def handle_console(msg):
            text = f"[{msg.type}] {msg.text}"
            console_messages.append(text)
            # Print and save Feeder messages
            if '[Feeder]' in msg.text:
                print(f"  CONSOLE: {text}")
                feeder_messages.append(text)

        page.on('console', handle_console)

        # Navigate to VOYO
        print("[1/5] Navigating to VOYO...")
        page.goto('http://localhost:5173', timeout=60000)
        page.wait_for_load_state('domcontentloaded')
        print("      VOYO loaded successfully!")

        # Wait for the app to settle (let startup requests finish)
        print("[2/5] Waiting for app to settle (15s to avoid rate limits)...")
        time.sleep(15)

        # Check if feedDatabase is available
        print("[3/5] Checking if feedDatabase is available...")
        has_feeder = page.evaluate('typeof window.feedDatabase !== "undefined"')

        if not has_feeder:
            print("      ERROR: window.feedDatabase not found!")
            browser.close()
            return False

        print("      feedDatabase is available!")

        # Get current database stats first
        print("[4/5] Getting current database stats...")
        stats = page.evaluate('''
            (async () => {
                try {
                    return await window.feedDatabase.stats();
                } catch (e) {
                    return { error: e.message };
                }
            })()
        ''')
        print(f"      Current DB: {stats}")

        # Run a single test search first
        print("[5/5] Running test search 'Burna Boy'...")
        test_result = page.evaluate('''
            (async () => {
                try {
                    const fed = await window.feedDatabase.search('Burna Boy official', 5);
                    return { success: true, fed };
                } catch (e) {
                    return { success: false, error: e.message };
                }
            })()
        ''')
        print(f"      Test result: {test_result}")

        print()
        print("=" * 60)
        print("Feeder Messages:")
        print("=" * 60)
        for msg in feeder_messages[-20:]:
            print(msg)

        browser.close()
        return test_result.get('success', False)

if __name__ == '__main__':
    success = run_database_feeder()
    sys.exit(0 if success else 1)

#!/usr/bin/env python3
"""Test VOYO after audio fix"""

from playwright.sync_api import sync_playwright
import time

def test_fixed():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        print("=== VOYO AUDIO FIX TEST ===\n")

        # Load app
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        time.sleep(3)

        # Click a track to trigger playback
        print("1. Clicking track to test playback...")
        track = page.locator('text=Calm Down').first
        if track.is_visible():
            track.click()
            time.sleep(5)  # Wait for stream to load

        # Check audio state
        print("\n2. Checking audio state...")
        audio_state = page.evaluate('''() => {
            const audio = document.querySelector('audio');
            return {
                exists: !!audio,
                src: audio?.src || 'none',
                paused: audio?.paused,
                currentTime: audio?.currentTime,
                duration: audio?.duration,
                readyState: audio?.readyState,
                error: audio?.error?.message || null
            };
        }''')

        print(f"   Audio exists: {audio_state['exists']}")
        print(f"   Source: {audio_state['src'][:60]}...")
        print(f"   Paused: {audio_state['paused']}")
        print(f"   Current time: {audio_state['currentTime']}")
        print(f"   Duration: {audio_state['duration']}")
        print(f"   Ready state: {audio_state['readyState']}")
        print(f"   Error: {audio_state['error']}")

        # Check for errors in console
        print("\n3. Console errors/warnings:")
        errors = [l for l in console_logs if 'error' in l.lower() or 'EMERGENCY' in l]
        if errors:
            for e in errors[-5:]:
                print(f"   ❌ {e[:80]}")
        else:
            print("   ✅ No errors!")

        # Check for successful stream
        success_logs = [l for l in console_logs if 'Got stream URL' in l or 'canplay' in l.lower()]
        if success_logs:
            print("\n4. Success indicators:")
            for s in success_logs[:3]:
                print(f"   ✅ {s[:80]}")

        # Final screenshot
        page.screenshot(path='/tmp/voyo_fixed.png')
        print(f"\n   Screenshot: /tmp/voyo_fixed.png")

        browser.close()

        # Summary
        print("\n=== RESULT ===")
        if audio_state['readyState'] >= 2 and not audio_state['error']:
            print("✅ AUDIO PLAYBACK WORKING!")
        elif audio_state['readyState'] == 0:
            print("❌ Audio not loading (readyState=0)")
        elif audio_state['error']:
            print(f"❌ Audio error: {audio_state['error']}")
        else:
            print(f"⚠️ Partial: readyState={audio_state['readyState']}")

if __name__ == "__main__":
    test_fixed()

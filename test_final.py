#!/usr/bin/env python3
"""Final VOYO test with longer wait"""

from playwright.sync_api import sync_playwright
import time

def test_final():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        print("=== VOYO FINAL TEST ===\n")

        # Load app
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        print("1. App loaded, waiting 5s for initial streams...")
        time.sleep(5)

        # Clear old logs
        console_logs.clear()

        # Click a fresh track
        print("\n2. Clicking 'Last Last' track...")
        track = page.locator('text=Last Last').first
        if track.is_visible():
            track.click()

        # Wait longer for stream to load
        print("3. Waiting 10s for stream to load...")
        time.sleep(10)

        # Check audio state multiple times
        print("\n4. Checking audio states...")
        for i in range(3):
            audio_state = page.evaluate('''() => {
                const audio = document.querySelector('audio');
                const video = document.querySelector('video');
                return {
                    audioExists: !!audio,
                    audioSrc: audio?.src?.slice(0, 60) || 'none',
                    audioPaused: audio?.paused,
                    audioTime: audio?.currentTime?.toFixed(2),
                    audioDuration: audio?.duration,
                    audioReady: audio?.readyState,
                    audioError: audio?.error?.code,
                    videoExists: !!video,
                    videoSrc: video?.src?.slice(0, 60) || 'none',
                    videoReady: video?.readyState
                };
            }''')
            print(f"   Check {i+1}:")
            print(f"     Audio: ready={audio_state['audioReady']} time={audio_state['audioTime']} paused={audio_state['audioPaused']}")
            print(f"     Video: ready={audio_state['videoReady']} src={audio_state['videoSrc']}")
            time.sleep(2)

        # Check console for DEMUXER errors
        print("\n5. Checking for DEMUXER errors...")
        demuxer_errors = [l for l in console_logs if 'DEMUXER' in l or 'SUPPORTED_STREAMS' in l]
        if demuxer_errors:
            print("   ❌ DEMUXER errors found:")
            for e in demuxer_errors[:3]:
                print(f"      {e[:100]}")
        else:
            print("   ✅ No DEMUXER errors!")

        # Check for successful playback
        print("\n6. Checking for playback success...")
        success = [l for l in console_logs if 'canplay' in l.lower() or 'playing' in l.lower()]
        for s in success[:5]:
            print(f"   ✅ {s[:80]}")

        # Final screenshot
        page.screenshot(path='/tmp/voyo_final_test.png')
        print(f"\n   Screenshot: /tmp/voyo_final_test.png")

        browser.close()

if __name__ == "__main__":
    test_final()

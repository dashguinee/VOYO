#!/usr/bin/env python3
"""VOYO Music - Deep Feature Test"""

from playwright.sync_api import sync_playwright
import time

def test_deep():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        print("=== VOYO DEEP TEST ===\n")

        # Load app
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        time.sleep(2)

        # 1. Test Search Icon Click
        print("1. Testing SEARCH...")
        # Look for search icon in top right (magnifying glass)
        search_icons = page.locator('svg').all()
        print(f"   Found {len(search_icons)} SVG icons")

        # Try clicking the search icon (usually in header)
        header_area = page.locator('header, [class*="header"], nav, [class*="top"]').first
        if header_area.is_visible():
            # Click on search area
            search_btn = page.locator('button').filter(has=page.locator('svg')).all()
            for btn in search_btn[:5]:
                try:
                    box = btn.bounding_box()
                    if box and box['x'] > 300:  # Right side of screen
                        print(f"   Clicking search button at x={box['x']}")
                        btn.click()
                        time.sleep(1)
                        page.screenshot(path='/tmp/voyo_search_opened.png')
                        break
                except:
                    pass

        # Check if search overlay appeared
        search_overlay = page.locator('[class*="search"], [class*="overlay"]').all()
        print(f"   Search overlays: {len(search_overlay)}")

        search_input = page.locator('input').all()
        print(f"   Input fields: {len(search_input)}")
        for inp in search_input:
            try:
                placeholder = inp.get_attribute('placeholder') or 'no-placeholder'
                visible = inp.is_visible()
                print(f"     - {placeholder[:30]} (visible={visible})")
            except:
                pass

        # 2. Test audio playback state
        print("\n2. Checking AUDIO state...")

        # Check audio/video elements
        audio_el = page.evaluate('''() => {
            const audio = document.querySelector('audio');
            const video = document.querySelector('video');
            return {
                audioExists: !!audio,
                audioSrc: audio?.src || 'none',
                audioPaused: audio?.paused,
                audioCurrentTime: audio?.currentTime,
                audioDuration: audio?.duration,
                audioReadyState: audio?.readyState,
                videoExists: !!video,
                videoSrc: video?.src || 'none'
            };
        }''')
        print(f"   Audio exists: {audio_el['audioExists']}")
        print(f"   Audio src: {audio_el['audioSrc'][:60]}...")
        print(f"   Audio paused: {audio_el['audioPaused']}")
        print(f"   Audio currentTime: {audio_el['audioCurrentTime']}")
        print(f"   Audio duration: {audio_el['audioDuration']}")
        print(f"   Audio readyState: {audio_el['audioReadyState']}")

        # 3. Click play button and check
        print("\n3. Testing PLAY button...")
        play_btn = page.locator('button').filter(has=page.locator('svg')).all()
        # Find the big center play button
        for btn in play_btn:
            try:
                box = btn.bounding_box()
                if box and 200 < box['x'] < 400 and 150 < box['y'] < 300:
                    print(f"   Found center button at ({box['x']}, {box['y']})")
                    btn.click()
                    time.sleep(2)
                    break
            except:
                pass

        # Check audio state after play
        audio_after = page.evaluate('''() => {
            const audio = document.querySelector('audio');
            return {
                paused: audio?.paused,
                currentTime: audio?.currentTime,
                readyState: audio?.readyState
            };
        }''')
        print(f"   After play - paused: {audio_after['paused']}, time: {audio_after['currentTime']}")

        # 4. Check for specific errors in console
        print("\n4. Checking for ERRORS...")
        errors = [log for log in console_logs if 'error' in log.lower() or 'fail' in log.lower() or 'EMERGENCY' in log]
        for err in errors[-10:]:
            print(f"   ⚠️  {err[:100]}")

        # 5. Test VOYO FEED navigation
        print("\n5. Testing VOYO FEED...")
        feed_btn = page.locator('button:has-text("VOYO"), [class*="feed"]').first
        if feed_btn.is_visible():
            feed_btn.click()
            time.sleep(2)
            page.screenshot(path='/tmp/voyo_feed_view.png')
            print("   Screenshot: /tmp/voyo_feed_view.png")

        # 6. Check discovery portal
        print("\n6. Testing DISCOVERY section...")
        discovery = page.locator('text=DISCOVERY, [class*="discovery"]').all()
        print(f"   Discovery elements: {len(discovery)}")

        # 7. Final state
        print("\n7. Console summary:")
        print(f"   Total logs: {len(console_logs)}")
        warning_count = len([l for l in console_logs if '[warning]' in l])
        error_count = len([l for l in console_logs if '[error]' in l])
        print(f"   Warnings: {warning_count}")
        print(f"   Errors: {error_count}")

        # Show last 10 logs
        print("\n   Last 10 logs:")
        for log in console_logs[-10:]:
            print(f"     {log[:80]}")

        page.screenshot(path='/tmp/voyo_final.png')
        print("\n   Final screenshot: /tmp/voyo_final.png")

        browser.close()
        print("\n=== DEEP TEST COMPLETE ===")

if __name__ == "__main__":
    test_deep()

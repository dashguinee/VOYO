#!/usr/bin/env python3
"""VOYO Music App - Comprehensive Test"""

from playwright.sync_api import sync_playwright
import time

def test_voyo():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console logs
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        # Capture errors
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))

        print("=== VOYO MUSIC TEST ===\n")

        # 1. Navigate and wait
        print("1. Loading app...")
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        time.sleep(2)

        # Screenshot initial state
        page.screenshot(path='/tmp/voyo_1_initial.png', full_page=True)
        print("   Screenshot: /tmp/voyo_1_initial.png")

        # 2. Check what's on the page
        print("\n2. Discovering elements...")

        # Find all buttons
        buttons = page.locator('button').all()
        print(f"   Buttons found: {len(buttons)}")
        for i, btn in enumerate(buttons[:10]):
            try:
                text = btn.inner_text()[:30] if btn.inner_text() else btn.get_attribute('aria-label') or 'no-text'
                print(f"     [{i}] {text}")
            except:
                pass

        # Find clickable track items
        tracks = page.locator('[data-track-id], .track-item, [class*="track"]').all()
        print(f"   Track elements: {len(tracks)}")

        # 3. Try to play a track
        print("\n3. Testing track playback...")

        # Look for HOT section tracks or any clickable music items
        hot_tracks = page.locator('text=Calm Down').first
        if hot_tracks.is_visible():
            print("   Found 'Calm Down' track, clicking...")
            hot_tracks.click()
            time.sleep(3)
            page.screenshot(path='/tmp/voyo_2_after_click.png', full_page=True)
            print("   Screenshot: /tmp/voyo_2_after_click.png")
        else:
            # Try clicking any visible track
            all_clickables = page.locator('[class*="cursor-pointer"]').all()
            print(f"   Clickable items: {len(all_clickables)}")
            if all_clickables:
                all_clickables[0].click()
                time.sleep(3)
                page.screenshot(path='/tmp/voyo_2_after_click.png', full_page=True)

        # 4. Test search
        print("\n4. Testing search...")
        search_btn = page.locator('text=Search, svg[class*="search"], button:has(svg)').first
        search_input = page.locator('input[type="search"], input[placeholder*="search" i]').first

        if search_input.is_visible():
            print("   Search input found, typing...")
            search_input.fill('Burna Boy')
            time.sleep(2)
            page.screenshot(path='/tmp/voyo_3_search.png', full_page=True)
            print("   Screenshot: /tmp/voyo_3_search.png")
        else:
            # Look for search icon/button
            search_icon = page.locator('svg').filter(has_text='').all()
            print(f"   SVG icons: {len(search_icon)}")

        # 5. Test VOYO FEED button
        print("\n5. Testing VOYO FEED...")
        feed_btn = page.locator('text=VOYO FEED').first
        if feed_btn.is_visible():
            print("   VOYO FEED button found, clicking...")
            feed_btn.click()
            time.sleep(2)
            page.screenshot(path='/tmp/voyo_4_feed.png', full_page=True)
            print("   Screenshot: /tmp/voyo_4_feed.png")

        # 6. Check audio element
        print("\n6. Checking audio/video elements...")
        audio = page.locator('audio, video').all()
        print(f"   Audio/Video elements: {len(audio)}")
        for i, el in enumerate(audio):
            src = el.get_attribute('src') or 'no-src'
            print(f"     [{i}] src={src[:50]}...")

        # 7. Print console logs
        print("\n7. Console logs:")
        for log in console_logs[-20:]:
            print(f"   {log[:100]}")

        # 8. Print errors
        print("\n8. Page errors:")
        if errors:
            for err in errors:
                print(f"   ❌ {err[:150]}")
        else:
            print("   No page errors")

        # 9. Get page HTML structure
        print("\n9. Page structure:")
        html = page.content()
        print(f"   HTML length: {len(html)} chars")

        browser.close()

        print("\n=== TEST COMPLETE ===")
        return console_logs, errors

if __name__ == "__main__":
    test_voyo()

"""Test VOYO Library - click parent button"""

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844})

    print("1. Loading VOYO app...")
    page.goto('http://localhost:5176')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(3000)
    print("   ✓ Loaded")

    # Switch to Classic mode via profile
    print("\n2. Switching to Classic mode...")
    page.mouse.click(370, 20)  # Profile
    page.wait_for_timeout(500)
    page.get_by_text("Classic").first.click(force=True)
    page.wait_for_timeout(1000)
    print("   ✓ Classic mode")

    # Try to find the button containing "Library" text
    print("\n3. Looking for Library button...")

    # Look for buttons in the bottom navigation area
    buttons = page.locator('button').all()
    print(f"   Total buttons: {len(buttons)}")

    library_btn = None
    for btn in buttons:
        try:
            inner = btn.inner_text()
            if 'Library' in inner:
                box = btn.bounding_box()
                if box and box['y'] > 700:  # Bottom of page
                    print(f"   Found Library button at y={box['y']:.0f}")
                    library_btn = btn
                    break
        except:
            pass

    if library_btn:
        print("   Clicking Library button...")
        library_btn.click(force=True)
        page.wait_for_timeout(1000)
        page.screenshot(path='/tmp/voyo_01_library.png')
        print("   Screenshot: /tmp/voyo_01_library.png")

        content = page.inner_text('body')
        if 'Your Library' in content:
            print("\n   ✓✓✓ LIBRARY OPENED! ✓✓✓")

            # Check filters
            filters = ['All', 'Liked', 'Queue', 'History', 'Offline']
            found = [f for f in filters if page.locator(f'button:has-text("{f}")').count() > 0]
            print(f"   Filters: {found}")

            # Test Queue
            if 'Queue' in found:
                page.locator('button:has-text("Queue")').first.click()
                page.wait_for_timeout(300)
                print("   ✓ Queue clicked")

            # Test heart long-press
            hearts = page.locator('svg[class*="lucide-heart"]')
            if hearts.count() > 0:
                print(f"\n4. Testing long-press on heart...")
                box = hearts.first.bounding_box()
                if box:
                    page.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2)
                    page.mouse.down()
                    page.wait_for_timeout(600)
                    page.mouse.up()
                    page.wait_for_timeout(600)
                    page.screenshot(path='/tmp/voyo_02_modal.png')

                    if 'Add to Playlist' in page.content():
                        print("   ✓✓✓ PLAYLIST MODAL WORKS! ✓✓✓")
                    else:
                        print("   Modal check - see screenshot")
        else:
            print("   Library view not detected")
            print(f"   Content: {content[:200]}")
    else:
        print("   Library button not found among buttons")
        # Try clicking by exact position based on previous findings
        print("   Trying position click at (328, 830)...")
        page.mouse.click(328, 830)
        page.wait_for_timeout(1000)
        page.screenshot(path='/tmp/voyo_01_pos.png')
        print("   See /tmp/voyo_01_pos.png")

    page.screenshot(path='/tmp/voyo_final.png', full_page=True)
    browser.close()
    print("\n✓ Done")

/**
 * OyoInvocation
 * -------------
 * Top-level overlay that combines DreamBackdrop + MercuryOrb + OyoChat.
 *
 * Mounted ONCE in App.tsx near the root. It reads `isInvoked` from the
 * oyoStore and renders nothing when OYO is not summoned, so the cost
 * when idle is essentially zero.
 *
 * On invocation:
 *   1. DreamBackdrop fades the world in over ~480ms (camera-push)
 *   2. MercuryOrb materialises in the centre, breathing
 *   3. OyoChat seeds with a contextual greeting and focuses input
 *
 * On dismiss:
 *   - Tap outside (DreamBackdrop owns the click handling)
 *   - ESC key (handled in both DreamBackdrop AND OyoChat)
 *   - Quick exit phrase ("see you later", "bye oyo", etc.)
 *
 * Music keeps playing under the overlay — the audio context is global
 * to App.tsx and the backdrop only blurs visually.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useOyoStore } from '../store/oyoStore';
import { DreamBackdrop } from './DreamBackdrop';
import { MercuryOrb } from './MercuryOrb';
import { OyoChat } from './OyoChat';
import type { OyoChatHandle } from './OyoChat';
import { pickGreeting } from './greetings';

export function OyoInvocation() {
  const isInvoked = useOyoStore((s) => s.isInvoked);
  const surface = useOyoStore((s) => s.surface);
  const thinking = useOyoStore((s) => s.thinking);
  const invocationKey = useOyoStore((s) => s.invocationKey);
  const dismiss = useOyoStore((s) => s.dismiss);
  const setThinking = useOyoStore((s) => s.setThinking);

  const chatRef = useRef<OyoChatHandle>(null);

  // Pick a fresh greeting each time we get invoked
  const greeting = useMemo(
    () => pickGreeting(surface),
    // intentionally regenerate per invocation, not just on surface change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface, invocationKey],
  );

  // When invocation key bumps mid-mount (re-summoned without dismiss),
  // reset the chat with a fresh greeting.
  useEffect(() => {
    if (isInvoked && chatRef.current) {
      chatRef.current.reset(greeting);
    }
  }, [invocationKey, greeting, isInvoked]);

  return (
    <DreamBackdrop visible={isInvoked} onDismiss={dismiss}>
      {/* Centre stack: orb + chat. Pointer events on the orb pass
          through to the backdrop so tap-outside still works. */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{
          // Lift the orb slightly above geometric centre so the chat
          // input has room at the bottom.
          paddingBottom: 80,
        }}
      >
        <MercuryOrb size={260} speaking={thinking} listening={isInvoked && !thinking} />
      </div>

      <OyoChat
        ref={chatRef}
        initialGreeting={greeting}
        onThinkingChange={setThinking}
        onDismiss={dismiss}
      />
    </DreamBackdrop>
  );
}

export default OyoInvocation;

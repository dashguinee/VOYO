/**
 * OYO UI — Phase 2
 * ----------------
 * The visual + interaction wrapper around the Phase-1 OYO brain.
 *
 *   - OyoInvocation (overlay, mount once at App root)
 *   - useOyoInvocation (hook for nav surfaces to summon OYO)
 *   - OyoTrigger (component wrapper for the same)
 *   - MercuryOrb (the liquid mercury visual, reusable)
 *   - DreamBackdrop (the "reality bends" overlay, reusable)
 *   - OyoChat (the conversation layer)
 *   - greetings (contextual entry lines)
 */

export { OyoInvocation, default as OyoInvocationDefault } from './OyoInvocation';
export { MercuryOrb } from './MercuryOrb';
export { DreamBackdrop } from './DreamBackdrop';
export { OyoChat } from './OyoChat';
export type { OyoChatHandle, ChatTurn, ChatRole } from './OyoChat';
export { OyoTrigger } from './OyoTrigger';
export { useOyoInvocation } from './useOyoInvocation';
export { GREETINGS, pickGreeting } from './greetings';

// Re-export the store hook for convenience
export { useOyoStore } from '../store/oyoStore';
export type { InvocationSurface } from '../store/oyoStore';

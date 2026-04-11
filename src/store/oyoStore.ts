/**
 * OYO Invocation Store
 * --------------------
 * Holds the global "is OYO summoned" state for the ambient AI overlay.
 *
 * This is intentionally tiny — just enough state for the OyoInvocation
 * overlay (mounted once at App root) to react when any nav surface
 * (Home, Player, DaHub) calls `invoke()`.
 *
 * The actual brain (memory, gemini, tools) lives in `src/oyo/`. This
 * store only knows: invoked or not, where it was called from, and
 * whether OYO is currently thinking.
 */

import { create } from 'zustand';

export type InvocationSurface = 'home' | 'player' | 'dahub';

interface OyoStoreState {
  isInvoked: boolean;
  surface: InvocationSurface;
  thinking: boolean;
  // bumped each time invoke() is called so the overlay can re-pick a greeting
  invocationKey: number;

  invoke: (surface?: InvocationSurface) => void;
  dismiss: () => void;
  setThinking: (thinking: boolean) => void;
}

export const useOyoStore = create<OyoStoreState>((set) => ({
  isInvoked: false,
  surface: 'home',
  thinking: false,
  invocationKey: 0,

  invoke: (surface: InvocationSurface = 'home') =>
    set((state) => ({
      isInvoked: true,
      surface,
      thinking: false,
      invocationKey: state.invocationKey + 1,
    })),

  dismiss: () =>
    set({
      isInvoked: false,
      thinking: false,
    }),

  setThinking: (thinking) => set({ thinking }),
}));

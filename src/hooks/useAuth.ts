/**
 * VOYO Auth Hook - Unified DASH ID Authentication
 *
 * THE ONLY auth hook for VOYO. Uses Command Center DASH ID.
 *
 * Usage:
 *   const { isLoggedIn, dashId, displayName, signIn, signOut } = useAuth();
 *
 *   if (!isLoggedIn) return <SignInPrompt />;
 *   // dashId = "0046AAD"
 *   // displayName = "Dash"
 *
 * For profile data, use useAuthContext() from providers/AuthProvider.
 */

import { useState, useCallback, useContext } from 'react';
import { useDashCitizen, signInWithDashId, signOutDash, getDashSession } from '../lib/dash-auth';

export interface AuthState {
  isLoggedIn: boolean;
  dashId: string | null;        // "0046AAD"
  voyoId: string | null;        // "V0046AAD"
  displayName: string | null;   // "Dash"
  initials: string | null;      // "D"
}

export function useAuth() {
  const { citizen, isAuthenticated, displayId, coreId, openCommandCenter } = useDashCitizen('V');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sign in with DASH ID + PIN
  const signIn = useCallback(async (dashId: string, pin: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    const result = await signInWithDashId(dashId, pin, 'V');

    setIsLoading(false);

    if (!result.success) {
      setError(result.error || 'Sign in failed');
      return false;
    }

    // Trigger re-render by dispatching storage event
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'dash_citizen_storage',
    }));

    return true;
  }, []);

  // Sign out
  const signOut = useCallback(() => {
    signOutDash();
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'dash_citizen_storage',
    }));
  }, []);

  // Open Command Center for sign in
  const openSignIn = useCallback(() => {
    openCommandCenter();
  }, [openCommandCenter]);

  return {
    // Auth state
    isLoggedIn: isAuthenticated,
    dashId: coreId,               // "0046AAD"
    voyoId: displayId,            // "V0046AAD"
    displayName: citizen?.fullName || null,
    initials: citizen?.initials || null,

    // Auth actions
    signIn,
    signOut,
    openSignIn,

    // Loading/error state
    isLoading,
    error,
  };
}

/**
 * Quick check if authenticated (non-hook)
 */
export function isAuthenticated(): boolean {
  return getDashSession('V') !== null;
}

/**
 * Get dash ID without hook (for stores)
 */
export function getDashId(): string | null {
  const session = getDashSession('V');
  return session?.user.core_id || null;
}

/**
 * Get full auth state without hook (for stores)
 */
export function getAuthState(): AuthState {
  const session = getDashSession('V');

  if (!session) {
    return {
      isLoggedIn: false,
      dashId: null,
      voyoId: null,
      displayName: null,
      initials: null,
    };
  }

  const initials = session.user.full_name
    ?.split(' ')
    .map(n => n[0]?.toUpperCase())
    .join('') || null;

  return {
    isLoggedIn: true,
    dashId: session.user.core_id,
    voyoId: session.displayId,
    displayName: session.user.full_name,
    initials,
  };
}

export default useAuth;

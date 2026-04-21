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

import { useState, useCallback, useContext, useEffect } from 'react';
import { useDashCitizen, signInWithDashId, signOutDash, getDashSession } from '../lib/dash-auth';

// Local-only name saved by the first-time loader for users who haven't
// signed in via DASH Auth. Acts as a fallback under the real citizen name
// so the greeting banner + profile icon still feel personal on day one.
export const LOCAL_NAME_KEY = 'voyo-user-name';
const NAME_CHANGE_EVENT = 'voyo-user-name-changed';

function readLocalName(): string | null {
  try { return localStorage.getItem(LOCAL_NAME_KEY) || null; }
  catch { return null; }
}

// Dispatch after writing the local name so every useAuth consumer re-renders
// in the same tick. Plain `storage` event only fires cross-tab, so we need
// a custom event for same-tab subscribers.
export function notifyLocalNameChange() {
  try { window.dispatchEvent(new Event(NAME_CHANGE_EVENT)); } catch {}
}

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
  const [localName, setLocalName] = useState<string | null>(() => readLocalName());

  useEffect(() => {
    const onChange = () => setLocalName(readLocalName());
    window.addEventListener(NAME_CHANGE_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(NAME_CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

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

  // Real citizen name wins; local loader-captured name is the fallback.
  const resolvedDisplayName = citizen?.fullName || localName || null;
  const resolvedInitials = citizen?.initials
    || (localName ? localName.charAt(0).toUpperCase() : null);

  return {
    // Auth state
    isLoggedIn: isAuthenticated,
    dashId: coreId,               // "0046AAD"
    voyoId: displayId,            // "V0046AAD"
    displayName: resolvedDisplayName,
    initials: resolvedInitials,

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

/**
 * VOYO Auth Provider
 *
 * Handles:
 * 1. Auth state detection from Command Center
 * 2. Auto-create VOYO profile on first login
 * 3. Sync user data (preferences, history) to cloud
 * 4. Presence updates (friends can see what you're playing)
 */

import { createContext, useContext, useEffect, useCallback, useRef, useState, ReactNode } from 'react';
import { profileAPI, friendsAPI, VoyoProfile } from '../lib/voyo-api';
import { usePlayerStore } from '../store/playerStore';
import { usePreferenceStore } from '../store/preferenceStore';
import { getDashSession, DashSession } from '../lib/dash-auth';

// ============================================
// TYPES
// ============================================

interface AuthContextValue {
  // Auth state
  isLoggedIn: boolean;
  dashId: string | null;
  voyoId: string | null;
  displayName: string | null;
  profile: VoyoProfile | null;

  // Loading states
  isLoading: boolean;
  isProfileLoading: boolean;

  // Actions
  refreshProfile: () => Promise<void>;
  syncToCloud: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================
// STORAGE KEY (same as dash-auth.tsx)
// ============================================
const STORAGE_KEY = 'dash_citizen_storage';

// ============================================
// PROVIDER
// ============================================

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Auth state
  const [session, setSession] = useState<DashSession | null>(() => getDashSession('V'));
  const [profile, setProfile] = useState<VoyoProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);

  // Refs for presence updates
  const presenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPresenceUpdateRef = useRef<string | null>(null);

  // Derived state
  const isLoggedIn = Boolean(session);
  const dashId = session?.user.core_id || null;
  const voyoId = session?.displayId || null;
  const displayName = session?.user.full_name || null;

  // ========================================
  // PROFILE: Get or create on login
  // ========================================
  const loadOrCreateProfile = useCallback(async (dashId: string) => {
    setIsProfileLoading(true);
    try {
      console.log('[VOYO Auth] Loading/creating profile for:', dashId);
      const voyoProfile = await profileAPI.getOrCreate(dashId);

      if (voyoProfile) {
        setProfile(voyoProfile);
        console.log('[VOYO Auth] Profile loaded:', {
          dashId: voyoProfile.dash_id,
          totalListens: voyoProfile.total_listens,
          totalMinutes: voyoProfile.total_minutes,
        });

        // Restore preferences from cloud if they exist
        if (voyoProfile.preferences?.track_preferences) {
          const prefStore = usePreferenceStore.getState();
          const cloudPrefs = voyoProfile.preferences.track_preferences;

          // Only restore if local is empty
          if (Object.keys(prefStore.trackPreferences).length === 0) {
            console.log('[VOYO Auth] Restoring preferences from cloud');
            // Preferences will be restored on next session
          }
        }
      }
    } catch (err) {
      console.error('[VOYO Auth] Profile load error:', err);
    } finally {
      setIsProfileLoading(false);
    }
  }, []);

  // ========================================
  // PRESENCE: Update what you're listening to
  // ========================================
  const updatePresence = useCallback(async () => {
    if (!dashId) return;

    const currentTrack = usePlayerStore.getState().currentTrack;
    const isPlaying = usePlayerStore.getState().isPlaying;

    // Build activity string
    let activity: string | undefined;
    if (currentTrack && isPlaying) {
      activity = `Listening to ${currentTrack.title} by ${currentTrack.artist}`;
    }

    // Only update if activity changed
    if (activity === lastPresenceUpdateRef.current) return;
    lastPresenceUpdateRef.current = activity || null;

    try {
      await friendsAPI.updatePresence(
        dashId,
        isPlaying ? 'online' : 'away',
        activity,
        currentTrack ? {
          trackId: currentTrack.trackId,
          title: currentTrack.title,
          artist: currentTrack.artist,
          thumbnail: currentTrack.coverUrl,
        } : undefined
      );
    } catch (err) {
      // Silent fail - presence is best-effort
    }
  }, [dashId]);

  // ========================================
  // SYNC: Push local data to cloud
  // ========================================
  const syncToCloud = useCallback(async () => {
    if (!dashId || !profile) return;

    try {
      const prefStore = usePreferenceStore.getState();
      const playerStore = usePlayerStore.getState();

      // Build preferences object
      const preferences = {
        track_preferences: prefStore.trackPreferences,
        artist_preferences: prefStore.artistPreferences,
        tag_preferences: prefStore.tagPreferences,
        vibe_profile: {
          afro_heat: 0,
          chill: 0,
          party: 0,
          workout: 0,
          late_night: 0,
        },
      };

      // Calculate vibe profile from listening history
      Object.values(prefStore.trackPreferences).forEach(pref => {
        if (pref.completions > 0) {
          // Would need track metadata to determine vibe
          // For now, just track overall engagement
        }
      });

      // Build stats
      const totalListens = Object.values(prefStore.trackPreferences).reduce(
        (sum, p) => sum + (p.totalListens || 0), 0
      );
      const totalMinutes = Math.round(
        Object.values(prefStore.trackPreferences).reduce(
          (sum, p) => sum + (p.totalDuration || 0), 0
        ) / 60
      );

      // Build history (last 100 plays)
      const history = playerStore.history.slice(-100).map(h => ({
        trackId: h.track.trackId || h.track.id,
        playedAt: h.playedAt,
        duration: h.duration,
      }));

      // Update profile
      await profileAPI.updatePreferences(dashId, preferences);

      console.log('[VOYO Auth] Synced to cloud:', { totalListens, totalMinutes });
    } catch (err) {
      console.error('[VOYO Auth] Sync error:', err);
    }
  }, [dashId, profile]);

  // ========================================
  // REFRESH: Reload profile from cloud
  // ========================================
  const refreshProfile = useCallback(async () => {
    if (!dashId) return;
    await loadOrCreateProfile(dashId);
  }, [dashId, loadOrCreateProfile]);

  // ========================================
  // EFFECT: Listen for auth changes
  // ========================================
  useEffect(() => {
    // Check initial state
    const currentSession = getDashSession('V');
    setSession(currentSession);
    setIsLoading(false);

    // Load profile if logged in
    if (currentSession?.user.core_id) {
      loadOrCreateProfile(currentSession.user.core_id);
    }

    // Listen for storage changes (cross-tab or same-tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) {
        try {
          const newSession = getDashSession('V');
          const currentSession = getDashSession('V'); // Get fresh current state
          const wasLoggedIn = Boolean(currentSession);
          const isNowLoggedIn = Boolean(newSession);

          setSession(newSession);

        // User just logged in
        if (!wasLoggedIn && isNowLoggedIn && newSession?.user.core_id) {
          console.log('[VOYO Auth] User logged in:', newSession.user.core_id);
          loadOrCreateProfile(newSession.user.core_id);
        }

        // User logged out
        if (wasLoggedIn && !isNowLoggedIn) {
          console.log('[VOYO Auth] User logged out');
          setProfile(null);
        }
        } catch (err) {
          console.error('[VOYO Auth] Storage change error:', err);
        }
      }
    };

    // Listen for window focus (check if user logged in on another tab)
    const handleFocus = () => {
      try {
        const newSession = getDashSession('V');
        // Use functional update to avoid stale closure
        setSession(prev => {
          if (newSession?.user.core_id !== prev?.user.core_id) {
            if (newSession?.user.core_id) {
              loadOrCreateProfile(newSession.user.core_id);
            } else {
              setProfile(null);
            }
            return newSession;
          }
          return prev;
        });
      } catch (err) {
        console.error('[VOYO Auth] Focus handler error:', err);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadOrCreateProfile]); // Removed session to avoid stale closure issues

  // ========================================
  // EFFECT: Presence updates every 30s
  // ========================================
  useEffect(() => {
    if (!isLoggedIn) {
      if (presenceIntervalRef.current) {
        clearInterval(presenceIntervalRef.current);
        presenceIntervalRef.current = null;
      }
      return;
    }

    // Initial presence update
    updatePresence();

    // Update every 30 seconds
    presenceIntervalRef.current = setInterval(updatePresence, 30000);

    return () => {
      if (presenceIntervalRef.current) {
        clearInterval(presenceIntervalRef.current);
      }
    };
  }, [isLoggedIn, updatePresence]);

  // ========================================
  // EFFECT: Auto-sync on preference changes
  // ========================================
  useEffect(() => {
    if (!isLoggedIn) return;

    // Debounced sync when preferences change
    const unsubscribe = usePreferenceStore.subscribe((state, prevState) => {
      // Check if preferences actually changed
      const prefsChanged = state.trackPreferences !== prevState.trackPreferences;

      if (prefsChanged) {
        // Debounce sync
        const timeout = setTimeout(() => {
          syncToCloud();
        }, 5000); // Wait 5s after last change

        return () => clearTimeout(timeout);
      }
    });

    return unsubscribe;
  }, [isLoggedIn, syncToCloud]);

  // ========================================
  // EFFECT: Update now_playing when track changes
  // ========================================
  useEffect(() => {
    if (!dashId) return;

    const unsubscribe = usePlayerStore.subscribe((state, prevState) => {
      // Track changed or playback state changed
      if (
        state.currentTrack?.trackId !== prevState.currentTrack?.trackId ||
        state.isPlaying !== prevState.isPlaying
      ) {
        const track = state.currentTrack;

        if (track && state.isPlaying) {
          profileAPI.updateNowPlaying(dashId, {
            trackId: track.trackId,
            title: track.title,
            artist: track.artist,
            thumbnail: track.coverUrl,
            currentTime: state.currentTime,
            duration: state.duration,
            isPlaying: state.isPlaying,
          });
        } else {
          profileAPI.updateNowPlaying(dashId, null);
        }
      }
    });

    return unsubscribe;
  }, [dashId]);

  // ========================================
  // CONTEXT VALUE
  // ========================================
  const value: AuthContextValue = {
    isLoggedIn,
    dashId,
    voyoId,
    displayName,
    profile,
    isLoading,
    isProfileLoading,
    refreshProfile,
    syncToCloud,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ============================================
// HOOK
// ============================================

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within AuthProvider');
  }
  return context;
}

export default AuthProvider;

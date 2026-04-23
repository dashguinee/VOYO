/**
 * VOYO Universe Store - DEPRECATED
 *
 * ⚠️ MIGRATION NOTICE (Jan 2026):
 * This store is DEPRECATED. Use DASH Command Center auth instead:
 * - Authentication: Use useAuth() hook from hooks/useAuth.ts
 * - Identity: DASH ID is the primary key (not username)
 * - Friends: Use friendsAPI from voyo-api.ts (queries Command Center)
 * - Profile: Use profileAPI from voyo-api.ts (queries voyo_profiles table)
 *
 * This file is kept for backward compatibility but should not be used in new code.
 *
 * OLD ARCHITECTURE (deprecated):
 * - URL IS your identity (voyomusic.com/username)
 * - PIN IS your key (no email, no OAuth)
 *
 * NEW ARCHITECTURE:
 * - URL: voyomusic.com/{dashId}
 * - Display: V{dashId} (e.g., V0046AAD)
 * - Auth: DASH Command Center (hub.dasuperhub.com)
 */

import { create } from 'zustand';
// CIRCULAR DEP FIX: playerStore and preferenceStore are accessed via
// dynamic import() to avoid TDZ (Temporal Dead Zone) crashes. All stores
// end up in one Vite chunk, so static top-level imports create init order
// issues. Dynamic import() inside action functions is safe because stores
// are fully initialized by the time any action is called by user interaction.
import {
  universeAPI,
  isSupabaseConfigured,
  UniverseRow,
  UniverseState,
  PublicProfile,
  NowPlaying,
} from '../lib/supabase';
import { TRACKS } from '../data/tracks';
import { devLog, devWarn } from '../utils/logger';

// ============================================
// TYPES
// ============================================

export interface UniverseData {
  version: string;
  exportedAt: string;
  username: string;
  preferences: {
    trackPreferences: Record<string, any>;
    artistPreferences: Record<string, any>;
    tagPreferences: Record<string, any>;
    moodPreferences: Record<string, any>;
  };
  player: {
    currentTrackId?: string;
    currentTime?: number;
    volume: number;
    boostProfile: string;
    shuffleMode: boolean;
    repeatMode: string;
  };
  boostedTracks: string[];
  playlists: { id: string; name: string; trackIds: string[]; createdAt: string }[];
  history: { trackId: string; playedAt: string; duration: number }[];
}

export interface PortalSession {
  id: string;
  hostUsername: string;
  isHost: boolean;
  connectedPeers: string[];
  isLive: boolean;
  startedAt: string;
}

// Viewing someone else's universe
export interface ViewingUniverse {
  username: string;
  profile: PublicProfile;
  nowPlaying: NowPlaying | null;
  portalOpen: boolean;
}

interface UniverseStore {
  // Auth State
  isLoggedIn: boolean;
  currentUsername: string | null;
  coreId: string | null;           // DASH identity (Command Center)
  dashCitizen: DashCitizen | null; // Full DASH citizen data
  isLoading: boolean;
  error: string | null;

  // Viewing State (when visiting /username)
  viewingUniverse: ViewingUniverse | null;
  isViewingOther: boolean;

  // Portal State
  portalSession: PortalSession | null;
  isPortalOpen: boolean;
  portalSubscription: any | null;

  // Backup State
  isExporting: boolean;
  isImporting: boolean;
  lastBackupAt: string | null;

  // Auth Actions
  signup: (username: string, pin: string, displayName?: string) => Promise<boolean>;
  login: (username: string, pin: string) => Promise<boolean>;
  loginWithDash: () => void;                    // Redirect to Command Center
  handleDashCallback: () => boolean;            // Handle return from Command Center
  logout: () => void;
  checkUsername: (username: string) => Promise<boolean>;

  // View Actions (for visitors)
  viewUniverse: (username: string) => Promise<boolean>;
  leaveUniverse: () => void;

  // Sync Actions
  syncToCloud: () => Promise<boolean>;
  syncFromCloud: () => Promise<boolean>;
  updateNowPlaying: () => Promise<void>;

  // Portal Actions
  openPortal: () => Promise<string>;
  closePortal: () => Promise<void>;
  joinPortal: (username: string) => Promise<boolean>;
  leavePortal: () => void;

  // Backup Actions
  exportUniverse: () => Promise<UniverseData>;
  importUniverse: (data: UniverseData) => Promise<boolean>;
  downloadBackup: () => Promise<void>;
  generatePassphrase: () => string;
  saveToCloud: (passphrase: string) => Promise<boolean>;
  restoreFromCloud: (passphrase: string) => Promise<boolean>;
}

// ============================================
// LOCAL STORAGE KEYS
// ============================================
const STORAGE_KEYS = {
  username: 'voyo-username',
  session: 'voyo-session',
  lastBackup: 'voyo-last-backup',
};

// ============================================
// DASH CITIZEN (Command Center SSO)
// ============================================
const DASH_CITIZEN_KEY = 'dash_citizen_storage';
const COMMAND_CENTER_URL = 'https://hub.dasuperhub.com';

export interface DashCitizen {
  coreId: string;
  displayId: string;
  fullName: string;
  initials: string;
  sequence?: number;
  phone?: string;
}

// Helper to get DASH citizen from localStorage (FLAT format)
const getDashCitizen = (): DashCitizen | null => {
  try {
    const stored = localStorage.getItem(DASH_CITIZEN_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      // Handle both flat and nested formats for backward compatibility
      const citizen = data.state?.citizen || data;
      if (citizen.coreId) return citizen;
    }
  } catch (e) { /* ignore */ }
  return null;
};

// ============================================
// PASSPHRASE WORDS (African-inspired)
// ============================================
const PASSPHRASE_WORDS = [
  'mango', 'baobab', 'savanna', 'sunset', 'ocean', 'river', 'mountain', 'desert',
  'jungle', 'forest', 'sunrise', 'thunder', 'rain', 'wind', 'fire', 'earth',
  'rhythm', 'melody', 'drum', 'bass', 'guitar', 'voice', 'harmony', 'beat',
  'groove', 'vibe', 'soul', 'spirit', 'dance', 'flow', 'wave', 'pulse',
  'africa', 'guinea', 'lagos', 'accra', 'dakar', 'nairobi', 'abuja', 'conakry',
  'freetown', 'bamako', 'kinshasa', 'addis', 'cairo', 'tunis', 'algiers', 'rabat',
  'kente', 'dashiki', 'ankara', 'gele', 'beads', 'gold', 'bronze', 'ivory',
  'jollof', 'fufu', 'suya', 'palm', 'coconut', 'pepper', 'spice', 'honey',
  'peace', 'love', 'unity', 'power', 'wisdom', 'truth', 'light', 'hope',
  'dream', 'magic', 'star', 'moon', 'sun', 'sky', 'cloud', 'rainbow'
];

function generatePassphrase(): string {
  const words = Array.from({ length: 4 }, () =>
    PASSPHRASE_WORDS[Math.floor(Math.random() * PASSPHRASE_WORDS.length)]
  );
  return `${words.join(' ')} ${new Date().getFullYear()}`;
}

// Simple encryption
async function encryptData(data: string, passphrase: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(data));
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptData(encrypted: string, passphrase: string): Promise<string | null> {
  try {
    const encoder = new TextEncoder();
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const data = combined.slice(28);
    const keyMaterial = await crypto.subtle.importKey(
      'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

function getBoostedTrackIds(): string[] {
  try {
    const store = localStorage.getItem('voyo-downloads');
    if (!store) return [];
    return Object.keys(JSON.parse(store).state?.downloads || {});
  } catch {
    return [];
  }
}

// ============================================
// STORE
// ============================================

export const useUniverseStore = create<UniverseStore>((set, get) => ({
  // Initial State - check localStorage for existing session OR DASH citizen
  isLoggedIn: Boolean(localStorage.getItem(STORAGE_KEYS.username) || getDashCitizen()),
  currentUsername: localStorage.getItem(STORAGE_KEYS.username) || getDashCitizen()?.coreId || null,
  coreId: getDashCitizen()?.coreId || null,
  dashCitizen: getDashCitizen(),
  isLoading: false,
  error: null,

  viewingUniverse: null,
  isViewingOther: false,

  portalSession: null,
  isPortalOpen: false,
  portalSubscription: null,

  isExporting: false,
  isImporting: false,
  lastBackupAt: localStorage.getItem(STORAGE_KEYS.lastBackup),

  // ========================================
  // AUTH: SIGNUP
  // ========================================
  signup: async (username: string, pin: string, displayName?: string) => {
    set({ isLoading: true, error: null });

    if (!isSupabaseConfigured) {
      // Offline mode - just store locally
      const normalized = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
      localStorage.setItem(STORAGE_KEYS.username, normalized);
      set({ isLoggedIn: true, currentUsername: normalized, isLoading: false });
      return true;
    }

    const result = await universeAPI.create(username, pin, displayName);

    if (result.success) {
      const normalized = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
      localStorage.setItem(STORAGE_KEYS.username, normalized);
      set({ isLoggedIn: true, currentUsername: normalized, isLoading: false });
      return true;
    } else {
      set({ error: result.error || 'Signup failed', isLoading: false });
      return false;
    }
  },

  // ========================================
  // AUTH: LOGIN
  // ========================================
  login: async (username: string, pin: string) => {
    set({ isLoading: true, error: null });

    if (!isSupabaseConfigured) {
      // Offline mode
      const normalized = username.toLowerCase();
      localStorage.setItem(STORAGE_KEYS.username, normalized);
      set({ isLoggedIn: true, currentUsername: normalized, isLoading: false });
      return true;
    }

    const result = await universeAPI.login(username, pin);

    if (result.success && result.universe) {
      localStorage.setItem(STORAGE_KEYS.username, result.universe.username);

      set({
        isLoggedIn: true,
        currentUsername: result.universe.username,
        isLoading: false,
      });

      // Sync state from cloud to local (async, don't block login)
      setTimeout(() => get().syncFromCloud(), 100);

      return true;
    } else {
      set({ error: result.error || 'Login failed', isLoading: false });
      return false;
    }
  },

  // ========================================
  // AUTH: LOGOUT
  // ========================================
  logout: () => {
    localStorage.removeItem(STORAGE_KEYS.username);
    localStorage.removeItem(STORAGE_KEYS.session);
    localStorage.removeItem(DASH_CITIZEN_KEY);
    // Drop the userHash logged-in hint (C3) so signals fall back to anon.
    localStorage.removeItem('voyo-account');
    set({
      isLoggedIn: false,
      currentUsername: null,
      coreId: null,
      dashCitizen: null,
      portalSession: null,
      isPortalOpen: false,
    });
  },

  // ========================================
  // AUTH: LOGIN WITH DASH (Command Center SSO)
  // ========================================
  loginWithDash: () => {
    // Don't encode - URLSearchParams handles it
    const returnUrl = window.location.origin;
    window.location.href = `${COMMAND_CENTER_URL}?returnUrl=${returnUrl}&app=V`;
  },

  // ========================================
  // AUTH: HANDLE DASH CALLBACK
  // ========================================
  handleDashCallback: () => {
    const params = new URLSearchParams(window.location.search);
    const authData = params.get('dashAuth');

    if (!authData) return false;

    try {
      const citizen: DashCitizen = JSON.parse(atob(authData));

      if (citizen.coreId) {
        // Save FLAT to localStorage (matches Command Center format)
        localStorage.setItem(DASH_CITIZEN_KEY, JSON.stringify(citizen));
        // C3: wire userHash's logged-in branch. utils/userHash.ts reads
        // `voyo-account` first and returns parsed.account.id. Without this,
        // every voyo_signals row from a DASH-authed user was stamped with
        // the anon device hash, breaking cross-device taste.
        try {
          localStorage.setItem(
            'voyo-account',
            JSON.stringify({ account: { id: citizen.coreId } }),
          );
        } catch { /* ignore quota */ }

        // Update store
        set({
          isLoggedIn: true,
          currentUsername: citizen.coreId,
          coreId: citizen.coreId,
          dashCitizen: citizen,
          isLoading: false,
        });

        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);

        devLog('[DASH Auth] Logged in as:', citizen.coreId);
        return true;
      }
    } catch (e) {
      devWarn('[DASH Auth] Failed to parse callback:', e);
    }
    return false;
  },

  // ========================================
  // AUTH: CHECK USERNAME
  // ========================================
  checkUsername: async (username: string) => {
    if (!isSupabaseConfigured) return true;
    return universeAPI.checkUsername(username);
  },

  // ========================================
  // VIEW: Visit someone's universe
  // ========================================
  viewUniverse: async (username: string) => {
    set({ isLoading: true });

    const { currentUsername } = get();

    // If viewing own universe, just return
    if (username.toLowerCase() === currentUsername?.toLowerCase()) {
      set({ isLoading: false, isViewingOther: false, viewingUniverse: null });
      return true;
    }

    if (!isSupabaseConfigured) {
      set({ isLoading: false, error: 'Cannot view universes offline' });
      return false;
    }

    const result = await universeAPI.getPublicProfile(username);

    if (result.profile) {
      set({
        viewingUniverse: {
          username: username.toLowerCase(),
          profile: result.profile,
          nowPlaying: result.nowPlaying,
          portalOpen: result.portalOpen,
        },
        isViewingOther: true,
        isLoading: false,
      });

      // If portal is open, subscribe to real-time updates
      if (result.portalOpen) {
        const subscription = universeAPI.subscribeToUniverse(username, (payload) => {
          const updated = payload.new;
          set((state) => ({
            viewingUniverse: state.viewingUniverse
              ? {
                  ...state.viewingUniverse,
                  nowPlaying: updated.now_playing,
                  portalOpen: updated.portal_open,
                }
              : null,
          }));
        });
        set({ portalSubscription: subscription });
      }

      return true;
    } else {
      set({ isLoading: false, error: 'Universe not found' });
      return false;
    }
  },

  // ========================================
  // VIEW: Leave someone's universe
  // ========================================
  leaveUniverse: () => {
    const { portalSubscription } = get();
    if (portalSubscription) {
      universeAPI.unsubscribe(portalSubscription);
    }
    set({
      viewingUniverse: null,
      isViewingOther: false,
      portalSubscription: null,
    });
  },

  // ========================================
  // SYNC: Push local state to cloud
  // ========================================
  syncToCloud: async () => {
    const { currentUsername, isLoggedIn } = get();
    if (!isLoggedIn || !currentUsername || !isSupabaseConfigured) return false;

    const { usePreferenceStore: PrefStore } = await import('./preferenceStore');
    const { usePlayerStore: PlayerStore } = await import('./playerStore');
    const preferences = PrefStore.getState();
    const player = PlayerStore.getState();

    const state: Partial<UniverseState> = {
      likes: Object.keys(preferences.trackPreferences).filter(
        (id) => preferences.trackPreferences[id]?.explicitLike === true
      ),
      preferences: {
        boostProfile: player.boostProfile,
        shuffleMode: player.shuffleMode,
        repeatMode: player.repeatMode,
      },
      // Queue - store trackIds only (last 20)
      queue: player.queue.slice(0, 20).map((q: any) => q.track.trackId || q.track.id),
      // History - store last 50 plays
      history: player.history.slice(-50).map((h: any) => ({
        trackId: h.track.trackId || h.track.id,
        playedAt: h.playedAt,
        duration: h.duration,
      })),
      stats: {
        totalListens: Object.values(preferences.trackPreferences).reduce(
          (sum: number, p: any) => sum + (p.totalListens || 0),
          0
        ),
        totalMinutes: Math.round(
          Object.values(preferences.trackPreferences).reduce(
            (sum: number, p: any) => sum + (p.totalDuration || 0),
            0
          ) / 60
        ),
        totalOyes: Object.values(preferences.trackPreferences).reduce(
          (sum: number, p: any) => sum + (p.reactions || 0),
          0
        ),
      },
    };

    return universeAPI.updateState(currentUsername, state);
  },

  // ========================================
  // SYNC: Pull cloud state to local
  // ========================================
  syncFromCloud: async () => {
    const { currentUsername, isLoggedIn } = get();
    if (!isLoggedIn || !currentUsername || !isSupabaseConfigured) return false;

    try {
      // Fetch universe from Supabase
      const { supabase } = await import('../lib/supabase');
      if (!supabase) return false;

      const { data, error } = await supabase
        .from('universes')
        .select('state, public_profile')
        .eq('username', currentUsername)
        .maybeSingle();

      if (error || !data) return false;

      const cloudState = data.state as UniverseState;
      const { usePreferenceStore: PrefStore } = await import('./preferenceStore');
      const { usePlayerStore: PlayerStore } = await import('./playerStore');
      const preferences = PrefStore.getState();
      const player = PlayerStore.getState();

      // Restore likes to preferenceStore
      if (cloudState.likes && cloudState.likes.length > 0) {
        cloudState.likes.forEach((trackId: string) => {
          if (!preferences.trackPreferences[trackId]?.explicitLike) {
            preferences.setExplicitLike(trackId, true);
          }
        });
      }

      // Restore preferences to playerStore
      if (cloudState.preferences) {
        if (cloudState.preferences.boostProfile) {
          player.setBoostProfile(cloudState.preferences.boostProfile as any);
        }
        if (cloudState.preferences.shuffleMode !== undefined) {
          if (cloudState.preferences.shuffleMode !== player.shuffleMode) {
            player.toggleShuffle();
          }
        }
      }

      // Restore queue from cloud (if local queue is empty)
      if (cloudState.queue && cloudState.queue.length > 0 && player.queue.length === 0) {
        cloudState.queue.forEach((trackId: string) => {
          const track = TRACKS.find((t) => t.trackId === trackId || t.id === trackId);
          if (track) {
            player.addToQueue(track);
          }
        });
      }

      // Note: History is not restored to avoid duplicates - it rebuilds as user plays

      devLog('[VOYO] Synced from cloud:', currentUsername);
      return true;
    } catch (error) {
      devWarn('[VOYO] Sync from cloud failed:', error);
      return false;
    }
  },

  // ========================================
  // SYNC: Update now playing for portal
  // ========================================
  updateNowPlaying: async () => {
    const { currentUsername, isPortalOpen } = get();
    if (!currentUsername || !isPortalOpen || !isSupabaseConfigured) return;

    const { usePlayerStore: ps } = await import('./playerStore');
    const player = ps.getState();
    if (!player.currentTrack) {
      await universeAPI.updateNowPlaying(currentUsername, null);
      return;
    }

    const nowPlaying: NowPlaying = {
      trackId: player.currentTrack.trackId || player.currentTrack.id,
      title: player.currentTrack.title,
      artist: player.currentTrack.artist,
      thumbnail: player.currentTrack.coverUrl,
      currentTime: player.currentTime,
      duration: player.duration,
      isPlaying: player.isPlaying,
    };

    await universeAPI.updateNowPlaying(currentUsername, nowPlaying);
  },

  // ========================================
  // PORTAL: Open your portal
  // ========================================
  openPortal: async () => {
    const { currentUsername } = get();
    if (!currentUsername) return '';

    if (isSupabaseConfigured) {
      await universeAPI.setPortalOpen(currentUsername, true);
      await get().updateNowPlaying();
    }

    const portalUrl = `${window.location.origin}/${currentUsername}`;

    set({
      isPortalOpen: true,
      portalSession: {
        id: `portal-${currentUsername}-${Date.now()}`,
        hostUsername: currentUsername,
        isHost: true,
        connectedPeers: [],
        isLive: true,
        startedAt: new Date().toISOString(),
      },
    });

    return portalUrl;
  },

  // ========================================
  // PORTAL: Close your portal
  // ========================================
  closePortal: async () => {
    const { currentUsername } = get();

    if (currentUsername && isSupabaseConfigured) {
      await universeAPI.setPortalOpen(currentUsername, false);
      await universeAPI.updateNowPlaying(currentUsername, null);
    }

    set({
      isPortalOpen: false,
      portalSession: null,
    });
  },

  // ========================================
  // PORTAL: Join someone's portal
  // ========================================
  joinPortal: async (username: string) => {
    const result = await get().viewUniverse(username);
    return result;
  },

  // ========================================
  // PORTAL: Leave portal
  // ========================================
  leavePortal: () => {
    get().leaveUniverse();
  },

  // ========================================
  // BACKUP: Export universe
  // ========================================
  exportUniverse: async () => {
    const { usePreferenceStore: PrefStore } = await import('./preferenceStore');
    const { usePlayerStore: PlayerStore } = await import('./playerStore');
    const preferences = PrefStore.getState();
    const player = PlayerStore.getState();
    const { currentUsername } = get();

    return {
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      username: currentUsername || 'anonymous',
      preferences: {
        trackPreferences: preferences.trackPreferences,
        artistPreferences: preferences.artistPreferences,
        tagPreferences: preferences.tagPreferences,
        moodPreferences: preferences.moodPreferences,
      },
      player: {
        currentTrackId: player.currentTrack?.trackId,
        currentTime: player.currentTime,
        volume: player.volume,
        boostProfile: player.boostProfile,
        shuffleMode: player.shuffleMode,
        repeatMode: player.repeatMode,
      },
      boostedTracks: getBoostedTrackIds(),
      playlists: [],
      history: player.history.slice(-100).map((h) => ({
        trackId: h.track.trackId || h.track.id,
        playedAt: h.playedAt,
        duration: h.duration,
      })),
    };
  },

  // ========================================
  // BACKUP: Import universe
  // ========================================
  importUniverse: async (data: UniverseData) => {
    set({ isImporting: true });

    try {
      localStorage.setItem(
        'voyo-preferences',
        JSON.stringify({
          state: {
            trackPreferences: data.preferences.trackPreferences,
            artistPreferences: data.preferences.artistPreferences,
            tagPreferences: data.preferences.tagPreferences,
            moodPreferences: data.preferences.moodPreferences,
            currentSession: null,
          },
          version: 1,
        })
      );

      localStorage.setItem(
        'voyo-player-state',
        JSON.stringify({
          currentTrackId: data.player.currentTrackId,
          currentTime: data.player.currentTime,
        })
      );
      localStorage.setItem('voyo-volume', String(data.player.volume));

      set({ isImporting: false });
      window.location.reload();
      return true;
    } catch (error) {
      devWarn('[VOYO] Import failed:', error);
      set({ isImporting: false });
      return false;
    }
  },

  // ========================================
  // BACKUP: Download as file
  // ========================================
  downloadBackup: async () => {
    set({ isExporting: true });

    const universe = await get().exportUniverse();
    const blob = new Blob([JSON.stringify(universe, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voyo-${universe.username}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const now = new Date().toISOString();
    localStorage.setItem(STORAGE_KEYS.lastBackup, now);
    set({ isExporting: false, lastBackupAt: now });
  },

  // ========================================
  // BACKUP: Generate passphrase
  // ========================================
  generatePassphrase,

  // ========================================
  // BACKUP: Save encrypted to cloud
  // ========================================
  saveToCloud: async (passphrase: string) => {
    try {
      const universe = await get().exportUniverse();
      const encrypted = await encryptData(JSON.stringify(universe), passphrase);
      const hash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(passphrase)
      );
      const hashHex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);

      localStorage.setItem(`voyo-backup-${hashHex}`, encrypted);

      const now = new Date().toISOString();
      localStorage.setItem(STORAGE_KEYS.lastBackup, now);
      set({ lastBackupAt: now });

      return true;
    } catch (error) {
      devWarn('[VOYO] Backup failed:', error);
      return false;
    }
  },

  // ========================================
  // BACKUP: Restore from passphrase
  // ========================================
  restoreFromCloud: async (passphrase: string) => {
    try {
      const hash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(passphrase)
      );
      const hashHex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);

      const encrypted = localStorage.getItem(`voyo-backup-${hashHex}`);
      if (!encrypted) return false;

      const decrypted = await decryptData(encrypted, passphrase);
      if (!decrypted) return false;

      const universe = JSON.parse(decrypted) as UniverseData;
      return get().importUniverse(universe);
    } catch (error) {
      devWarn('[VOYO] Restore failed:', error);
      return false;
    }
  },
}));

export default useUniverseStore;

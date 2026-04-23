/**
 * VOYO Universe Panel
 *
 * voyomusic.com/:dashId management
 * Auth via DASH Command Center
 */

import { useState, useEffect, useRef } from 'react';
import { devWarn } from '../../utils/logger';
import {
  X, Download, Upload, Key, Users, Music, Heart, Clock, Zap,
  Copy, Check, RefreshCw, Shield, Globe, Smartphone, LogIn,
  UserPlus, LogOut, Lock, Edit3, Camera, Save, Search, Trash2
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { usePreferenceStore } from '../../store/preferenceStore';
import { profileAPI, formatVoyoId } from '../../lib/voyo-api';
import { UserSearch } from './UserSearch';
import { openCommandCenterForSSO } from '../../lib/dash-auth';
import { VoyoCloseX } from '../ui/VoyoCloseX';
import { useBackGuard } from '../../hooks/useBackGuard';

interface UniversePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UniversePanel = ({ isOpen, onClose }: UniversePanelProps) => {
  useBackGuard(isOpen, onClose, 'universe-panel');
  const { isLoggedIn, dashId, voyoId, displayName, signOut, signIn, isLoading: authLoading, error: authError } = useAuth();
  const trackPreferences = usePreferenceStore(s => s.trackPreferences);

  // Tab state - show auth if not logged in, stats if logged in
  const [activeTab, setActiveTab] = useState<'auth' | 'stats' | 'profile' | 'portal' | 'discover'>(isLoggedIn ? 'stats' : 'auth');

  // Sign-in form state - check URL for prefilled dashId
  const [signInDashId, setSignInDashId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const prefilled = params.get('dashId')?.toUpperCase() || '';
    // Clean URL after reading (remove dashId param)
    if (prefilled) {
      const url = new URL(window.location.href);
      url.searchParams.delete('dashId');
      url.searchParams.delete('from');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
    return prefilled;
  });
  const [signInPin, setSignInPin] = useState('');

  // Profile edit state
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Avatar upload state
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // Portal state
  const [isPortalOpen, setIsPortalOpen] = useState(false);
  const [portalUrl, setPortalUrl] = useState('');

  // UI state
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Handle sign-in form submit
  const handleSignIn = async () => {
    if (!signInDashId.trim() || !signInPin.trim()) return;
    const success = await signIn(signInDashId.trim().toUpperCase(), signInPin.trim());
    if (success) {
      setSignInDashId('');
      setSignInPin('');
      setActiveTab('stats');
      setMessage({ type: 'success', text: 'Signed in!' });
    }
  };

  // Calculate stats
  const stats = {
    tracksPlayed: Object.keys(trackPreferences).length,
    totalListens: Object.values(trackPreferences).reduce((sum, p) => sum + p.totalListens, 0),
    totalReactions: Object.values(trackPreferences).reduce((sum, p) => sum + p.reactions, 0),
    likedTracks: Object.values(trackPreferences).filter(p => p.explicitLike === true).length,
    completions: Object.values(trackPreferences).reduce((sum, p) => sum + p.completions, 0),
    skips: Object.values(trackPreferences).reduce((sum, p) => sum + p.skips, 0),
    totalMinutes: Math.round(Object.values(trackPreferences).reduce((sum, p) => sum + p.totalDuration, 0) / 60)
  };

  // Update active tab when login state changes
  useEffect(() => {
    if (isLoggedIn && activeTab === 'auth') {
      setActiveTab('stats');
    }
  }, [isLoggedIn, activeTab]);

  // If dashId prefilled from URL and not logged in, show auth tab
  useEffect(() => {
    if (signInDashId && !isLoggedIn && isOpen) {
      setActiveTab('auth');
    }
  }, [signInDashId, isLoggedIn, isOpen]);

  // Load profile data when profile tab opens
  useEffect(() => {
    if (activeTab === 'profile' && isLoggedIn && dashId && !profileLoaded) {
      const loadProfile = async () => {
        const profile = await profileAPI.getProfile(dashId);
        if (profile) {
          setEditDisplayName(profile.preferences?.display_name || displayName || '');
          setEditBio(profile.preferences?.bio || '');
          setEditAvatarUrl(profile.preferences?.avatar_url || '');
          setIsPortalOpen(profile.portal_open || false);
          setProfileLoaded(true);
        }
      };
      loadProfile();
    }
  }, [activeTab, isLoggedIn, dashId, displayName, profileLoaded]);

  // Handle save profile
  const handleSaveProfile = async () => {
    if (!dashId || isSavingProfile) return; // idempotency guard
    setIsSavingProfile(true);
    try {
      const success = await profileAPI.updatePreferences(dashId, {
        display_name: editDisplayName,
        bio: editBio,
        avatar_url: editAvatarUrl || null,
      } as any);
      if (success) {
        setMessage({ type: 'success', text: 'Profile updated!' });
      } else {
        setMessage({ type: 'error', text: 'Failed to save profile' });
      }
    } catch (err) {
      devWarn('[UniversePanel] save profile threw:', err);
      setMessage({ type: 'error', text: 'Could not save — try again' });
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Handle logout
  const handleLogout = () => {
    signOut();
    setActiveTab('auth');
    setProfileLoaded(false);
    setMessage({ type: 'success', text: 'Logged out' });
  };

  // Open/close portal
  const handleTogglePortal = async () => {
    if (!dashId) return;

    const newState = !isPortalOpen;
    try {
      const success = await profileAPI.setPortalOpen(dashId, newState);
      if (!success) {
        // Don't claim success when the backend rejected the toggle.
        setMessage({ type: 'error', text: 'Could not update portal state' });
        return;
      }
      setIsPortalOpen(newState);
      if (newState) {
        setPortalUrl(`${window.location.origin}/${dashId}`);
        setMessage({ type: 'success', text: 'Portal opened!' });
      } else {
        setPortalUrl('');
        setMessage({ type: 'success', text: 'Portal closed' });
      }
    } catch (err) {
      devWarn('[UniversePanel] toggle portal threw:', err);
      setMessage({ type: 'error', text: 'Network error — try again' });
    }
  };

  // Copy to clipboard
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Clear message after 3s
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-[voyo-fade-in_0.3s_ease]"
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" onClick={onClose} />

          <div
            className="relative w-full max-w-md bg-gradient-to-b from-[#1a1a2e] to-[#0a0a0f] rounded-3xl overflow-hidden border border-white/10 animate-[voyo-scale-in_0.3s_ease]"
          >
            {/* Header */}
            <div className="relative p-6 pb-4 border-b border-white/10">
              <div className="absolute right-4 top-4">
                <VoyoCloseX onClose={onClose} size="md" />
              </div>

              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                  <Globe className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-xl">
                    {isLoggedIn ? 'My Verse' : 'VOYO Verse'}
                  </h2>
                  <p className="text-white/50 text-sm">
                    {isLoggedIn
                      ? `voyomusic.com/${dashId}`
                      : 'Sign in with DASH'}
                  </p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/10">
              {(isLoggedIn
                ? [
                    { id: 'stats', icon: Music, label: 'Stats' },
                    { id: 'discover', icon: Search, label: 'Find' },
                    { id: 'profile', icon: Edit3, label: 'Profile' },
                    { id: 'portal', icon: Users, label: 'Portal' },
                  ]
                : [{ id: 'auth', icon: LogIn, label: 'Login' }]
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex-1 py-3 flex items-center justify-center gap-2 transition-colors ${
                    activeTab === tab.id
                      ? 'text-white border-b-2 border-purple-500'
                      : 'text-white/50 hover:text-white/70'
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  <span className="text-sm">{tab.label}</span>
                </button>
              ))}
              {isLoggedIn && (
                <button
                  onClick={handleLogout}
                  className="px-4 py-3 flex items-center justify-center text-white/40 hover:text-red-400 transition-colors"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Content */}
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              {/* Message Toast */}
              <>
                {message && (
                  <div
                    className={`mb-4 p-3 rounded-xl text-sm animate-[voyo-fade-in_0.3s_ease] ${
                      message.type === 'success'
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {message.text}
                  </div>
                )}
              </>

              {/* AUTH TAB - Single SSO path */}
              {activeTab === 'auth' && (
                <div className="space-y-6">
                  <div className="text-center">
                    <h3 className="text-white text-lg font-bold mb-2">Sign in with DASH</h3>
                    <p className="text-white/50 text-sm">
                      Your music universe across the DASH ecosystem
                    </p>
                  </div>

                  {/* Single Sign-In Button - redirects to Command Center */}
                  <button
                    onClick={() => openCommandCenterForSSO()}
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-purple-500 to-violet-600 text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                  >
                    <LogIn className="w-5 h-5" />
                    Sign In with DASH
                  </button>

                  <p className="text-center text-white/30 text-xs">
                    One identity across VOYO, DashTV, Dash Edu & more
                  </p>
                </div>
              )}

              {/* STATS TAB */}
              {activeTab === 'stats' && isLoggedIn && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <div className="flex items-center gap-2 text-purple-400 mb-2">
                        <Music className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wider">Tracks</span>
                      </div>
                      <p className="text-white text-2xl font-bold">{stats.tracksPlayed}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <div className="flex items-center gap-2 text-purple-400 mb-2">
                        <Heart className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wider">Liked</span>
                      </div>
                      <p className="text-white text-2xl font-bold">{stats.likedTracks}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <div className="flex items-center gap-2 text-violet-400 mb-2">
                        <Clock className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wider">Minutes</span>
                      </div>
                      <p className="text-white text-2xl font-bold">{stats.totalMinutes}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <div className="flex items-center gap-2 text-[#D4A053] mb-2">
                        <Zap className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wider">OYEs</span>
                      </div>
                      <p className="text-white text-2xl font-bold">{stats.totalReactions}</p>
                    </div>
                  </div>

                  {/* Completion Rate */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-white/70 text-sm">Completion Rate</span>
                      <span className="text-white font-bold">
                        {stats.totalListens > 0
                          ? Math.round((stats.completions / stats.totalListens) * 100)
                          : 0}%
                      </span>
                    </div>
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-violet-600 rounded-full"
                        style={{
                          width: `${stats.totalListens > 0
                            ? (stats.completions / stats.totalListens) * 100
                            : 0}%`
                        }}
                      />
                    </div>
                  </div>

                  {/* Share URL */}
                  <div className="p-4 rounded-xl bg-gradient-to-r from-purple-500/10 to-[#D4A053]/10 border border-purple-500/20">
                    <p className="text-white/50 text-xs mb-2">Your Verse URL</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-white text-sm">
                        voyomusic.com/{dashId}
                      </code>
                      <button
                        onClick={() => handleCopy(`${window.location.origin}/${dashId}`)}
                        className="p-2 rounded-lg bg-white/10 hover:bg-white/20"
                      >
                        {copied ? <Check className="w-4 h-4 text-purple-400" /> : <Copy className="w-4 h-4 text-white/70" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* DISCOVER TAB */}
              {activeTab === 'discover' && isLoggedIn && (
                <UserSearch
                  onSelectUser={(selectedDashId) => {
                    window.location.href = `/${selectedDashId}`;
                  }}
                />
              )}

              {/* PROFILE TAB */}
              {activeTab === 'profile' && isLoggedIn && (
                <div className="space-y-4">
                  {/* Avatar */}
                  <div className="flex flex-col items-center">
                    <div className="relative mb-4">
                      {editAvatarUrl ? (
                        <img
                          src={editAvatarUrl}
                          alt="Avatar"
                          className="w-24 h-24 rounded-full object-cover ring-4 ring-purple-500/30"
                          onError={() => setEditAvatarUrl('')}
                        />
                      ) : (
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center ring-4 ring-purple-500/30">
                          <span className="text-3xl font-bold text-white">
                            {editDisplayName?.charAt(0)?.toUpperCase() || dashId?.charAt(0)?.toUpperCase() || 'V'}
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="text-white/40 text-sm">{voyoId}</p>
                  </div>

                  {/* Display Name */}
                  <div>
                    <label className="text-white/50 text-xs uppercase tracking-wider mb-2 block">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value)}
                      placeholder="Your display name"
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500/50"
                    />
                  </div>

                  {/* Bio */}
                  <div>
                    <label className="text-white/50 text-xs uppercase tracking-wider mb-2 block">
                      Bio
                    </label>
                    <textarea
                      value={editBio}
                      onChange={(e) => setEditBio(e.target.value)}
                      placeholder="Tell the world about your music taste..."
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500/50 resize-none"
                    />
                    <p className="text-white/30 text-xs mt-1">{editBio.length}/150</p>
                  </div>

                  {/* Save Button */}
                  <button
                    onClick={handleSaveProfile}
                    disabled={isSavingProfile}
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-purple-500 to-violet-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isSavingProfile ? (
                      <RefreshCw className="w-5 h-5 animate-spin" />
                    ) : (
                      <Save className="w-5 h-5" />
                    )}
                    {isSavingProfile ? 'Saving...' : 'Save Profile'}
                  </button>

                  {/* Preview Link */}
                  <div className="text-center">
                    <a
                      href={`/${dashId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-400 text-sm hover:underline"
                    >
                      Preview your public profile
                    </a>
                  </div>
                </div>
              )}

              {/* PORTAL TAB */}
              {activeTab === 'portal' && isLoggedIn && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-gradient-to-r from-purple-500/10 to-[#D4A053]/10 border border-purple-500/20">
                    <h3 className="text-white font-semibold mb-2">What is a Portal?</h3>
                    <p className="text-white/70 text-sm">
                      Open your portal to let friends join your listening session in real-time.
                    </p>
                  </div>

                  {isPortalOpen ? (
                    <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-purple-500 animate-pulse" />
                          <span className="text-purple-400 font-semibold">Portal Open</span>
                        </div>
                        <button
                          onClick={handleTogglePortal}
                          className="px-3 py-1 rounded-lg bg-red-500/20 text-red-400 text-sm hover:bg-red-500/30"
                        >
                          Close
                        </button>
                      </div>

                      <div className="p-3 rounded-xl bg-black/30 border border-white/10">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-white/50 text-xs">PORTAL LINK</span>
                          <button onClick={() => handleCopy(portalUrl)} className="text-purple-400 hover:text-purple-300">
                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                        <p className="text-white text-sm truncate">{portalUrl}</p>
                      </div>

                      {/* QR Code */}
                      <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
                        <div className="w-40 h-40 mx-auto bg-white rounded-xl overflow-hidden flex items-center justify-center p-2">
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(portalUrl)}&bgcolor=ffffff&color=7c3aed&format=svg`}
                            alt="Portal QR Code"
                            className="w-full h-full"
                          />
                        </div>
                        <p className="text-white/50 text-sm mt-2">Scan to join portal</p>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={handleTogglePortal}
                      className="w-full py-4 rounded-xl bg-gradient-to-r from-purple-500 to-violet-600 text-white flex items-center justify-center gap-2"
                    >
                      <Globe className="w-5 h-5" />
                      Open My Portal
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default UniversePanel;

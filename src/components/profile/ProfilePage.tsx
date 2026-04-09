/**
 * VOYO Profile Page - voyomusic.com/:dashId
 *
 * The URL is your DASH ID (e.g., voyomusic.com/0046AAD)
 * Display shows VOYO ID: V0046AAD
 *
 * Features:
 * - View anyone's public profile + live portal
 * - Sign in via Command Center for full access
 * - Join portal → sync playback with host
 * - Add friends via Command Center
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Play, Pause, Music2, Radio, Lock, Unlock, Eye, Users,
  ArrowLeft, User, Edit3, Heart, Share2, ExternalLink, QrCode, Copy, Check, X
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { usePlayerStore } from '../../store/playerStore';
import { profileAPI, friendsAPI, NowPlaying } from '../../lib/voyo-api';
import { openCommandCenterForSSO } from '../../lib/dash-auth';
import type { VoyoProfile } from '../../lib/voyo-api';
import { PortalChat } from '../portal/PortalChat';

export const ProfilePage = () => {
  // URL param is now dash_id (e.g., /0046AAD)
  const { username: urlDashId } = useParams<{ username: string }>();
  const navigate = useNavigate();

  // Auth from Command Center
  const { isLoggedIn, dashId: myDashId } = useAuth();

  // Local state for viewing universe
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Player store
  const setCurrentTrack = usePlayerStore(s => s.setCurrentTrack);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);

  // Local state
  const [profile, setProfile] = useState<VoyoProfile | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [portalOpen, setPortalOpen] = useState(false);
  const [showPinInput, setShowPinInput] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);

  // Follow state
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowLoading, setIsFollowLoading] = useState(false);

  // Generate profile URL (uses DASH ID)
  const profileUrl = `${window.location.origin}/${urlDashId}`;
  const voyoId = urlDashId ? `V${urlDashId}` : '';

  // Copy to clipboard
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Native share
  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${voyoId}'s VOYO`,
          text: portalOpen ? 'Listen along with me on VOYO!' : 'Check out my VOYO profile',
          url: profileUrl,
        });
      } catch {
        // User cancelled or error
      }
    } else {
      setShowShareModal(true);
    }
  };

  // Check if viewing own profile (compare DASH IDs)
  const isOwnProfile = myDashId?.toLowerCase() === urlDashId?.toLowerCase();

  // Load profile on mount
  useEffect(() => {
    if (!urlDashId) return;

    const loadProfile = async () => {
      setLoadingProfile(true);

      try {
        // Fetch VOYO profile using dash_id
        const voyoProfile = await profileAPI.getProfile(urlDashId);

        if (voyoProfile) {
          setProfile(voyoProfile);
          setNowPlaying(voyoProfile.now_playing || null);
          setPortalOpen(voyoProfile.portal_open || false);
        }
      } catch (err) {
        console.error('[ProfilePage] Failed to load profile:', err);
      }

      setLoadingProfile(false);
    };

    loadProfile();

    // TODO: Subscribe to real-time updates if portal is open
    // This would need a Supabase realtime subscription on voyo_profiles
  }, [urlDashId]);

  // Load friend status (friends are global in Command Center)
  useEffect(() => {
    if (!urlDashId || !myDashId || isOwnProfile) return;

    const loadFriendStatus = async () => {
      try {
        // Check if this person is in my friends list (Command Center)
        const friends = await friendsAPI.getFriends(myDashId);
        const isFriend = friends.some(f => f.dash_id.toLowerCase() === urlDashId?.toLowerCase());
        setIsFollowing(isFriend);
        // Friend counts would come from Command Center API in future
        setFollowerCount(0);
        setFollowingCount(0);
      } catch (err) {
        console.error('[ProfilePage] Failed to load friend status:', err);
      }
    };
    loadFriendStatus();
  }, [urlDashId, myDashId, isOwnProfile]);

  // Handle add/remove friend (opens Command Center since friends are global)
  const handleFollowToggle = async () => {
    if (!urlDashId || !myDashId || isFollowLoading) return;

    // Friends are managed in Command Center - open it for add/remove
    // For now, we'll open Command Center hub
    window.open(`https://hub.dasuperhub.com/friends?add=${urlDashId}`, '_blank');
    // The UI won't update immediately - would need to refresh or add real-time sync
  };

  // Portal sync state
  const [hasJoinedPortal, setHasJoinedPortal] = useState(false);
  const lastTrackIdRef = useRef<string | null>(null);

  // TODO: Implement real-time portal sync via Supabase subscription
  // For now, portal viewing works one-way (see what host is playing, join to sync)

  // Handle PIN login (redirects to Command Center with SSO)
  const handlePinLogin = () => {
    openCommandCenterForSSO();
  };

  // Handle join portal (sync playback)
  const handleJoinPortal = async () => {
    if (!nowPlaying) return;

    // Create a track object from nowPlaying
    const track = {
      id: nowPlaying.trackId,
      trackId: nowPlaying.trackId,
      title: nowPlaying.title,
      artist: nowPlaying.artist,
      coverUrl: nowPlaying.thumbnail,
    };

    // Set as current track and play
    setCurrentTrack(track as any);

    // Mark as joined - enables auto-sync for future track changes
    setHasJoinedPortal(true);
    lastTrackIdRef.current = nowPlaying.trackId;
  };

  // Loading state
  if (loadingProfile) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center">
        <div
          className="w-16 h-16 rounded-full border-4 border-purple-500/30 border-t-purple-500"
        />
      </div>
    );
  }

  // Not found
  if (!profile) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center p-8">
        <div className="text-center">
          <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-white/5 flex items-center justify-center">
            <User className="w-12 h-12 text-white/20" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Profile not found</h1>
          <p className="text-white/50 mb-4">{voyoId} hasn't joined VOYO yet</p>
          <p className="text-white/30 text-sm mb-8">
            Know them? Invite them to VOYO Music!
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold"
          >
            Open VOYO
          </button>
        </div>
      </div>
    );
  }

  // Extract preferences for cleaner access
  const displayName = profile.preferences?.display_name || voyoId;
  const bio = profile.preferences?.bio || '';
  const avatarUrl = profile.preferences?.avatar_url || '';

  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#0a0a0c]/80 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => navigate('/')} className="p-2 -ml-2">
            <ArrowLeft className="w-5 h-5 text-white/70" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-white/60 text-sm font-medium">voyomusic.com/</span>
            <span className="text-white text-sm font-bold">{urlDashId}</span>
          </div>
          <div className="w-9" /> {/* Spacer */}
        </div>
      </div>

      {/* Profile Content */}
      <div className="px-5 py-6">
        {/* Avatar & Info */}
        <div className="flex flex-col items-center text-center mb-8">
          {/* Avatar */}
          <div className="relative mb-4">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-28 h-28 rounded-full object-cover ring-4 ring-purple-500/30"
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center ring-4 ring-purple-500/30">
                <span className="text-4xl font-bold text-white">
                  {displayName?.charAt(0)?.toUpperCase() || 'V'}
                </span>
              </div>
            )}

            {/* Portal indicator */}
            {portalOpen && (
              <div
                className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-purple-500 border-4 border-[#0a0a0f] flex items-center justify-center"
              >
                <Radio className="w-4 h-4 text-white" />
              </div>
            )}
          </div>

          {/* Name & Bio */}
          <h1 className="text-2xl font-bold text-white mb-1">{displayName}</h1>
          <p className="text-white/40 text-sm mb-4">{voyoId}</p>
          {bio && (
            <p className="text-white/60 text-sm max-w-xs mb-4">{bio}</p>
          )}

          {/* Follower Stats */}
          {!isOwnProfile && (
            <div className="flex gap-6 mb-4">
              <div className="text-center">
                <p className="text-white font-bold">{followerCount}</p>
                <p className="text-white/40 text-xs">followers</p>
              </div>
              <div className="text-center">
                <p className="text-white font-bold">{followingCount}</p>
                <p className="text-white/40 text-xs">following</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            {isOwnProfile ? (
              <button
                onClick={() => navigate('/')}
                className="px-5 py-2 rounded-full bg-white text-black font-semibold text-sm flex items-center gap-2"
              >
                <Edit3 className="w-4 h-4" />
                Edit Profile
              </button>
            ) : (
              <>
                {/* Add Friend Button (opens Command Center) */}
                {myDashId && (
                  <button
                    onClick={handleFollowToggle}
                    disabled={isFollowLoading}
                    className={`px-5 py-2 rounded-full font-semibold text-sm flex items-center gap-2 ${
                      isFollowing
                        ? 'bg-white/10 text-white border border-white/20'
                        : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                    }`}
                  >
                    {isFollowLoading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : isFollowing ? (
                      <>
                        <Check className="w-4 h-4" />
                        Friends
                      </>
                    ) : (
                      <>
                        <Users className="w-4 h-4" />
                        Add Friend
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={handleShare}
                  className="px-5 py-2 rounded-full bg-white/10 text-white font-semibold text-sm flex items-center gap-2 border border-white/20"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </button>
              </>
            )}
          </div>
        </div>

        {/* NOW PLAYING - Portal */}
        {portalOpen && nowPlaying ? (
          <div
            className="mb-8"
          >
            <div className="flex items-center gap-2 mb-4">
              <div
                className="w-2 h-2 rounded-full bg-purple-400"
              />
              <p className="text-purple-400 text-xs font-semibold uppercase tracking-wider">
                Portal Open • Live
              </p>
              <div className="flex items-center gap-1 text-white/40 text-xs ml-auto">
                <Eye className="w-3 h-3" />
                <span>watching</span>
              </div>
            </div>

            {/* Now Playing Card */}
            <div className="relative rounded-3xl overflow-hidden bg-gradient-to-b from-white/[0.08] to-white/[0.02] border border-white/10">
              {/* Album Art Background */}
              <div className="absolute inset-0 opacity-30">
                <img
                  src={nowPlaying.thumbnail}
                  alt=""
                  className="w-full h-full object-cover blur-2xl"
                />
              </div>

              <div className="relative p-5">
                <div className="flex items-center gap-4">
                  {/* Album Art */}
                  <div className="relative flex-shrink-0">
                    <img
                      src={nowPlaying.thumbnail}
                      alt={nowPlaying.title}
                      className="w-24 h-24 rounded-xl object-cover shadow-2xl"
                    />
                    {nowPlaying.isPlaying && (
                      <div className="absolute bottom-2 left-2 flex gap-0.5">
                        {[...Array(3)].map((_, i) => (
                          <div
                            key={i}
                            className="w-1 bg-white rounded-full"
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Track Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-lg truncate">{nowPlaying.title}</p>
                    <p className="text-white/60 text-sm truncate mb-3">{nowPlaying.artist}</p>

                    {/* Progress */}
                    <div className="space-y-1">
                      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
                          style={{ width: `${(nowPlaying.currentTime / nowPlaying.duration) * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-white/40">
                        <span>{formatTime(nowPlaying.currentTime)}</span>
                        <span>{formatTime(nowPlaying.duration)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Join Button */}
                <button
                  onClick={handleJoinPortal}
                  className={`w-full mt-4 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 ${
                    hasJoinedPortal
                      ? 'bg-purple-500/20 border border-purple-500/30 text-purple-400'
                      : 'bg-gradient-to-r from-purple-500 to-violet-600 text-white'
                  }`}
                >
                  {hasJoinedPortal ? (
                    <>
                      <Radio className="w-5 h-5" />
                      Synced • Following Along
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5" fill="white" />
                      Join Portal • Listen Along
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Portal Closed / Not Playing */
          <div className="mb-8 p-8 rounded-3xl bg-white/[0.03] border border-white/5 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
              <Music2 className="w-8 h-8 text-white/30" />
            </div>
            <p className="text-white/40 mb-1">Portal is closed</p>
            <p className="text-white/20 text-sm">Check back later to listen along!</p>
          </div>
        )}

        {/* Liked Tracks */}
        {profile.likes && profile.likes.length > 0 && (
          <div className="mb-8">
            <p className="text-white/40 text-xs font-medium uppercase tracking-wider mb-4">
              Liked Tracks
            </p>
            <div className="space-y-2">
              {profile.likes.slice(0, 5).map((trackId, i) => (
                <div
                  key={trackId}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
                >
                  <span className="text-white/30 text-sm font-bold w-6">{i + 1}</span>
                  <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                    <Music2 className="w-5 h-5 text-white/40" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white/80 text-sm font-medium truncate">{trackId}</p>
                  </div>
                  <Heart className="w-4 h-4 text-purple-500" fill="#8b5cf6" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Open App CTA */}
        <div className="text-center py-8">
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 rounded-full bg-white/10 text-white font-semibold flex items-center gap-2 mx-auto border border-white/20"
          >
            <ExternalLink className="w-4 h-4" />
            Open VOYO Music
          </button>
        </div>
      </div>

      {/* PIN Input Modal */}
      
        {showPinInput && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowPinInput(false)}
            />

            {/* Modal */}
            <div
              className="relative w-full max-w-sm bg-gradient-to-b from-[#1a1a2e] to-[#0f0f16] rounded-3xl border border-purple-500/20 p-6"
            >
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <Lock className="w-8 h-8 text-purple-400" />
                </div>
                <h2 className="text-xl font-bold text-white mb-1">Sign In with DASH</h2>
                <p className="text-white/50 text-sm">
                  Sign in via Command Center to access {voyoId}
                </p>
              </div>

              {/* PIN Input */}
              <div className="mb-4">
                <input
                  type="password"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && handlePinLogin()}
                  className="w-full px-4 py-4 text-center text-2xl font-bold tracking-[0.5em] bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50"
                  placeholder="••••••"
                  autoFocus
                />
                {pinError && (
                  <p className="text-red-400 text-sm mt-2 text-center">{pinError}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPinInput(false)}
                  className="flex-1 py-3 rounded-xl bg-white/10 text-white font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePinLogin}
                  disabled={pin.length !== 6 || isLoading}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold disabled:opacity-50"
                >
                  {isLoading ? 'Verifying...' : 'Unlock'}
                </button>
              </div>
            </div>
          </div>
        )}
      

      {/* Share Modal with QR Code */}
      
        {showShareModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowShareModal(false)}
            />

            {/* Modal */}
            <div
              className="relative w-full max-w-sm bg-gradient-to-b from-[#1a1a2e] to-[#0f0f16] rounded-3xl border border-purple-500/20 p-6"
            >
              {/* Close button */}
              <button
                onClick={() => setShowShareModal(false)}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20"
              >
                <X className="w-4 h-4 text-white/70" />
              </button>

              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <QrCode className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-xl font-bold text-white mb-1">Share Profile</h2>
                <p className="text-white/50 text-sm">
                  {portalOpen ? 'Invite friends to listen along!' : `Share ${voyoId}'s profile`}
                </p>
              </div>

              {/* QR Code */}
              <div className="p-4 rounded-xl bg-white mx-auto w-48 h-48 mb-4">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(profileUrl)}&bgcolor=ffffff&color=7c3aed&format=svg`}
                  alt="Profile QR Code"
                  className="w-full h-full"
                />
              </div>

              {/* URL Display */}
              <div className="p-3 rounded-xl bg-black/30 border border-white/10 mb-4">
                <div className="flex items-center justify-between">
                  <code className="text-white/80 text-sm truncate flex-1 mr-2">
                    voyomusic.com/{urlDashId}
                  </code>
                  <button
                    onClick={() => handleCopy(profileUrl)}
                    className="p-2 rounded-lg bg-white/10 hover:bg-white/20"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-white/70" />
                    )}
                  </button>
                </div>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleCopy(profileUrl)}
                  className="py-3 rounded-xl bg-white/10 text-white font-semibold flex items-center justify-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Copy Link
                </button>
                <button
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({
                        title: `${voyoId}'s VOYO`,
                        text: portalOpen ? 'Listen along with me!' : 'Check out my VOYO',
                        url: profileUrl,
                      });
                    }
                    }}
                  className="py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold flex items-center justify-center gap-2"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </button>
              </div>
            </div>
          </div>
        )}
      

      {/* Footer */}
      <div className="px-5 py-8 text-center border-t border-white/5">
        <p className="text-2xl font-black bg-gradient-to-r from-purple-400 via-pink-500 to-purple-600 bg-clip-text text-transparent mb-2">
          VOYO
        </p>
        <p className="text-white/30 text-xs">The African Music Experience</p>
      </div>

      {/* Portal Chat - Shows when portal is open and user joined */}
      {portalOpen && hasJoinedPortal && urlDashId && myDashId && (
        <PortalChat
          portalOwner={urlDashId}
          currentUser={myDashId}
          isPortalOpen={portalOpen}
        />
      )}
    </div>
  );
};

// Helper to format time
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default ProfilePage;

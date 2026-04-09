/**
 * VOYO DAHUB - Music Social Hub
 *
 * Uses unified DahubCore for Friends/Messages/Activity
 * Adds VOYO-specific features:
 * - Notes (Instagram-style)
 * - Following (Artists/Celebrities)
 * - Stories (with now_playing)
 * - Profile card with current track
 *
 * Activity filtered to music only (appContext='V')
 */

import { useState, useEffect } from 'react';
import {
  Settings, Plus, X, Play, Pause,
  Send, Heart, ChevronRight, BadgeCheck, Music2, User
} from 'lucide-react';
import { DahubCore } from './DahubCore';
import { APP_CODES, presenceAPI } from '../../lib/dahub/dahub-api';
import { usePlayerStore } from '../../store/playerStore';
import { getYouTubeThumbnail } from '../../data/tracks';

// ==============================================
// VOYO-SPECIFIC DATA (Mock for now)
// ==============================================

const AVATARS = {
  dash: '/dash-profile.jpg',
  aziz: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&h=200&fit=crop&crop=face',
  kenza: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face',
  omar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&crop=face',
  sarah: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop&crop=face',
};

const CELEBRITY_AVATARS = {
  burna: 'https://i.ytimg.com/vi/421w1j87fEM/hqdefault.jpg',
  wizkid: 'https://i.ytimg.com/vi/jipQpjUA_o8/hqdefault.jpg',
  rema: 'https://i.ytimg.com/vi/WcIcVapfqXw/hqdefault.jpg',
  tems: 'https://i.ytimg.com/vi/VDcEJE633rM/hqdefault.jpg',
};

const celebrities = [
  { id: 'burna', name: 'Burna Boy', avatar: CELEBRITY_AVATARS.burna, verified: true, isLive: false },
  { id: 'wizkid', name: 'Wizkid', avatar: CELEBRITY_AVATARS.wizkid, verified: true, isLive: true },
  { id: 'rema', name: 'Rema', avatar: CELEBRITY_AVATARS.rema, verified: true, isLive: false },
  { id: 'tems', name: 'Tems', avatar: CELEBRITY_AVATARS.tems, verified: true, isLive: false },
];

const friendNotes = [
  { id: '1', friend: 'Aziz', avatar: AVATARS.aziz, note: 'vibing to Burna rn 🔥', timestamp: '2h', hasMusic: true },
  { id: '2', friend: 'Kenza', avatar: AVATARS.kenza, note: 'new playlist dropping tonight', timestamp: '4h', hasMusic: false },
  { id: '3', friend: 'Sarah', avatar: AVATARS.sarah, note: '🎧', timestamp: '6h', hasMusic: true },
  { id: '4', friend: 'Omar', avatar: AVATARS.omar, note: 'who up?', timestamp: '8h', hasMusic: false },
];

// ==============================================
// VOYO-SPECIFIC COMPONENTS
// ==============================================

/**
 * Profile Card with Now Playing
 */
function VoyoProfileCard({
  userName,
  userAvatar,
  onOpenSettings
}: {
  userName: string;
  userAvatar?: string;
  onOpenSettings: () => void;
}) {
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const queue = usePlayerStore(s => s.queue);
  const nextTrack = queue[0];

  return (
    <div className="px-6 pt-5 pb-4">
      <div
        className="relative flex items-center gap-4 p-5 rounded-3xl bg-gradient-to-br from-purple-500/[0.12] via-fuchsia-500/[0.08] to-pink-500/[0.12] border border-white/[0.08] overflow-hidden cursor-pointer"
        onClick={onOpenSettings}
      >
        {/* Glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-400/[0.03] to-pink-400/[0.03] blur-2xl" />

        {/* Avatar */}
        <div className="relative flex-shrink-0 z-10">
          <div className="relative">
            {userAvatar ? (
              <img src={userAvatar} alt="" className="w-16 h-16 rounded-full object-cover ring-2 ring-white/[0.08]" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-xl font-bold text-white ring-2 ring-white/[0.08]">
                {userName[0]?.toUpperCase()}
              </div>
            )}
            <div className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-green-500 border-[3px] border-[#0a0a0f]" />
          </div>
        </div>

        {/* Name */}
        <div className="flex-1 min-w-0 z-10">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-white font-semibold text-base">{userName}</p>
            <ChevronRight className="w-4 h-4 text-white/40" />
          </div>
          <p className="text-white/50 text-sm font-medium">Tap for account & stats</p>
        </div>

        {/* Now Playing */}
        <div className="flex items-center gap-2 z-10">
          {currentTrack?.trackId ? (
            <div className="relative w-14 h-14 rounded-xl overflow-hidden shadow-lg ring-1 ring-white/[0.1]">
              <img src={getYouTubeThumbnail(currentTrack.trackId, 'medium')} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              <div className="absolute top-1.5 left-1.5 flex gap-0.5">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="w-0.5 bg-white rounded-full"
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center ring-1 ring-white/[0.1]">
              <Music2 className="w-6 h-6 text-white/30" />
            </div>
          )}
          {nextTrack?.track?.trackId ? (
            <div className="relative w-11 h-11 rounded-lg overflow-hidden opacity-50 ring-1 ring-white/[0.05]">
              <img src={getYouTubeThumbnail(nextTrack.track.trackId, 'medium')} alt="" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-11 h-11 rounded-lg bg-white/5 opacity-50 ring-1 ring-white/[0.05]" />
          )}
          <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center ml-1">
            <User className="w-4 h-4 text-white/60" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Notes Section (Instagram-style)
 */
function NotesSection({
  myNote,
  onEditNote
}: {
  myNote: string;
  onEditNote: () => void;
}) {
  return (
    <div className="px-6 pb-4">
      {/* My Note */}
      <button
        onClick={onEditNote}
        className="flex flex-col items-center mr-4"
      >
        <div className="relative mb-1">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 border-2 border-dashed border-white/20 flex items-center justify-center">
            {myNote ? (
              <span className="text-2xl">{myNote.slice(0, 2)}</span>
            ) : (
              <Plus className="w-6 h-6 text-white/40" />
            )}
          </div>
        </div>
        <p className="text-white/50 text-[10px]">Your note</p>
      </button>

      {/* Friends' Notes */}
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide mt-4">
        {friendNotes.map(note => (
          <div
            key={note.id}
            className="flex flex-col items-center flex-shrink-0"
          >
            <div className="relative mb-1">
              {/* Note bubble */}
              <div
                className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded-xl bg-gradient-to-r from-purple-500/30 to-pink-500/30 border border-purple-500/40 whitespace-nowrap max-w-[100px]"
              >
                <p className="text-white text-[10px] truncate">{note.note}</p>
                {/* Tail */}
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gradient-to-br from-purple-500/30 to-pink-500/30 rotate-45 border-r border-b border-purple-500/40" />
              </div>
              {/* Avatar */}
              <div className="w-14 h-14 rounded-full overflow-hidden ring-2 ring-purple-500/30">
                <img src={note.avatar} alt="" className="w-full h-full object-cover" />
              </div>
              {note.hasMusic && (
                <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center border-2 border-[#0a0a0f]">
                  <Music2 className="w-2.5 h-2.5 text-white" />
                </div>
              )}
            </div>
            <p className="text-white/60 text-[10px] mt-3">{note.friend}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Following Section (Artists/Celebrities)
 */
function FollowingSection() {
  return (
    <div className="px-6 pb-4">
      <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Following</p>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {celebrities.map(artist => (
          <button
            key={artist.id}
            className="flex flex-col items-center flex-shrink-0"
          >
            <div className="relative">
              <div className={`w-16 h-16 rounded-full overflow-hidden ${artist.isLive ? 'ring-2 ring-red-500' : 'ring-2 ring-purple-500/30'}`}>
                <img src={artist.avatar} alt="" className="w-full h-full object-cover" />
              </div>
              {artist.verified && (
                <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center border-2 border-[#0a0a0f]">
                  <BadgeCheck className="w-3 h-3 text-white" />
                </div>
              )}
              {artist.isLive && (
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-red-500 text-[8px] font-bold text-white">
                  LIVE
                </div>
              )}
            </div>
            <p className="text-white/70 text-[10px] mt-2 truncate max-w-[64px]">{artist.name}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ==============================================
// MAIN VOYO DAHUB COMPONENT
// ==============================================

interface VoyoDahubProps {
  userId: string;
  userName: string;
  userAvatar?: string;
}

export function VoyoDahub({ userId, userName, userAvatar }: VoyoDahubProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [myNote, setMyNote] = useState('');
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const currentTrack = usePlayerStore(s => s.currentTrack);

  // Update presence with current activity
  useEffect(() => {
    if (currentTrack) {
      presenceAPI.updatePresence(
        userId,
        'online',
        APP_CODES.VOYO,
        `Listening to ${currentTrack.title}`,
        { trackId: currentTrack.trackId, artist: currentTrack.artist }
      );
    } else {
      presenceAPI.updatePresence(userId, 'online', APP_CODES.VOYO);
    }

    return () => {
      presenceAPI.updatePresence(userId, 'offline');
    };
  }, [userId, currentTrack]);

  return (
    <>
      <DahubCore
        userId={userId}
        userName={userName}
        userAvatar={userAvatar}
        appContext={APP_CODES.VOYO}
        title="DAHUB"
        showNotes={true}
        showFollowing={true}
        renderProfileCard={() => (
          <VoyoProfileCard
            userName={userName}
            userAvatar={userAvatar}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        )}
        renderNotes={() => (
          <NotesSection
            myNote={myNote}
            onEditNote={() => {
              setNoteInput(myNote);
              setIsEditingNote(true);
              }}
          />
        )}
        renderFollowing={() => <FollowingSection />}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Note Editor Modal */}
      
        {isEditingNote && (
          <div
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-end justify-center"
            onClick={() => setIsEditingNote(false)}
          >
            <div
              className="w-full max-w-md bg-[#1a1a24] rounded-t-3xl p-6 pb-10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <button onClick={() => setIsEditingNote(false)} className="text-white/50 text-sm">Cancel</button>
                <p className="text-white font-semibold">New Note</p>
                <button
                  onClick={() => {
                    setMyNote(noteInput);
                    setIsEditingNote(false);
                    }}
                  className="text-purple-400 font-semibold text-sm"
                >
                  Share
                </button>
              </div>

              <div className="flex flex-col items-center mb-6">
                <div className="relative mb-2">
                  <div
                    className="px-4 py-2 rounded-2xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 mb-2"
                  >
                    <p className="text-white text-sm">{noteInput || 'Your note...'}</p>
                  </div>
                  {userAvatar ? (
                    <img src={userAvatar} alt="" className="w-16 h-16 rounded-full object-cover ring-2 ring-purple-500/30 mx-auto" />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-xl font-bold text-white ring-2 ring-purple-500/30 mx-auto">
                      {userName[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
              </div>

              <input
                type="text"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="Share a thought..."
                maxLength={60}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-center placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                autoFocus
              />
              <p className="text-white/30 text-xs text-center mt-2">{noteInput.length}/60</p>
            </div>
          </div>
        )}
      
    </>
  );
}

export default VoyoDahub;

import { useEffect } from 'react';
import { X, User, Settings, LogOut, LogIn } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useBackGuard } from '../../hooks/useBackGuard';
import { openCommandCenterForSSO } from '../../lib/dash-auth';

interface AccountMenuProps {
  isOpen: boolean;
  onClose: () => void;
  /** Parent opens BoostSettings — the modal lives at HomeFeed level so
   *  AccountMenu doesn't have to nest state for it. */
  onOpenSettings?: () => void;
}

export const AccountMenu = ({ isOpen, onClose, onOpenSettings }: AccountMenuProps) => {
  useBackGuard(isOpen, onClose, 'account-menu');

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const { isLoggedIn, dashId, displayName, signOut } = useAuth();

  if (!isOpen) return null;

  const handleProfile = () => {
    onClose();
    if (!dashId) return;
    // Open the DASH Command Center profile in a NEW TAB (noopener so the
    // popup can't reach back into this window). `window.location.href`
    // would unmount the entire VOYO PWA and silence audio mid-track —
    // `window.open` keeps the current tab (and its audio graph) alive.
    const returnUrl = encodeURIComponent(window.location.origin);
    const url = `https://hub.dasuperhub.com?returnUrl=${returnUrl}&app=V&dashId=${dashId}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleSettings = () => {
    onClose();
    onOpenSettings?.();
  };

  const handleSignOut = () => {
    signOut();
    onClose();
  };

  const handleSignIn = () => {
    onClose();
    openCommandCenterForSSO();
  };

  return (
    <>
      {/* Scrim — tap outside dismisses. Backdrop blur ties the modal to
          the translucent header language (matches Portrait's dark-glass). */}
      <div
        className="fixed inset-0 z-[55]"
        style={{
          background: 'rgba(0,0,0,0.52)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        }}
        onClick={onClose}
      />

      {/* Sheet — anchored top-left under the D button. On mobile: stretches
          left→right with padding; on desktop (sm+): pins to ~300px. */}
      <div
        className="fixed top-[64px] left-4 right-4 sm:right-auto sm:w-[300px] z-[56] rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, rgba(28,22,42,0.94) 0%, rgba(16,12,26,0.94) 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(139,92,246,0.12)',
          backdropFilter: 'blur(24px) saturate(160%)',
          WebkitBackdropFilter: 'blur(24px) saturate(160%)',
          animation: 'acc-menu-in 220ms cubic-bezier(0.34,1.56,0.64,1) forwards',
        }}
      >
        {/* Header — identity card */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/5">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {isLoggedIn && displayName ? displayName.charAt(0).toUpperCase() : 'V'}
          </div>
          <div className="flex-1 min-w-0">
            {isLoggedIn ? (
              <>
                <p className="text-white font-semibold text-[13px] leading-tight truncate">
                  {displayName || 'DASH'}
                </p>
                <p className="text-white/45 text-[11px] leading-tight tabular-nums mt-0.5">
                  V{dashId}
                </p>
              </>
            ) : (
              <>
                <p className="text-white font-semibold text-[13px] leading-tight">Sign in to VOYO</p>
                <p className="text-white/45 text-[11px] leading-tight mt-0.5">Sync your vibes</p>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-white/40 hover:text-white/80 active:scale-95 transition-transform flex-shrink-0"
            aria-label="Close account menu"
          >
            <X size={16} />
          </button>
        </div>

        {/* Actions */}
        <div className="py-1.5">
          {isLoggedIn ? (
            <>
              <MenuRow icon={<User size={16} />} label="View my profile" onClick={handleProfile} />
              <MenuRow icon={<Settings size={16} />} label="Settings" onClick={handleSettings} />
              <MenuRow icon={<LogOut size={16} />} label="Sign out" onClick={handleSignOut} danger />
            </>
          ) : (
            <MenuRow icon={<LogIn size={16} />} label="Sign in with DASH" onClick={handleSignIn} />
          )}
        </div>

        <style>{`
          @keyframes acc-menu-in {
            from { opacity: 0; transform: translateY(-8px) scale(0.98); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>
      </div>
    </>
  );
};

interface MenuRowProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

const MenuRow = ({ icon, label, onClick, danger }: MenuRowProps) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium transition-colors active:scale-[0.98] ${
      danger ? 'text-red-400 hover:bg-red-500/10' : 'text-white/92 hover:bg-white/5'
    }`}
  >
    <span className={danger ? 'opacity-85' : 'text-white/55'}>{icon}</span>
    <span>{label}</span>
  </button>
);

export default AccountMenu;

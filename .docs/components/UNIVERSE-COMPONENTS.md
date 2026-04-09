# VOYO Music - Universe Components Documentation

**Last Updated**: 2025-12-19
**Component Directory**: `/home/dash/voyo-music/src/components/universe/`

---

## Overview

The universe component system manages user accounts, profiles, backup, portals, and social discovery. It provides PIN-based authentication, cloud sync, and user search functionality.

---

## Component 1: UniversePanel

**File**: `/home/dash/voyo-music/src/components/universe/UniversePanel.tsx`

### Purpose
Main modal panel for managing user universe (account, profile, stats, backup, portal, user discovery). Serves as the central hub for user identity and data management.

---

### Props Interface

```typescript
interface UniversePanelProps {
  isOpen: boolean;      // Control panel visibility
  onClose: () => void;  // Close callback
}
```

---

### Dependencies & Imports

**React & Animation**:
- `useState`, `useEffect` from React
- `motion`, `AnimatePresence` from framer-motion

**Icons** (40+ icons):
- Auth: `LogIn`, `UserPlus`, `LogOut`, `AtSign`, `Lock`, `User`
- Profile: `Edit3`, `Camera`, `Save`
- Stats: `Music`, `Heart`, `Clock`, `Zap`, `Users`
- Backup: `Download`, `Upload`, `Key`, `Shield`, `RefreshCw`
- Portal: `Globe`, `Radio`, `QrCode`, `Smartphone`, `Copy`, `Check`
- Discovery: `Search`
- UI: `X`

**Store Integrations**:
- `useUniverseStore` - Auth, backup, portal management
- `usePreferenceStore` - Stats calculation

**API Layer**:
- `universeAPI` - Profile CRUD operations

**Sub-components**:
- `UserSearch` - User search component

---

### State Management

#### Tab Navigation
```typescript
const [activeTab, setActiveTab] = useState<'auth' | 'stats' | 'profile' | 'backup' | 'portal' | 'discover'>(
  isLoggedIn ? 'stats' : 'auth'
);
```

#### Profile Edit State
```typescript
const [editDisplayName, setEditDisplayName] = useState('');
const [editBio, setEditBio] = useState('');
const [editAvatarUrl, setEditAvatarUrl] = useState('');
const [isSavingProfile, setIsSavingProfile] = useState(false);
const [profileLoaded, setProfileLoaded] = useState(false);
```

#### Auth Form State
```typescript
const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
const [usernameInput, setUsernameInput] = useState('');
const [pinInput, setPinInput] = useState('');
const [displayNameInput, setDisplayNameInput] = useState('');
const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
const [checkingUsername, setCheckingUsername] = useState(false);
```

#### Backup State
```typescript
const [passphrase, setPassphrase] = useState('');
const [passphraseInput, setPassphraseInput] = useState('');
const [portalUrl, setPortalUrl] = useState('');
const [copied, setCopied] = useState(false);
const [isSaving, setIsSaving] = useState(false);
const [isRestoring, setIsRestoring] = useState(false);
```

#### UI State
```typescript
const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
```

---

### Store Subscriptions

**From useUniverseStore**:
- Auth: `isLoggedIn`, `currentUsername`, `signup()`, `login()`, `logout()`, `checkUsername()`
- Backup: `downloadBackup()`, `generatePassphrase()`, `saveToCloud()`, `restoreFromCloud()`, `lastBackupAt`
- Portal: `openPortal()`, `closePortal()`, `portalSession`, `isPortalOpen`
- Loading: `isLoading`, `error`

**From usePreferenceStore**:
- `trackPreferences` - For stats calculation

---

### Calculated Stats

```typescript
const stats = {
  tracksPlayed: Object.keys(trackPreferences).length,
  totalListens: Object.values(trackPreferences).reduce((sum, p) => sum + p.totalListens, 0),
  totalReactions: Object.values(trackPreferences).reduce((sum, p) => sum + p.reactions, 0),
  likedTracks: Object.values(trackPreferences).filter(p => p.explicitLike === true).length,
  completions: Object.values(trackPreferences).reduce((sum, p) => sum + p.completions, 0),
  skips: Object.values(trackPreferences).reduce((sum, p) => sum + p.skips, 0),
  totalMinutes: Math.round(Object.values(trackPreferences).reduce((sum, p) => sum + p.totalDuration, 0) / 60)
};
```

**Derived Metric**:
- Completion Rate: `(completions / totalListens) * 100`

---

### Core Effects

#### Effect 1: Check Username Availability (Debounced)
```typescript
useEffect(() => {
  if (authMode !== 'signup' || usernameInput.length < 3) {
    setUsernameAvailable(null);
    return;
  }

  const timer = setTimeout(async () => {
    setCheckingUsername(true);
    const available = await checkUsername(usernameInput);
    setUsernameAvailable(available);
    setCheckingUsername(false);
  }, 500);

  return () => clearTimeout(timer);
}, [usernameInput, authMode, checkUsername]);
```
**Purpose**: Real-time username validation during signup

#### Effect 2: Switch Tab on Login
```typescript
useEffect(() => {
  if (isLoggedIn && activeTab === 'auth') {
    setActiveTab('stats');
  }
}, [isLoggedIn, activeTab]);
```
**Purpose**: Auto-navigate to stats when user logs in

#### Effect 3: Load Profile Data
```typescript
useEffect(() => {
  if (activeTab === 'profile' && isLoggedIn && currentUsername && !profileLoaded) {
    const loadProfile = async () => {
      const result = await universeAPI.getPublicProfile(currentUsername);
      if (result.profile) {
        setEditDisplayName(result.profile.displayName || '');
        setEditBio(result.profile.bio || '');
        setEditAvatarUrl(result.profile.avatarUrl || '');
        setProfileLoaded(true);
      }
    };
    loadProfile();
  }
}, [activeTab, isLoggedIn, currentUsername, profileLoaded]);
```
**Purpose**: Lazy-load profile data when profile tab opens

#### Effect 4: Clear Message Timer
```typescript
useEffect(() => {
  if (message) {
    const timer = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(timer);
  }
}, [message]);
```
**Purpose**: Auto-dismiss success/error messages after 3s

#### Effect 5: Show Store Errors
```typescript
useEffect(() => {
  if (error) {
    setMessage({ type: 'error', text: error });
  }
}, [error]);
```
**Purpose**: Display errors from store in message toast

---

### Event Handlers

#### handleAuthSubmit
```typescript
const handleAuthSubmit = async () => {
  if (authMode === 'signup') {
    const success = await signup(usernameInput, pinInput, displayNameInput || undefined);
    if (success) {
      setMessage({ type: 'success', text: `Welcome to VOYO, ${usernameInput}!` });
      setUsernameInput('');
      setPinInput('');
      setDisplayNameInput('');
    }
  } else {
    const success = await login(usernameInput, pinInput);
    if (success) {
      setMessage({ type: 'success', text: 'Welcome back!' });
      setUsernameInput('');
      setPinInput('');
    }
  }
}
```
**Purpose**: Handle login or signup submission

#### handleLogout
```typescript
const handleLogout = () => {
  logout();
  setActiveTab('auth');
  setProfileLoaded(false);
  setMessage({ type: 'success', text: 'Logged out' });
}
```
**Purpose**: Log out and reset state

#### handleSaveProfile
```typescript
const handleSaveProfile = async () => {
  if (!currentUsername) return;

  setIsSavingProfile(true);
  const success = await universeAPI.updateProfile(currentUsername, {
    displayName: editDisplayName,
    bio: editBio,
    avatarUrl: editAvatarUrl || null,
  });
  setIsSavingProfile(false);

  if (success) {
    setMessage({ type: 'success', text: 'Profile updated!' });
  } else {
    setMessage({ type: 'error', text: 'Failed to save profile' });
  }
}
```
**Purpose**: Save profile changes to Supabase

#### handleGeneratePassphrase
```typescript
const handleGeneratePassphrase = () => {
  const newPassphrase = generatePassphrase();
  setPassphrase(newPassphrase);
  setMessage({ type: 'success', text: 'Passphrase generated! Save it somewhere safe.' });
}
```
**Purpose**: Generate random passphrase for backup

#### handleSaveToCloud
```typescript
const handleSaveToCloud = async () => {
  if (!passphrase) {
    setMessage({ type: 'error', text: 'Generate a passphrase first' });
    return;
  }
  setIsSaving(true);
  const success = await saveToCloud(passphrase);
  setIsSaving(false);
  setMessage(success
    ? { type: 'success', text: 'Universe saved!' }
    : { type: 'error', text: 'Save failed' }
  );
}
```
**Purpose**: Encrypt and save universe to cloud

#### handleRestoreFromCloud
```typescript
const handleRestoreFromCloud = async () => {
  if (!passphraseInput) {
    setMessage({ type: 'error', text: 'Enter your passphrase' });
    return;
  }
  setIsRestoring(true);
  const success = await restoreFromCloud(passphraseInput);
  setIsRestoring(false);
  setMessage(success
    ? { type: 'success', text: 'Universe restored!' }
    : { type: 'error', text: 'Invalid passphrase' }
  );
}
```
**Purpose**: Decrypt and restore universe from cloud

#### handleOpenPortal
```typescript
const handleOpenPortal = async () => {
  const url = await openPortal();
  setPortalUrl(url);
  setMessage({ type: 'success', text: 'Portal opened!' });
}
```
**Purpose**: Open listening portal and get shareable URL

#### handleCopy
```typescript
const handleCopy = (text: string) => {
  navigator.clipboard.writeText(text);
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
}
```
**Purpose**: Copy text to clipboard with visual feedback

---

### Render Logic

#### Panel Structure
```
AnimatePresence
  └─ motion.div (backdrop + modal container)
       └─ motion.div (panel)
            ├─ Header
            │    ├─ Close button
            │    ├─ Globe icon
            │    ├─ Title (My Universe / VOYO Universe)
            │    └─ Subtitle (voyomusic.com/username / Claim your URL)
            ├─ Tabs Bar
            │    ├─ Dynamic tabs (logged in: 5 tabs | logged out: 1 tab)
            │    └─ Logout button (if logged in)
            ├─ Content Area (scrollable, max-h-60vh)
            │    ├─ Message Toast (AnimatePresence)
            │    └─ Active Tab Content
            │         ├─ AUTH TAB
            │         ├─ STATS TAB
            │         ├─ DISCOVER TAB
            │         ├─ PROFILE TAB
            │         ├─ BACKUP TAB
            │         └─ PORTAL TAB
            └─ (no footer)
```

#### Tab System
**Logged Out** (1 tab):
- Auth (login/signup)

**Logged In** (5 tabs + logout):
- Stats (music stats)
- Find (user search)
- Profile (edit profile)
- Portal (share listening)
- Backup (data backup)
- Logout (button, not tab)

---

## Tab Content Details

### AUTH TAB

**Mode Toggle**:
- Login / Claim Username
- Purple toggle button

**Username Input**:
- AtSign icon prefix
- Lowercase, alphanumeric + underscore only
- Min 3 characters
- Real-time availability check (signup mode)
- Shows: RefreshCw (checking) | Check (available) | X (taken)
- Shows URL preview: `voyomusic.com/username`

**Display Name Input** (signup only):
- User icon prefix
- Optional field

**PIN Input**:
- Lock icon prefix
- 6-digit numeric only
- Password input type
- Center-aligned with letter-spacing
- Validation: Signup requires 6 digits, login requires 4+

**Submit Button**:
- Gradient purple-pink
- Disabled if validation fails
- Shows spinner when loading
- Text changes: "Claim voyomusic.com/username" (signup) | "Enter Universe" (login)

**Footer**:
- "No email needed. Just username + PIN."

---

### STATS TAB

**Grid Layout** (2x2):
1. **Tracks** (Purple, Music icon): Total tracks played
2. **Liked** (Pink, Heart icon): Explicitly liked tracks
3. **Minutes** (Blue, Clock icon): Total listening time
4. **OYEs** (Yellow, Zap icon): Total reactions given

**Completion Rate Card**:
- Progress bar showing completion percentage
- Purple-pink gradient fill
- Formula: `(completions / totalListens) * 100`

**Share URL Card**:
- Purple-pink gradient background
- Shows: `voyomusic.com/username`
- Copy button with check feedback

---

### DISCOVER TAB

**Content**:
- Renders `UserSearch` component
- Callback: Navigate to `/${username}` on user select
- Full user search functionality (see UserSearch component below)

---

### PROFILE TAB

**Avatar Section**:
- Circular avatar (24x24 = 6rem)
- Image or gradient with initial
- Camera button overlay (purple, bottom-right)
- Username below: `@username`

**Display Name Input**:
- Text input
- Editable

**Bio Input**:
- Textarea (3 rows)
- Character count: `{length}/150`
- Placeholder: "Tell the world about your music taste..."

**Avatar URL Input**:
- URL input
- Optional
- Placeholder: https://example.com/your-photo.jpg

**Save Button**:
- Gradient purple-pink
- Save icon or spinner
- Text: "Save Profile" / "Saving..."

**Preview Link**:
- Purple text with underline on hover
- Opens profile in new tab: `/${currentUsername}`

---

### BACKUP TAB

**Last Backup Indicator** (if exists):
- Green card with date

**Download Backup Card**:
- Title: "Download Backup"
- Description: "Export your universe as JSON"
- Button: Download icon, purple
- Action: Downloads JSON file with all data

**Passphrase Backup Card**:
- Title: "Passphrase Backup"
- Description: "Encrypt with memorable words"

**State 1: No Passphrase**:
- Button: "Generate Passphrase"

**State 2: Passphrase Generated**:
- Black card showing passphrase (monospace font)
- Copy button
- "Save to Cloud" button (gradient)

**Restore Universe Card**:
- Input: Enter passphrase
- Button: Upload icon, restore action
- Validates passphrase and restores data

---

### PORTAL TAB

**Info Card**:
- Purple-pink gradient background
- "What is a Portal?" heading
- Explanation text

**Portal Closed State**:
- "Open My Portal" button (gradient)

**Portal Open State**:
- Status: Green dot (pulsing) + "Portal Open"
- Close button (red)
- Portal link display (black card)
- Copy button with feedback
- Connected peers count (Users icon + number)
- QR code placeholder (white square with QR icon)
- Share buttons (2 columns):
  - Share (Smartphone icon) - Native share API
  - Copy Link (Copy icon)

---

### Styling

**Modal Container**:
- `max-w-md` - Centered, 28rem max width
- `bg-gradient-to-b from-[#1a1a2e] to-[#0a0a0f]` - Dark gradient
- `rounded-3xl` - Large border radius
- `border border-white/10` - Subtle border

**Header**:
- `border-b border-white/10` - Bottom separator
- Globe icon in gradient square (16x16)

**Tabs**:
- Active: `border-b-2 border-purple-500 text-white`
- Inactive: `text-white/50 hover:text-white/70`
- Icon + label layout
- Logout button on far right

**Content Area**:
- `max-h-[60vh] overflow-y-auto` - Scrollable
- `p-6` - Padding

**Message Toast**:
- Success: `bg-green-500/20 text-green-400`
- Error: `bg-red-500/20 text-red-400`
- Slide animation from top

**Input Fields**:
- `bg-white/5 border border-white/10` - Dark translucent
- `focus:border-purple-500/50` - Purple focus state
- Icons positioned absolute left

**Buttons**:
- Primary: `bg-gradient-to-r from-purple-500 to-pink-500`
- Secondary: `bg-white/10 hover:bg-white/20`
- Disabled: `opacity-50 cursor-not-allowed`

**Stats Cards**:
- `bg-white/5 border border-white/10` - Dark cards
- Icon colors match metric type (purple, pink, blue, yellow)

---

### Integration Points

#### With UniverseStore
1. **Auth**: All login/signup/logout flows
2. **Backup**: Download, encrypt, save, restore operations
3. **Portal**: Open, close, status management
4. **Validation**: Username availability check

#### With PreferenceStore
1. **Stats**: Read `trackPreferences` for calculations
2. **Derived Metrics**: Calculate completion rate, totals

#### With UniverseAPI
1. **Profile**: Get and update profile data
2. **Cloud Operations**: Backup and restore via Supabase

#### With UserSearch Component
1. **Discovery**: Embedded in Discover tab
2. **Navigation**: Callback to navigate to user profile

#### With Clipboard API
1. **Copy Actions**: Portal URL, universe URL, passphrase
2. **Visual Feedback**: Check icon for 2s

#### With Native Share API
1. **Portal Sharing**: `navigator.share()` for portal URL
2. **Progressive Enhancement**: Falls back to copy if not supported

---

### Animation Details

**Panel Entry/Exit**:
- Backdrop: Fade in/out
- Panel: Scale 0.9 → 1, y: 50 → 0
- Exit: Reverse animation

**Message Toast**:
- Slide down from top: y: -10 → 0
- Fade in/out: opacity 0 → 1 → 0
- 3s auto-dismiss

**Tab Transition**:
- No animation, instant switch
- Content loads on-demand

**Loading States**:
- Spinners: Continuous rotation
- Pulse: Opacity 1 → 0.7 → 1 (portal indicator)

---

### Security Considerations

1. **PIN Validation**: Client-side, 6 digits for signup, 4+ for login
2. **Username Sanitization**: Lowercase, alphanumeric + underscore only
3. **Passphrase Encryption**: Generated passphrase encrypts backup
4. **No Email Storage**: Privacy-first, username + PIN only
5. **Portal Control**: User explicitly opens/closes portal

---

### Performance Optimizations

1. **Lazy Loading**: Profile data loads only when profile tab opens
2. **Debounced Username Check**: 500ms delay prevents excessive API calls
3. **Conditional Rendering**: Tabs render only when active
4. **Memoized Stats**: Calculated once from trackPreferences
5. **Cleanup**: Effects clean up timers and subscriptions

---

### Error Handling

1. **Auth Errors**: Display in message toast
2. **API Failures**: Show error messages, don't crash
3. **Validation**: Disable submit buttons until valid
4. **Passphrase Missing**: Prompt to generate before saving
5. **Store Errors**: Subscribe to error state and display

---

## Component 2: UserSearch

**File**: `/home/dash/voyo-music/src/components/universe/UserSearch.tsx`

### Purpose
Embedded user search component for finding other VOYO users by username.

---

### Props Interface

```typescript
interface UserSearchProps {
  onSelectUser: (username: string) => void;  // Selection callback
  onClose?: () => void;                      // Optional close callback
}

interface SearchResult {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  portalOpen: boolean;
}
```

---

### State Management

```typescript
const [query, setQuery] = useState('');
const [results, setResults] = useState<SearchResult[]>([]);
const [isSearching, setIsSearching] = useState(false);
```

---

### Core Effect: Debounced Search

```typescript
useEffect(() => {
  if (query.length < 2) {
    setResults([]);
    return;
  }

  const timer = setTimeout(async () => {
    setIsSearching(true);
    const users = await universeAPI.searchUsers(query);
    setResults(users);
    setIsSearching(false);
  }, 300);

  return () => clearTimeout(timer);
}, [query]);
```
**Purpose**: Search users via API after 300ms delay

---

### Render Logic

```
UserSearch Container
  ├─ Header
  │    ├─ Title: "Find Users"
  │    └─ Close button (if onClose provided)
  ├─ Search Input
  │    ├─ Search icon (left)
  │    └─ Input field (auto-focus)
  └─ Results List (scrollable, max-h-300px)
       ├─ Loading State (spinner)
       ├─ Empty State (User icon + "No users found")
       ├─ Prompt State ("Type at least 2 characters")
       └─ Results (AnimatePresence)
            └─ User Cards (map)
                 ├─ Avatar (image or gradient)
                 ├─ Display name + @username
                 └─ "LIVE" badge (if portal open)
```

---

### Conditional Rendering

**Loading** (isSearching):
- Centered spinner

**Empty** (query >= 2, no results):
- User icon
- "No users found"

**Prompt** (query < 2):
- "Type at least 2 characters to search"

**Results** (has results):
- Map over results array
- Stagger animation (0.05s delay per item)

---

### User Card Structure

**Avatar**:
- 10x10 (2.5rem) circular
- Gradient background: `from-purple-500 to-pink-500`
- Image overlay if `avatarUrl` exists
- Fallback: First letter of display name

**Info**:
- Display name (white, medium weight, truncated)
- @username (white/40, small, truncated)

**Portal Badge** (if portalOpen):
- Green background with border
- Radio icon + "LIVE" text
- Small, compact badge

---

### Styling

**Search Input**:
- `bg-white/5 border border-white/10` - Dark input
- `focus:border-purple-500/50` - Purple focus
- Search icon left, absolute positioning

**Results Container**:
- `max-h-[300px] overflow-y-auto` - Scrollable
- `space-y-2` - Gap between items

**User Cards**:
- `bg-white/5 border border-white/10` - Dark card
- `hover:bg-white/10` - Hover effect
- `rounded-xl` - Large border radius
- Full width button

**Portal Badge**:
- `bg-green-500/20 border border-green-500/30` - Green translucent
- `text-green-400` - Green text
- `rounded-full` - Pill shape
- Radio icon (3x3) + text (xs)

---

### Animation Details

**User Cards**:
- Entry: Opacity 0 → 1, y: 10 → 0
- Exit: Opacity 1 → 0, y: 0 → -10
- Stagger: `delay: index * 0.05`
- Duration: Fast (default framer-motion)

**Loading Spinner**:
- Border-based spinner
- Continuous rotation
- Purple color

---

### Integration Points

#### With UniverseAPI
1. **Search**: `universeAPI.searchUsers(query)`
2. **Returns**: Array of `SearchResult` objects

#### Parent Component
1. **Selection**: Call `onSelectUser(username)` when user clicked
2. **Close**: Call `onClose()` if provided (optional)
3. **Navigation**: Parent handles navigation to user profile

---

### Performance Optimizations

1. **Debouncing**: 300ms delay prevents API spam
2. **Min Query Length**: Requires 2+ chars before searching
3. **Stagger Animation**: Reduces perceived render cost
4. **Abort Cleanup**: Timer cleanup on unmount/query change

---

### Accessibility

1. **Auto-focus**: Input focused on mount
2. **Keyboard Navigation**: Tab through results
3. **Click Targets**: Full card is clickable
4. **Loading State**: Visual feedback during search

---

### Future Enhancement Opportunities

1. **Recent Searches**: Cache and show recent user searches
2. **Filters**: Filter by portal status (live only)
3. **Sort Options**: Sort by popularity, recent activity
4. **Infinite Scroll**: Load more results on scroll
5. **User Preview**: Hover card with more info
6. **Follow/Unfollow**: Quick follow actions in search

---

## Summary

The Universe component system provides a comprehensive user management interface with auth, profile editing, stats, backup, portal sharing, and user discovery. It balances functionality with simplicity, using PIN-based auth for privacy and offering multiple backup options (JSON download, encrypted cloud). The UserSearch component enables social discovery, allowing users to find and connect with other VOYO users, especially those with live portals.

**Key Features**:
- PIN-based authentication (no email required)
- Real-time username availability check
- Profile customization (avatar, display name, bio)
- Music consumption stats with completion rate
- Multi-modal backup (JSON download, encrypted cloud with passphrase)
- Live listening portals with shareable URLs
- User search with portal status indicators
- Mobile-optimized tab interface
- Comprehensive error handling and validation

**Architecture Strengths**:
- Tab-based navigation reduces cognitive load
- Lazy-loading of profile data improves performance
- Debounced username checks prevent API spam
- Message toast system provides clear feedback
- Modular sub-components (UserSearch) enable reuse
- Deep integration with Zustand stores and Supabase API

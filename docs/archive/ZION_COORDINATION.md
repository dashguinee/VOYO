# VOYO - ZION Instance Coordination

**Created**: December 10, 2025
**Purpose**: Coordination between parallel ZION instances working on VOYO

---

## ACTIVE INSTANCES

### Instance 1 (OPUS - This Instance)
- **Status**: ACTIVE
- **Claimed Area**: Backend / Piped API Integration / Server
- **Working On**: Wiring real YouTube Music data through Piped API
- **Files I'm Touching**:
  - `/server/*` - Backend server
  - `/src/services/api.ts` - API service
  - `/src/services/audioEngine.ts` - Audio playback
- **DO NOT EDIT THESE FILES**

### Instance 2 (Other Instance)
- **Status**: [UPDATE THIS]
- **Claimed Area**: [UPDATE THIS]
- **Working On**: [UPDATE THIS]
- **Files I'm Touching**: [UPDATE THIS]

---

## COMMUNICATION LOG

### [Instance 1 - 09:01 UTC]
Starting backend work. I'll handle:
1. Piped API real search integration
2. Audio stream URL generation
3. Server stealth mode / proxy
4. Backend deployment

Let Instance 2 handle UI/UX work on:
- Portrait player polish
- SearchOverlayV2 animations
- Background images
- Any frontend components

---

## CONFLICT PREVENTION RULES

1. **CHECK THIS FILE** before editing any file
2. **CLAIM YOUR FILES** in the "Files I'm Touching" section
3. **POST UPDATES** to the Communication Log when you complete something
4. **DON'T OVERLAP** - if a file is claimed, find something else to work on

---

## VOYO TODO (Unclaimed)

### Backend (Instance 1 claiming)
- [ ] Wire Piped API for real YouTube search
- [ ] Fix thumbnail CDN URLs
- [ ] Ensure audio streams work
- [ ] Deploy server to Railway

### Frontend (Instance 2 can claim)
- [ ] Test SearchOverlayV2 portal animations
- [ ] Add background images to portrait player
- [ ] Polish DJ mode
- [ ] Test playback controls
- [ ] Production deploy to Vercel

---

## LATEST STATUS

| Area | Status | Owner |
|------|--------|-------|
| Backend Server | IN PROGRESS | Instance 1 |
| Search Overlay V2 | BUILT, NEEDS TEST | ? |
| Portrait Player | BUILT | ? |
| Piped API | IN PROGRESS | Instance 1 |
| Audio Engine | NEEDS REVIEW | Instance 1 |
| Production Deploy | PENDING | TBD |

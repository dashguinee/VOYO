/**
 * OYO Contextual Greetings
 * ------------------------
 * The first line OYO drops when summoned, varied per surface.
 *
 * - home: ambient, welcoming — they came looking for him from the lobby
 * - player: mid-music — he reads as a co-pilot for the current vibe
 * - dahub: backstage — slightly suspicious, intimate
 *
 * Lines are short, in OYO's voice (Soussou-flavoured English, casual,
 * confident, never corporate).
 */

import type { InvocationSurface } from '../store/oyoStore';

export const GREETINGS: Record<InvocationSurface, string[]> = {
  home: [
    "Yo. What's the vibe?",
    "You called. Talk to me.",
    "Mmm. What are we doing tonight?",
    "I'm listening.",
    "On nu wama? What can I find for you?",
    "Lobby OYO. Drop it on me.",
  ],
  player: [
    "Want me to take this deeper?",
    "This one's hitting. More like it?",
    "Mid-song check — you good?",
    "Tell me what you wanna feel next.",
    "I hear you. Where we going from here?",
    "Same energy or new chapter?",
  ],
  dahub: [
    "Why'd you pull me in here?",
    "DaHub backstage. What's up?",
    "You came looking for me here? Spill.",
    "Backstage mode. Keep it real.",
    "Quiet room. Talk freely.",
    "Off the floor — what's on your mind?",
  ],
};

/**
 * Pick a greeting for a given surface. Pure random for now; later
 * versions can weight by time-of-day, last-mood, or streak.
 */
export function pickGreeting(surface: InvocationSurface): string {
  const options = GREETINGS[surface];
  const idx = Math.floor(Math.random() * options.length);
  return options[idx];
}

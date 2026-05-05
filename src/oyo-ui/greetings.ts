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

export type InvocationSurface = 'home' | 'player' | 'dahub';

export const GREETINGS: Record<InvocationSurface, string[]> = {
  home: [
    "Yo. What's the vibe?",
    "You called. Talk to me.",
    "Mmm. What are we doing tonight?",
    "I'm listening.",
    "Posi?",
    "Floor's yours. Drop it.",
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

// Time-of-day overrides — fire at 50% chance to keep it varied
const TIME_GREETINGS: Partial<Record<InvocationSurface, Record<string, string[]>>> = {
  player: {
    morning:   ['Morning session. Good start.', 'Rise and vibe — what are we opening with?'],
    afternoon: ["Afternoon run. What's the energy today?", 'Midday check-in. Where are we?'],
    evening:   ["Evening mode. Let's set the tone.", "Sun's down. Where are we taking this?"],
    latenight: ['Late crew. Still up. What are we doing?', "Deep night session. I'm with it."],
    midnight:  ['Midnight energy. No filters. Talk to me.', "Still here. What's on?"],
  },
  home: {
    morning:   ['Morning. What are we starting with?', 'Early doors. What is the move?'],
    evening:   ['Evening vibes. What are we doing?', 'End of day. Talk to me.'],
    latenight: ['Late night pull. Something on your mind?', 'Night hours. Low light. What?'],
    midnight:  ['Midnight. You here for a reason?', 'Still up? I heard you.'],
  },
};

function getTimeSlot(): string | null {
  const h = new Date().getHours();
  if (h >= 5 && h < 9) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 && h < 22) return 'evening';
  if (h >= 22 || h < 2) return 'midnight';
  if (h >= 2 && h < 5) return 'latenight';
  return null;
}

/**
 * Pick a contextual greeting weighted by time-of-day (50% chance) and surface.
 */
export function pickGreeting(surface: InvocationSurface): string {
  const slot = getTimeSlot();
  if (slot && Math.random() < 0.5) {
    const timeOptions = TIME_GREETINGS[surface]?.[slot];
    if (timeOptions?.length) {
      return timeOptions[Math.floor(Math.random() * timeOptions.length)];
    }
  }
  const options = GREETINGS[surface];
  return options[Math.floor(Math.random() * options.length)];
}

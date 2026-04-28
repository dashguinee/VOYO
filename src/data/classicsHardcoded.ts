/**
 * VOYO Music — All-Time Classics (hardcoded baseline).
 *
 * The default content shown in the contracted shelf. Stays put on a user's
 * device until either:
 *   1. A new bundle ships (service worker activates) with an updated array
 *      AND a bumped CLASSICS_VERSION — dismissal is tied to the version, so
 *      bumping the version makes the surface re-appear for everyone who
 *      dismissed the previous edition.
 *   2. A cockpit drop is fired — overrides this baseline for the duration.
 *
 * Curation rule: African classics that moved the continent. Bronze hairline
 * energy. Less is more. Dash and ZION edit this list together.
 */
import type { Track } from '../types';

/** Bump this string whenever the array below changes — old dismissals expire. */
export const CLASSICS_VERSION = '2026-04-28-r2';

export const CLASSICS_HARDCODED: Track[] = [
  {
    id: 'RHR0tKRxiyY',
    trackId: 'RHR0tKRxiyY',
    title: 'Water No Get Enemy',
    artist: 'Fela Kuti',
    coverUrl: 'https://i.ytimg.com/vi/RHR0tKRxiyY/hqdefault.jpg',
    duration: 0,
    tags: ['classic', 'afrobeat', 'fela'],
    oyeScore: 100_000_000,
    createdAt: '2026-04-28',
  },
  {
    id: 'tt58bQeNgzs',
    trackId: 'tt58bQeNgzs',
    title: 'Tekere',
    artist: 'Salif Keita',
    coverUrl: 'https://i.ytimg.com/vi/tt58bQeNgzs/hqdefault.jpg',
    duration: 0,
    tags: ['classic', 'mande', 'mali'],
    oyeScore: 100_000_000,
    createdAt: '2026-04-28',
  },
];

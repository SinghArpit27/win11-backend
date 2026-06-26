import crypto from 'node:crypto';

const ADJECTIVES = [
  'swift',
  'iron',
  'bold',
  'neon',
  'royal',
  'ace',
  'prime',
  'mega',
  'storm',
  'blaze',
  'cyber',
  'golden',
  'night',
  'flash',
  'power',
  'elite',
  'turbo',
  'shadow',
] as const;

const NOUNS = [
  'eagle',
  'tiger',
  'wolf',
  'king',
  'star',
  'lion',
  'hawk',
  'bolt',
  'knight',
  'striker',
  'captain',
  'ranger',
  'phantom',
  'viper',
  'dragon',
  'phoenix',
  'legend',
  'champion',
] as const;

/** Random fantasy-style handle seed, e.g. `swift_eagle834`. */
export const generateGameUsernameSeed = (): string => {
  const adj = ADJECTIVES[crypto.randomInt(ADJECTIVES.length)];
  const noun = NOUNS[crypto.randomInt(NOUNS.length)];
  const num = crypto.randomInt(100, 9999);
  return `${adj}_${noun}${num}`;
};

/**
 * Build a url-safe username slug from a display name.
 * "Arpit Singh" → "arpit_singh"
 */
export const slugifyUsername = (displayName: string): string => {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 16);

  return slug.length >= 3 ? slug : 'player';
};

/**
 * Resolve a unique username by appending numeric suffixes when needed.
 */
export const generateUniqueUsername = async (
  displayName: string,
  isTaken: (username: string) => Promise<boolean>,
): Promise<string> => {
  const base = slugifyUsername(displayName);
  let candidate = base;
  let suffix = 0;

  while (await isTaken(candidate)) {
    suffix += 1;
    candidate = `${base}${suffix}`.slice(0, 20);
  }

  return candidate;
};

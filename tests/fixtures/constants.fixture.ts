/** Shared test constants for auth and wallet flows. */
export const TEST_PASSWORD = 'TestPass1!';

export const INVALID_PASSWORDS = {
  tooShort: 'Ab1!',
  noUppercase: 'testpass1!',
  noLowercase: 'TESTPASS1!',
  noDigit: 'TestPass!!',
  noSymbol: 'TestPass1',
} as const;

/** Minimum deposit in major units (matches AppConstants.MONEY.DEPOSIT_MIN_MAJOR). */
export const MIN_DEPOSIT_MAJOR = 10;

/** Default per-player credit used in cricket squad fixtures. */
export const DEFAULT_PLAYER_CREDITS = 9;

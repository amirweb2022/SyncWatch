export const MAX_AUTOMATIC_RECONNECT_ATTEMPTS = 5;

export function reconnectDelay(attempt: number, random: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError("Attempt must be a positive integer");
  if (!Number.isFinite(random) || random < 0 || random >= 1) throw new RangeError("Random value must be in [0, 1)");
  const ceiling = Math.min(500 * 2 ** (attempt - 1), 8_000);
  return Math.floor(random * ceiling);
}

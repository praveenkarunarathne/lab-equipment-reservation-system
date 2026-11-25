// Asia/Colombo is UTC+05:30 all year (no daylight saving), so a fixed offset is exact.
const OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Build the UTC instant for a wall-clock time in Asia/Colombo. Month is 1-based. */
export function colombo(year, month, day, hour, minute, second = 0, ms = 0) {
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, ms) - OFFSET_MS,
  );
}

export function iso(date) {
  return date.toISOString();
}

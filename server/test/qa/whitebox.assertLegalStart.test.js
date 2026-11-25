/**
 * EC4206 §3.4 White-box testing — assertLegalStart(startAt, serverNow)
 * (server/src/modules/reservations/reservationTime.js)
 *
 * Control-flow graph (predicate nodes D1–D5):
 *   D1 !Number.isFinite(startAt)            -> message = "valid instant"
 *   D2 startAt <= serverNow                  -> message = "strictly in the future"
 *   D3 startAt >  bookingHorizon(serverNow)  -> message = "within the next 14 days"
 *   D4 !weekday || !slotTime || sec≠0 || ms≠0 -> message = "weekday slot ..."
 *   D5 if (message)                          -> throw AppError(400)
 *
 * Cyclomatic complexity V(G) = P + 1 = 5 + 1 = 6
 *   (= 9 when D4's compound condition is split into its four atomic conditions,
 *    which is what ESLint's `complexity` rule reports).
 * Of the 6 basis paths only 5 are feasible: D5 is fully correlated with D1–D4
 * (message is set exactly when one of them is true), so "D1–D4 false, D5 true"
 * cannot be executed.
 */
import { describe, expect, test } from 'vitest';
import {
  assertLegalStart,
  bookingHorizon,
  legalSlotStarts,
  slotDto,
} from '../../src/modules/reservations/reservationTime.js';
import { colombo } from './helpers/colombo.js';

const NOW = colombo(2026, 10, 26, 8, 30); // Monday 08:30 Asia/Colombo

function run(startAt) {
  try {
    assertLegalStart(startAt, NOW);
    return null;
  } catch (error) {
    return error;
  }
}

describe('Statement + branch coverage (basis paths)', () => {
  test('WB-01 P1: D1=T → D5=T (invalid instant)', () => {
    const error = run(new Date(Number.NaN));
    expect(error.message).toBe('Start time must be a valid instant.');
    expect(error.fieldErrors).toEqual({ 'body.startAt': [error.message] });
  });

  test('WB-02 P2: D1=F, D2=T → D5=T (not in the future)', () => {
    expect(run(NOW).message).toBe(
      'The slot must start strictly in the future.',
    );
  });

  test('WB-03 P3: D1=F, D2=F, D3=T → D5=T (beyond horizon)', () => {
    expect(run(colombo(2026, 11, 10, 8, 30)).message).toBe(
      'The slot must be within the next 14 days.',
    );
  });

  test('WB-04 P4: D1–D3=F, D4=T → D5=T (off grid)', () => {
    expect(run(colombo(2026, 10, 27, 9, 0)).status).toBe(400);
  });

  test('WB-05 P5: D1–D4=F → D5=F (accepted, no throw)', () => {
    expect(run(colombo(2026, 10, 27, 9, 30))).toBeNull();
  });
});

describe('Condition coverage of D4 (each atomic condition true on its own)', () => {
  test.each([
    ['WB-06', 'weekday false (Saturday)', colombo(2026, 10, 31, 9, 30)],
    ['WB-07', 'slot time false (09:45)', colombo(2026, 10, 27, 9, 45)],
    ['WB-08', 'seconds ≠ 0', colombo(2026, 10, 27, 9, 30, 5)],
    ['WB-09', 'milliseconds ≠ 0', colombo(2026, 10, 27, 9, 30, 0, 5)],
  ])('%s %s', (_id, _label, startAt) => {
    expect(run(startAt).message).toMatch(/^Choose a weekday slot/);
  });
});

describe('Remaining functions in reservationTime.js', () => {
  test('WB-10 bookingHorizon adds 14 calendar days in Asia/Colombo', () => {
    expect(bookingHorizon(NOW).toISOString()).toBe(
      colombo(2026, 11, 9, 8, 30).toISOString(),
    );
  });

  test('WB-11 legalSlotStarts: loop skips weekends, excludes now, includes horizon', () => {
    const starts = legalSlotStarts(NOW);
    // Today after 08:30 → 7 slots; 9 full weekdays × 8 = 72; horizon day
    // (Mon 9 Nov) contributes only 08:30 → 7 + 72 + 1 = 80.
    expect(starts).toHaveLength(80);
    expect(starts[0].toISOString()).toBe(
      colombo(2026, 10, 26, 9, 30).toISOString(),
    );
    expect(starts.at(-1).toISOString()).toBe(
      colombo(2026, 11, 9, 8, 30).toISOString(),
    );
    for (const start of starts) expect(run(start)).toBeNull();
  });

  test('WB-12 legalSlotStarts on a Saturday starts with Monday', () => {
    const saturday = colombo(2026, 10, 31, 12, 0);
    expect(legalSlotStarts(saturday)[0].toISOString()).toBe(
      colombo(2026, 11, 2, 8, 30).toISOString(),
    );
  });

  test('WB-13 slotDto produces a one-hour window and a Colombo label', () => {
    expect(slotDto(colombo(2026, 10, 27, 15, 30))).toEqual({
      startAt: '2026-10-27T10:00:00.000Z',
      endAt: '2026-10-27T11:00:00.000Z',
      label: 'Tue, 27 Oct 2026 15:30–16:30',
    });
  });
});

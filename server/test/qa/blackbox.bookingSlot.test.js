/**
 * EC4206 §3.3 Black-box testing — booking start time (`startAt`).
 *
 * Specification under test (README "Booking rules"):
 *   - one-hour slots, Monday–Friday, start times 08:30 … 15:30 Asia/Colombo
 *   - must start strictly in the future, and no later than 14 days ahead
 *
 * Techniques: Equivalence Partitioning (EP) and Boundary Value Analysis (BVA).
 * Test IDs match the test-case tables in the QA report (TC-EP-xx / TC-BVA-xx).
 */
import { describe, expect, test } from 'vitest';
import { assertLegalStart } from '../../src/modules/reservations/reservationTime.js';
import { colombo } from './helpers/colombo.js';

// Fixed "server now": Monday 26 Oct 2026, 08:30 Asia/Colombo.
const NOW = colombo(2026, 10, 26, 8, 30);

const MSG = {
  future: 'The slot must start strictly in the future.',
  horizon: 'The slot must be within the next 14 days.',
  grid: 'Choose a weekday slot starting hourly from 08:30 through 15:30 in Asia/Colombo.',
  instant: 'Start time must be a valid instant.',
};

function outcome(startAt) {
  try {
    assertLegalStart(startAt, NOW);
    return 'accepted';
  } catch (error) {
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    return error.message;
  }
}

describe('Equivalence partitioning — startAt', () => {
  test.each([
    [
      'TC-EP-01',
      'valid: weekday, on the slot grid, future, within horizon',
      colombo(2026, 10, 27, 10, 30),
      'accepted',
    ],
    [
      'TC-EP-02',
      'invalid: in the past',
      colombo(2026, 10, 23, 10, 30),
      MSG.future,
    ],
    [
      'TC-EP-03',
      'invalid: beyond the 14-day horizon',
      colombo(2026, 11, 10, 10, 30),
      MSG.horizon,
    ],
    [
      'TC-EP-04',
      'invalid: weekend day',
      colombo(2026, 10, 31, 10, 30),
      MSG.grid,
    ],
    [
      'TC-EP-05',
      'invalid: inside hours but off the hourly grid',
      colombo(2026, 10, 27, 10, 0),
      MSG.grid,
    ],
    [
      'TC-EP-06',
      'invalid: outside opening hours',
      colombo(2026, 10, 27, 17, 30),
      MSG.grid,
    ],
    [
      'TC-EP-07',
      'invalid: not a real instant',
      new Date('not-a-date'),
      MSG.instant,
    ],
  ])('%s %s', (_id, _label, startAt, expected) => {
    expect(outcome(startAt)).toBe(expected);
  });
});

describe('Boundary value analysis — time of day (Tue 27 Oct 2026)', () => {
  test.each([
    ['TC-BVA-01', '07:30 (one slot before first)', 7, 30, MSG.grid],
    ['TC-BVA-02', '08:29 (min − 1 min)', 8, 29, MSG.grid],
    ['TC-BVA-03', '08:30 (min)', 8, 30, 'accepted'],
    ['TC-BVA-04', '08:31 (min + 1 min)', 8, 31, MSG.grid],
    ['TC-BVA-05', '15:29 (max − 1 min)', 15, 29, MSG.grid],
    ['TC-BVA-06', '15:30 (max)', 15, 30, 'accepted'],
    ['TC-BVA-07', '15:31 (max + 1 min)', 15, 31, MSG.grid],
    ['TC-BVA-08', '16:30 (one slot after last)', 16, 30, MSG.grid],
  ])('%s %s', (_id, _label, hour, minute, expected) => {
    expect(outcome(colombo(2026, 10, 27, hour, minute))).toBe(expected);
  });
});

describe('Boundary value analysis — seconds precision', () => {
  test.each([
    ['TC-BVA-09', '08:30:00.000', 0, 0, 'accepted'],
    ['TC-BVA-10', '08:30:00.001', 0, 1, MSG.grid],
    ['TC-BVA-11', '08:30:01.000', 1, 0, MSG.grid],
  ])('%s %s', (_id, _label, second, ms, expected) => {
    expect(outcome(colombo(2026, 10, 27, 8, 30, second, ms))).toBe(expected);
  });
});

describe('Boundary value analysis — "strictly in the future" and 14-day horizon', () => {
  test.each([
    [
      'TC-BVA-12',
      'start = now (Mon 08:30)',
      colombo(2026, 10, 26, 8, 30),
      MSG.future,
    ],
    ['TC-BVA-13', 'now − 1 ms', new Date(NOW.getTime() - 1), MSG.future],
    [
      'TC-BVA-14',
      'first slot after now (Mon 09:30)',
      colombo(2026, 10, 26, 9, 30),
      'accepted',
    ],
    [
      'TC-BVA-15',
      'start = now + 14 days exactly (Mon 9 Nov 08:30)',
      colombo(2026, 11, 9, 8, 30),
      'accepted',
    ],
    [
      'TC-BVA-16',
      'now + 14 days + 1 ms',
      new Date(colombo(2026, 11, 9, 8, 30).getTime() + 1),
      MSG.horizon,
    ],
    [
      'TC-BVA-17',
      'next slot after horizon (Mon 9 Nov 09:30)',
      colombo(2026, 11, 9, 9, 30),
      MSG.horizon,
    ],
  ])('%s %s', (_id, _label, startAt, expected) => {
    expect(outcome(startAt)).toBe(expected);
  });
});

describe('Boundary value analysis — weekday edges', () => {
  test.each([
    [
      'TC-BVA-18',
      'Friday 30 Oct (last weekday)',
      colombo(2026, 10, 30, 10, 30),
      'accepted',
    ],
    ['TC-BVA-19', 'Saturday 31 Oct', colombo(2026, 10, 31, 10, 30), MSG.grid],
    ['TC-BVA-20', 'Sunday 1 Nov', colombo(2026, 11, 1, 10, 30), MSG.grid],
    [
      'TC-BVA-21',
      'Monday 2 Nov (first weekday)',
      colombo(2026, 11, 2, 10, 30),
      'accepted',
    ],
  ])('%s %s', (_id, _label, startAt, expected) => {
    expect(outcome(startAt)).toBe(expected);
  });
});

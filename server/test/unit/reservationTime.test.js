import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'vitest';
import {
  assertLegalStart,
  bookingHorizon,
  legalSlotStarts,
  slotDto,
} from '../../src/modules/reservations/reservationTime.js';
import { reservationCreateSchema } from '../../src/modules/reservations/reservation.validation.js';
import { reservationDto } from '../../src/modules/reservations/reservation.dto.js';
import {
  BOOKING_WEEKDAYS,
  SLOT_START_TIMES,
} from '../../src/config/constants.js';

const NOW = new Date('2026-10-23T00:00:00.000Z');
const equipmentId = '0123456789abcdef01234567';

test.each([3, 4, 5, 6, 7, 8, 9, 10])(
  'UTC hour %i is a legal Colombo half-hour slot',
  (hour) => {
    const start = new Date(Date.UTC(2026, 9, 23, hour));
    assert.doesNotThrow(() => assertLegalStart(start, NOW));
  },
);

test('booking constants specify exactly the eight weekday starts', () => {
  assert.deepEqual(BOOKING_WEEKDAYS, [1, 2, 3, 4, 5]);
  assert.deepEqual(SLOT_START_TIMES, [
    '08:30',
    '09:30',
    '10:30',
    '11:30',
    '12:30',
    '13:30',
    '14:30',
    '15:30',
  ]);
});

test.each([
  '2026-10-23T02:00:00Z',
  '2026-10-23T02:30:00Z',
  '2026-10-23T03:30:00Z',
  '2026-10-23T11:00:00Z',
  '2026-10-23T03:00:01Z',
  '2026-10-23T03:00:00.001Z',
  '2026-10-24T03:00:00Z',
  '2026-10-25T03:00:00Z',
])('rejects an illegal slot %s', (value) => {
  assert.throws(
    () => assertLegalStart(new Date(value), NOW),
    (error) =>
      error.status === 400 &&
      error.code === 'VALIDATION_ERROR' &&
      Boolean(error.fieldErrors['body.startAt']),
  );
});

test('future and rolling-horizon comparisons honor millisecond boundaries', () => {
  const start = new Date('2026-10-23T03:00:00Z');
  assert.throws(() => assertLegalStart(start, start), /future/);
  assert.throws(
    () => assertLegalStart(start, new Date(start.getTime() + 1)),
    /future/,
  );
  assert.doesNotThrow(() =>
    assertLegalStart(start, new Date(start.getTime() - 1)),
  );
  const boundary = new Date('2026-11-06T03:00:00Z');
  assert.equal(bookingHorizon(start).toISOString(), boundary.toISOString());
  assert.doesNotThrow(() => assertLegalStart(boundary, start));
  assert.throws(
    () => assertLegalStart(boundary, new Date(start.getTime() - 1)),
    /14 days/,
  );
  assert.doesNotThrow(() =>
    assertLegalStart(boundary, new Date(start.getTime() + 1)),
  );
  assert.throws(
    () => assertLegalStart(new Date('invalid'), NOW),
    /valid instant/,
  );
});

test('generated availability is sorted, unique, and always bounded by 80 legal starts', () => {
  for (let day = 0; day < 7; day += 1) {
    for (const hour of [0, 3, 7, 10, 15, 23]) {
      const now = new Date(Date.UTC(2026, 9, 23 + day, hour, 0, 0, 123));
      const starts = legalSlotStarts(now);
      assert.ok(starts.length > 0 && starts.length <= 80);
      assert.equal(new Set(starts.map(Number)).size, starts.length);
      assert.deepEqual(
        starts.map(Number),
        starts.map(Number).toSorted((a, b) => a - b),
      );
      for (const start of starts)
        assert.doesNotThrow(() => assertLegalStart(start, now));
    }
  }
  const exact = new Date('2026-10-23T03:00:00Z');
  const starts = legalSlotStarts(exact);
  assert.equal(starts.length, 80);
  assert.equal(starts[0].toISOString(), '2026-10-23T04:00:00.000Z');
  assert.equal(starts.at(-1).toISOString(), '2026-11-06T03:00:00.000Z');
});

test('weekend availability begins on Monday and labels use Colombo business time', () => {
  const starts = legalSlotStarts(new Date('2026-10-24T00:00:00Z'));
  assert.equal(starts[0].toISOString(), '2026-10-26T03:00:00.000Z');
  assert.deepEqual(slotDto(starts[0]), {
    startAt: '2026-10-26T03:00:00.000Z',
    endAt: '2026-10-26T04:00:00.000Z',
    label: 'Mon, 26 Oct 2026 08:30–09:30',
  });
  assert.equal(
    slotDto(new Date('2026-10-26T10:00:00Z')).label,
    'Mon, 26 Oct 2026 15:30–16:30',
  );
});

test('ISO instants accept explicit offsets while rejecting ambiguous and invalid calendar input', () => {
  for (const value of [
    '2026-10-23T08:30:00+05:30',
    '2026-10-22T23:00:00-04:00',
    '2026-10-23T03:00:00Z',
  ]) {
    const parsed = reservationCreateSchema.parse({
      equipmentId,
      startAt: value,
    });
    assert.equal(parsed.startAt.toISOString(), '2026-10-23T03:00:00.000Z');
    assertLegalStart(parsed.startAt, NOW);
  }
  for (const value of [
    '2026-10-23T08:30:00',
    '2026-10-23',
    '2026-02-30T03:00:00Z',
    '2026-10-23T03:00:00.0000001Z',
    '2026-10-23T25:00:00Z',
    '2026-10-23T03:00:60Z',
    1792724400000,
    null,
    'not a date',
  ]) {
    assert.equal(
      reservationCreateSchema.safeParse({ equipmentId, startAt: value })
        .success,
      false,
    );
  }
  assert.equal(
    reservationCreateSchema.safeParse({
      equipmentId,
      startAt: '2026-10-23T03:00:00Z',
      studentId: equipmentId,
    }).success,
    false,
  );
});

test.each(['UTC', 'America/New_York', 'Asia/Tokyo'])(
  'slot generation is independent of host timezone %s across DST changes',
  (timezone) => {
    const moduleUrl = new URL(
      '../../src/modules/reservations/reservationTime.js',
      import.meta.url,
    ).href;
    const script = `import { legalSlotStarts } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(legalSlotStarts(new Date('2026-10-23T03:00:00Z')).map((date) => date.toISOString())));`;
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      { env: { ...process.env, TZ: timezone }, encoding: 'utf8' },
    );
    assert.deepEqual(
      JSON.parse(output),
      legalSlotStarts(new Date('2026-10-23T03:00:00Z')).map((date) =>
        date.toISOString(),
      ),
    );
  },
);

test('reservation DTO derives one-hour end and temporal phase without internal fields', () => {
  const startAt = new Date('2026-10-23T03:00:00Z');
  const reservation = {
    _id: 'reservation-id',
    status: 'active',
    startAt,
    cancellationReason: null,
    cancelledAt: null,
    studentId: 'private-student-id',
    __v: 4,
  };
  const equipment = {
    _id: equipmentId,
    assetCode: 'MIC-01',
    name: 'Microscope',
    location: 'Lab A',
    status: 'available',
    archivedAt: null,
    reservationGuardVersion: 9,
  };
  const before = reservationDto(
    reservation,
    equipment,
    new Date(startAt.getTime() - 1),
  );
  assert.equal(before.phase, 'upcoming');
  assert.equal(before.endAt, '2026-10-23T04:00:00.000Z');
  assert.equal(
    reservationDto(reservation, equipment, startAt).phase,
    'inProgress',
  );
  assert.equal(
    reservationDto(reservation, equipment, new Date('2026-10-23T04:00:00Z'))
      .phase,
    'past',
  );
  assert.equal(before.student, undefined);
  assert.equal(before.studentId, undefined);
  assert.equal(before.__v, undefined);
  assert.equal(before.equipment.reservationGuardVersion, undefined);
  assert.equal(before.equipment.archived, false);
});

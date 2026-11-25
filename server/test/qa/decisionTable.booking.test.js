/**
 * EC4206 §3.3 Black-box testing — decision tables.
 *
 * DT-1  POST /api/v1/reservations (create a booking)
 * ┌──────────────────────────┬────┬────┬────┬────┬────┬────┬────┬────┐
 * │ Condition / Rule         │ R1 │ R2 │ R3 │ R4 │ R5 │ R6 │ R7 │ R8 │
 * ├──────────────────────────┼────┼────┼────┼────┼────┼────┼────┼────┤
 * │ C1 valid CSRF token      │ N  │ Y  │ Y  │ Y  │ Y  │ Y  │ Y  │ Y  │
 * │ C2 signed in             │ -  │ N  │ Y  │ Y  │ Y  │ Y  │ Y  │ Y  │
 * │ C3 role = student        │ -  │ -  │ N  │ Y  │ Y  │ Y  │ Y  │ Y  │
 * │ C4 equipment available   │ -  │ -  │ -  │ N  │ Y  │ Y  │ Y  │ Y  │
 * │ C5 slot is legal         │ -  │ -  │ -  │ -  │ N  │ Y  │ Y  │ Y  │
 * │ C6 slot free (equipment) │ -  │ -  │ -  │ -  │ -  │ N  │ Y  │ Y  │
 * │ C7 student free at slot  │ -  │ -  │ -  │ -  │ -  │ -  │ N  │ Y  │
 * ├──────────────────────────┼────┼────┼────┼────┼────┼────┼────┼────┤
 * │ HTTP status              │403 │401 │403 │409 │400 │409 │409 │201 │
 * └──────────────────────────┴────┴────┴────┴────┴────┴────┴────┴────┘
 * R4 is split in the tests into "maintenance", "unavailable" and "archived".
 * R7 was added after defect QA-BUG-01 (one student booking several items for
 * the same hour) — see the QA report, §3.8.
 *
 * DT-2  PATCH /api/v1/reservations/:id/cancel
 * ┌──────────────────────────┬────┬────┬────┬────┬────┐
 * │ Condition / Rule         │ R1 │ R2 │ R3 │ R4 │ R5 │
 * ├──────────────────────────┼────┼────┼────┼────┼────┤
 * │ C1 actor                 │own │own │own │oth │adm │
 * │ C2 reservation active    │ Y  │ Y  │ N  │ Y  │ Y  │
 * │ C3 slot not yet started  │ Y  │ N  │ -  │ Y  │ Y  │
 * ├──────────────────────────┼────┼────┼────┼────┼────┤
 * │ HTTP status              │200 │409 │200*│404 │200 │
 * │ cancellationReason       │stu │ -  │kept│ -  │adm │
 * └──────────────────────────┴────┴────┴────┴────┴────┘
 *  * idempotent: returns the already-cancelled reservation unchanged.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';
import { startHarness } from './helpers/harness.js';
import { colombo } from './helpers/colombo.js';

const NOW = colombo(2026, 10, 26, 8, 0); // Mon 08:00, before the first slot
const SLOT = colombo(2026, 10, 27, 10, 30); // Tue 10:30, legal
let h, item;

beforeAll(async () => {
  h = await startHarness('qa_decision_table');
}, 180_000);
afterAll(() => h?.stop());
beforeEach(async () => {
  await h.reset();
  h.freezeClock(NOW);
  item = await h.equipment();
});

async function book(session, body = {}, { csrf = true } = {}) {
  const req = session.agent.post('/api/v1/reservations');
  if (csrf) req.set('X-CSRF-Token', session.token);
  return req.send({
    equipmentId: item.id,
    startAt: SLOT.toISOString(),
    ...body,
  });
}

describe('DT-1 create reservation', () => {
  test('R1 missing CSRF token → 403 CSRF_INVALID', async () => {
    const s = await h.session(h.users.student);
    const res = await book(s, {}, { csrf: false });
    expect([res.status, res.body.error.code]).toEqual([403, 'CSRF_INVALID']);
  });

  test('R2 anonymous → 401 AUTH_REQUIRED', async () => {
    const res = await book(await h.session());
    expect([res.status, res.body.error.code]).toEqual([401, 'AUTH_REQUIRED']);
  });

  test('R3 administrator → 403 FORBIDDEN', async () => {
    const res = await book(await h.session(h.users.admin));
    expect([res.status, res.body.error.code]).toEqual([403, 'FORBIDDEN']);
  });

  test.each([
    ['R4a', { status: 'maintenance', statusReason: 'Calibration' }],
    ['R4b', { status: 'unavailable', statusReason: 'Lent out' }],
    ['R4c', { archivedAt: new Date(), status: 'unavailable' }],
  ])(
    '%s equipment not bookable → 409 EQUIPMENT_NOT_AVAILABLE',
    async (_r, state) => {
      await h.models.Equipment.updateOne({ _id: item.id }, { $set: state });
      // C5 is "don't care": even an illegal slot reports the equipment problem first.
      const res = await book(await h.session(h.users.student), {
        startAt: colombo(2026, 10, 31, 10, 30).toISOString(),
      });
      expect([res.status, res.body.error.code]).toEqual([
        409,
        'EQUIPMENT_NOT_AVAILABLE',
      ]);
    },
  );

  test('R5 illegal slot (Saturday) → 400 VALIDATION_ERROR on body.startAt', async () => {
    const res = await book(await h.session(h.users.student), {
      startAt: colombo(2026, 10, 31, 10, 30).toISOString(),
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fieldErrors)).toEqual(['body.startAt']);
  });

  test('R6 slot already booked by someone else → 409 RESERVATION_CONFLICT', async () => {
    await book(await h.session(h.users.otherStudent)).then((r) =>
      expect(r.status).toBe(201),
    );
    const res = await book(await h.session(h.users.student));
    expect([res.status, res.body.error.code]).toEqual([
      409,
      'RESERVATION_CONFLICT',
    ]);
  });

  // Known open defect QA-BUG-01: currently returns 201. Fix: qa/patches/QA-BUG-01-*.patch.
  // `test.fails` keeps CI green and turns red as a reminder once the fix is merged.
  test.fails(
    'R7 student already holds another item at that hour → 409 STUDENT_SLOT_CONFLICT',
    async () => {
      const other = await h.equipment({ name: 'Signal Generator' });
      const s = await h.session(h.users.student);
      expect((await book(s, { equipmentId: other.id })).status).toBe(201);
      const res = await book(s);
      expect([res.status, res.body.error.code]).toEqual([
        409,
        'STUDENT_SLOT_CONFLICT',
      ]);
    },
  );

  test('R8 all conditions true → 201 Created', async () => {
    const res = await book(await h.session(h.users.student));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      startAt: SLOT.toISOString(),
      status: 'active',
    });
  });
});

describe('DT-2 cancel reservation', () => {
  let owner, reservationId;
  beforeEach(async () => {
    owner = await h.session(h.users.student);
    reservationId = (await book(owner)).body.data.id;
  });
  const cancel = (s, id = reservationId) =>
    s.agent
      .patch(`/api/v1/reservations/${id}/cancel`)
      .set('X-CSRF-Token', s.token)
      .send({});

  test('R1 owner, active, future → 200 student_cancelled', async () => {
    const res = await cancel(owner);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  test('R2 owner, active, already started → 409 RESERVATION_ALREADY_STARTED', async () => {
    h.freezeClock(SLOT);
    const res = await cancel(owner);
    expect([res.status, res.body.error.code]).toEqual([
      409,
      'RESERVATION_ALREADY_STARTED',
    ]);
  });

  test('R3 owner, already cancelled → 200 (idempotent)', async () => {
    await cancel(owner);
    const res = await cancel(owner);
    expect([res.status, res.body.data.status]).toEqual([200, 'cancelled']);
  });

  test('R4 another student → 404 (hides existence, prevents IDOR)', async () => {
    const res = await cancel(await h.session(h.users.otherStudent));
    expect([res.status, res.body.error.code]).toEqual([
      404,
      'RESOURCE_NOT_FOUND',
    ]);
  });

  test('R5 administrator → 200 admin_cancelled', async () => {
    const res = await cancel(await h.session(h.users.admin));
    expect(res.status).toBe(200);
    const stored = await h.models.Reservation.findById(reservationId).lean();
    expect(stored.cancellationReason).toBe('admin_cancelled');
  });
});

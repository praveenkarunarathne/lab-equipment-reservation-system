/**
 * EC4206 §3.5 BDD — Cucumber step definitions.
 * Steps drive the real Express API (via Supertest) on an in-memory MongoDB
 * replica set, using the same harness as the Vitest QA suites.
 */
import assert from 'node:assert/strict';
import {
  AfterAll,
  Before,
  BeforeAll,
  Given,
  Then,
  When,
  setDefaultTimeout,
} from '@cucumber/cucumber';
import { startHarness } from '../../qa/helpers/harness.js';
import { colombo } from '../../qa/helpers/colombo.js';

setDefaultTimeout(30_000);
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
let h;

/** "Tue 27 Oct 2026 10:30" (Asia/Colombo wall clock) → Date */
function when(text) {
  const [, day, mon, year, hh, mm] = text.match(
    /^\w{3} (\d{1,2}) (\w{3}) (\d{4}) (\d{2}):(\d{2})$/,
  );
  return colombo(+year, MONTHS.indexOf(mon) + 1, +day, +hh, +mm);
}
const byEmail = (email) =>
  Object.values(h.users).find((user) => user.email === email);

BeforeAll({ timeout: 180_000 }, async () => {
  h = await startHarness('qa_bdd');
});
AfterAll(async () => h?.stop());
Before(async function () {
  await h.reset();
  this.equipment = {};
  this.response = null;
});

async function book(session, equipment, slot) {
  return session.agent
    .post('/api/v1/reservations')
    .set('X-CSRF-Token', session.token)
    .send({ equipmentId: equipment.id, startAt: when(slot).toISOString() });
}

Given('the current time is {string} in Colombo', function (text) {
  h.freezeClock(when(text));
});

Given('the equipment {string} is available', async function (name) {
  this.equipment[name] = await h.equipment({ name });
});

Given('I am signed in as the student {string}', async function (email) {
  this.me = await h.session(byEmail(email));
});

Given(
  'the student {string} has booked {string} for {string}',
  async function (email, name, slot) {
    const res = await book(
      await h.session(byEmail(email)),
      this.equipment[name],
      slot,
    );
    assert.equal(res.status, 201);
  },
);

Given('I have booked {string} for {string}', async function (name, slot) {
  const res = await book(this.me, this.equipment[name], slot);
  assert.equal(res.status, 201);
});

When('I book {string} for {string}', async function (name, slot) {
  this.response = await book(this.me, this.equipment[name], slot);
});

Then('the booking is accepted', function () {
  assert.equal(this.response.status, 201, JSON.stringify(this.response.body));
  assert.equal(this.response.body.data.status, 'active');
});

Then('the booking is rejected with {string}', function (code) {
  assert.equal(this.response.body.error?.code, code);
});

Then('{string} is no longer offered for {string}', async function (slot, name) {
  const res = await this.me.agent
    .get(`/api/v1/equipment/${this.equipment[name].id}/availability`)
    .expect(200);
  const offered = res.body.data.slots.map((s) => s.startAt);
  assert.ok(!offered.includes(when(slot).toISOString()));
});

When(
  'an administrator puts {string} into maintenance because {string}',
  async function (name, reason) {
    const admin = await h.session(h.users.admin);
    const res = await admin.agent
      .patch(`/api/v1/equipment/${this.equipment[name].id}/status`)
      .set('X-CSRF-Token', admin.token)
      .send({ status: 'maintenance', reason });
    assert.equal(res.status, 200);
  },
);

Then(
  'my booking for {string} is cancelled with reason {string}',
  async function (slot, reason) {
    const res = await this.me.agent
      .get('/api/v1/reservations/mine')
      .query({ view: 'all' })
      .expect(200);
    const mine = res.body.data.find(
      (r) => r.startAt === when(slot).toISOString(),
    );
    assert.equal(mine.status, 'cancelled');
    assert.equal(mine.cancellationReason, reason);
  },
);

async function reportFault(session, equipment, category, title) {
  const res = await session.agent
    .post('/api/v1/fault-reports')
    .set('X-CSRF-Token', session.token)
    .send({
      equipmentId: equipment.id,
      category,
      title,
      description: 'Observed during the scheduled practical session.',
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.id;
}

When(
  'I report a {string} on {string} titled {string}',
  async function (category, name, title) {
    this.reportId = await reportFault(
      this.me,
      this.equipment[name],
      category,
      title,
    );
  },
);

Given(
  'the student {string} has reported a fault on {string}',
  async function (email, name) {
    const other = await h.session(byEmail(email));
    this.reportId = await reportFault(
      other,
      this.equipment[name],
      'damage',
      'Cracked housing',
    );
  },
);

Then('my fault report is {string}', async function (status) {
  const res = await this.me.agent
    .get(`/api/v1/fault-reports/${this.reportId}`)
    .expect(200);
  assert.equal(res.body.data.status, status);
});

When(
  'an administrator resolves the report with {string}',
  async function (note) {
    const admin = await h.session(h.users.admin);
    const res = await admin.agent
      .patch(`/api/v1/fault-reports/${this.reportId}/resolve`)
      .set('X-CSRF-Token', admin.token)
      .send({ resolutionNote: note });
    assert.equal(res.status, 200);
  },
);

When('I open that fault report', async function () {
  this.response = await this.me.agent.get(
    `/api/v1/fault-reports/${this.reportId}`,
  );
});

Then('I get a {string} error', function (code) {
  assert.equal(this.response.body.error?.code, code);
});

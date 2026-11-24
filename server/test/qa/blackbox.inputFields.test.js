/**
 * EC4206 §3.3 Black-box testing — request input fields.
 *
 * EP + BVA on the server-side validation schemas, i.e. the contract every
 * client (web UI, Postman, attacker) has to satisfy. IDs match the QA report.
 */
import { describe, expect, test } from 'vitest';
import { registrationSchema } from '../../src/modules/auth/auth.validation.js';
import { equipmentCreateSchema } from '../../src/modules/equipment/equipment.validation.js';
import {
  faultReportCreateSchema,
  faultReportResolveSchema,
} from '../../src/modules/faultReports/faultReport.validation.js';
import {
  reservationCreateSchema,
  reservationQuerySchema,
} from '../../src/modules/reservations/reservation.validation.js';

const ID = '507f1f77bcf86cd799439011';
const s = (n, ch = 'a') => ch.repeat(n);
const ok = (schema, value) => schema.safeParse(value).success;

const registration = (overrides) => ({
  name: 'Nimal Perera',
  email: 'student@example.com',
  password: s(15),
  ...overrides,
});

describe('Registration — password length (EP + BVA, 15–128 Unicode characters)', () => {
  test.each([
    ['TC-REG-01', 'empty (EP invalid)', '', false],
    ['TC-REG-02', '14 chars (min − 1)', s(14), false],
    ['TC-REG-03', '15 chars (min)', s(15), true],
    ['TC-REG-04', '16 chars (min + 1)', s(16), true],
    ['TC-REG-05', '64 chars (nominal)', s(64), true],
    ['TC-REG-06', '127 chars (max − 1)', s(127), true],
    ['TC-REG-07', '128 chars (max)', s(128), true],
    ['TC-REG-08', '129 chars (max + 1)', s(129), false],
    [
      'TC-REG-09',
      '15 emoji = 15 code points (Unicode class)',
      s(15, '🔬'),
      true,
    ],
  ])('%s %s', (_id, _label, password, valid) => {
    expect(ok(registrationSchema, registration({ password }))).toBe(valid);
  });
});

describe('Registration — name length after trimming (EP + BVA, 2–80)', () => {
  test.each([
    ['TC-REG-10', '1 char (min − 1)', 'A', false],
    ['TC-REG-11', '2 chars (min)', 'Al', true],
    ['TC-REG-12', '80 chars (max)', s(80), true],
    ['TC-REG-13', '81 chars (max + 1)', s(81), false],
    ['TC-REG-14', '"  A  " trims to 1 char', '  A  ', false],
  ])('%s %s', (_id, _label, name, valid) => {
    expect(ok(registrationSchema, registration({ name }))).toBe(valid);
  });
});

describe('Registration — email (EP)', () => {
  test.each([
    ['TC-REG-15', 'well-formed address', 'a.b@uni.ac.lk', true],
    ['TC-REG-16', 'missing @', 'student.example.com', false],
    ['TC-REG-17', 'missing domain', 'student@', false],
    [
      'TC-REG-18',
      'mixed case + spaces is normalised',
      '  Student@Example.COM ',
      true,
    ],
    [
      'TC-REG-19',
      'unknown extra field is rejected (strict object)',
      null,
      false,
    ],
  ])('%s %s', (_id, _label, email, valid) => {
    const body =
      email === null
        ? { ...registration(), role: 'admin' }
        : registration({ email });
    expect(ok(registrationSchema, body)).toBe(valid);
  });

  test('TC-REG-20 normalised email is lower-case and trimmed', () => {
    const parsed = registrationSchema.parse(
      registration({ email: '  Student@Example.COM ' }),
    );
    expect(parsed.email).toBe('student@example.com');
  });
});

const equipment = (overrides) => ({
  assetCode: 'MIC-01',
  name: 'Microscope',
  category: 'Optics',
  location: 'Lab A',
  ...overrides,
});

describe('Equipment — asset code (EP + BVA, 2–30, ^[A-Z0-9][A-Z0-9_-]*$)', () => {
  test.each([
    ['TC-EQ-01', '1 char (min − 1)', 'A', false],
    ['TC-EQ-02', '2 chars (min)', 'A1', true],
    ['TC-EQ-03', '30 chars (max)', s(30, 'A'), true],
    ['TC-EQ-04', '31 chars (max + 1)', s(31, 'A'), false],
    ['TC-EQ-05', 'lower case is upper-cased (valid class)', 'osc-02', true],
    ['TC-EQ-06', 'leading hyphen (invalid class)', '-OSC', false],
    ['TC-EQ-07', 'embedded space (invalid class)', 'OSC 02', false],
    ['TC-EQ-08', 'symbol outside the alphabet', 'OSC#2', false],
  ])('%s %s', (_id, _label, assetCode, valid) => {
    expect(ok(equipmentCreateSchema, equipment({ assetCode }))).toBe(valid);
  });

  test('TC-EQ-09 description upper boundary is 1000 characters', () => {
    expect(ok(equipmentCreateSchema, equipment({ description: s(1000) }))).toBe(
      true,
    );
    expect(ok(equipmentCreateSchema, equipment({ description: s(1001) }))).toBe(
      false,
    );
  });
});

const fault = (overrides) => ({
  equipmentId: ID,
  category: 'malfunction',
  title: 'Lamp flickers',
  description: 'The illumination lamp flickers after five minutes.',
  ...overrides,
});

describe('Fault report — title 5–100, description 10–2000 (BVA)', () => {
  test.each([
    ['TC-FR-01', 'title 4', { title: s(4) }, false],
    ['TC-FR-02', 'title 5', { title: s(5) }, true],
    ['TC-FR-03', 'title 100', { title: s(100) }, true],
    ['TC-FR-04', 'title 101', { title: s(101) }, false],
    ['TC-FR-05', 'description 9', { description: s(9) }, false],
    ['TC-FR-06', 'description 10', { description: s(10) }, true],
    ['TC-FR-07', 'description 2000', { description: s(2000) }, true],
    ['TC-FR-08', 'description 2001', { description: s(2001) }, false],
    [
      'TC-FR-09',
      'category outside the enum (EP)',
      { category: 'cosmetic' },
      false,
    ],
  ])('%s %s', (_id, _label, overrides, valid) => {
    expect(ok(faultReportCreateSchema, fault(overrides))).toBe(valid);
  });

  test.each([
    ['TC-FR-10', 'resolution note 4', 4, false],
    ['TC-FR-11', 'resolution note 5', 5, true],
    ['TC-FR-12', 'resolution note 1000', 1000, true],
    ['TC-FR-13', 'resolution note 1001', 1001, false],
  ])('%s %s', (_id, _label, n, valid) => {
    expect(ok(faultReportResolveSchema, { resolutionNote: s(n) })).toBe(valid);
  });
});

describe('Reservation request — startAt format and pagination (EP + BVA)', () => {
  test.each([
    ['TC-RS-01', 'ISO with Z offset', '2026-10-27T05:00:00.000Z', true],
    ['TC-RS-02', 'ISO with +05:30 offset', '2026-10-27T10:30:00+05:30', true],
    [
      'TC-RS-03',
      'no offset (ambiguous local time)',
      '2026-10-27T10:30:00',
      false,
    ],
    [
      'TC-RS-04',
      'non-zero fractional second',
      '2026-10-27T05:00:00.001Z',
      false,
    ],
    ['TC-RS-05', 'date only', '2026-10-27', false],
  ])('%s %s', (_id, _label, startAt, valid) => {
    expect(ok(reservationCreateSchema, { equipmentId: ID, startAt })).toBe(
      valid,
    );
  });

  test.each([
    ['TC-RS-06', 'limit 0 (min − 1)', { limit: '0' }, false],
    ['TC-RS-07', 'limit 1 (min)', { limit: '1' }, true],
    ['TC-RS-08', 'limit 50 (max)', { limit: '50' }, true],
    ['TC-RS-09', 'limit 51 (max + 1)', { limit: '51' }, false],
    ['TC-RS-10', 'page 0', { page: '0' }, false],
    ['TC-RS-11', 'page 1', { page: '1' }, true],
    ['TC-RS-12', 'unknown view', { view: 'future' }, false],
  ])('%s %s', (_id, _label, query, valid) => {
    expect(ok(reservationQuerySchema, query)).toBe(valid);
  });
});

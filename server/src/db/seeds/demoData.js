import { createHash } from 'node:crypto';
import { legalSlotStarts } from '../../modules/reservations/reservationTime.js';
import { SLOT_DURATION_MS } from '../../config/constants.js';

export const DEMO_PASSWORD = 'Lab demo password 2026!';
export function demoId(key) {
  return createHash('sha256')
    .update(`lab-equipment-demo-v1:${key}`)
    .digest('hex')
    .slice(0, 24);
}
export const DEMO_ACCOUNTS = [
  {
    _id: demoId('admin'),
    name: 'Demo Administrator',
    email: 'demo.admin@example.test',
    role: 'admin',
  },
  {
    _id: demoId('student1'),
    name: 'Demo Student One',
    email: 'demo.student1@example.test',
    role: 'student',
  },
  {
    _id: demoId('student2'),
    name: 'Demo Student Two',
    email: 'demo.student2@example.test',
    role: 'student',
  },
];

export function createDemoData(now) {
  const admin = DEMO_ACCOUNTS[0]._id;
  const students = DEMO_ACCOUNTS.slice(1).map((user) => user._id);
  const day = 24 * 60 * 60 * 1000;
  const equipment = [
    ['MIC', 'Optical microscope', 'Optics', 'Lab A', 'available', null],
    ['OSC', 'Digital oscilloscope', 'Electronics', 'Lab A', 'available', null],
    ['DMM', 'Digital multimeter', 'Electronics', 'Lab A', 'available', null],
    ['PSU', 'Bench power supply', 'Electronics', 'Lab B', 'available', null],
    ['SIG', 'Signal generator', 'Electronics', 'Lab B', 'available', null],
    ['BAL', 'Precision balance', 'Measurement', 'Lab C', 'available', null],
    [
      '3DP',
      '3D printer',
      'Mechanical',
      'Workshop',
      'maintenance',
      'Nozzle replacement and calibration in progress.',
    ],
    [
      'CAL',
      'Digital caliper',
      'Measurement',
      'Lab C',
      'maintenance',
      'Scheduled accuracy calibration.',
    ],
    [
      'FNC',
      'Laboratory furnace',
      'Thermal',
      'Lab D',
      'unavailable',
      'Awaiting a replacement temperature controller.',
    ],
    [
      'OLD',
      'Retired microscope',
      'Optics',
      'Store room',
      'unavailable',
      'Equipment archived.',
    ],
  ].map(([code, name, category, location, status, statusReason]) => ({
    _id: demoId(`equipment:${code}`),
    assetCode: `DEMO-${code}-01`,
    name,
    category,
    location,
    description: `${name} for supervised laboratory practicals. Sample equipment for demonstration.`,
    status,
    statusReason,
    statusUpdatedBy: admin,
    statusUpdatedAt: now,
    archivedAt: code === 'OLD' ? now : null,
    archivedBy: code === 'OLD' ? admin : null,
    createdAt: new Date(now.getTime() - 20 * day),
  }));
  const past = legalSlotStarts(new Date(now.getTime() - 14 * day)).filter(
    (start) => start.getTime() + SLOT_DURATION_MS <= now.getTime(),
  );
  const future = legalSlotStarts(now);
  const reservations = [];
  function reserve(item, key, startAt, student, reason = null) {
    reservations.push({
      _id: demoId(`reservation:${key}`),
      equipmentId: item._id,
      studentId: student,
      startAt,
      status: reason ? 'cancelled' : 'active',
      cancelledAt: reason ? now : null,
      cancelledBy: reason
        ? reason === 'student_cancelled'
          ? student
          : admin
        : null,
      cancellationReason: reason,
      createdAt: new Date(
        Math.min(startAt.getTime() - day, now.getTime() - day),
      ),
    });
  }
  // Unequal historical counts make the dashboard ranking useful immediately.
  equipment.forEach((item, index) => {
    const count = Math.max(1, 6 - index);
    for (let slot = 0; slot < count; slot += 1)
      reserve(
        item,
        `past:${index}:${slot}`,
        past[past.length - 1 - slot],
        students[slot % 2],
      );
    if (index < 6)
      reserve(item, `future:${index}`, future[index], students[index % 2]);
  });
  reserve(
    equipment[0],
    'student-cancelled',
    future[7],
    students[0],
    'student_cancelled',
  );
  reserve(
    equipment[1],
    'admin-cancelled',
    future[8],
    students[1],
    'admin_cancelled',
  );
  reserve(
    equipment[6],
    'maintenance-cancelled',
    future[9],
    students[0],
    'equipment_maintenance',
  );
  reserve(
    equipment[8],
    'unavailable-cancelled',
    future[10],
    students[1],
    'equipment_unavailable',
  );
  reserve(
    equipment[9],
    'archive-cancelled',
    future[11],
    students[0],
    'equipment_archived',
  );
  const faults = [
    [
      0,
      'malfunction',
      'Image flickers intermittently',
      'The image flickers after several minutes of normal operation.',
      null,
    ],
    [
      2,
      'damage',
      'Damaged probe insulation',
      'The red probe insulation has visible wear near the connector.',
      null,
    ],
    [
      6,
      'calibration',
      'Print dimensions drift',
      'Printed test pieces differ from their specified dimensions.',
      null,
    ],
    [
      8,
      'safety',
      'Temperature reading fluctuates',
      'The displayed temperature fluctuates unexpectedly during warm-up.',
      null,
    ],
    [
      9,
      'other',
      'Retired equipment follow-up',
      'Archived microscope needs a final staff inspection before disposal.',
      null,
    ],
    [
      1,
      'calibration',
      'Oscilloscope offset corrected',
      'A DC offset was visible with the input connected to ground.',
      'Recalibrated the input and verified the reference signal.',
    ],
    [
      4,
      'malfunction',
      'Output connector repaired',
      'The output signal was intermittent when the cable moved.',
      'Replaced the output connector and verified signal stability.',
    ],
  ].map(([index, category, title, description, resolutionNote], order) => ({
    _id: demoId(`fault:${order}`),
    equipmentId: equipment[index]._id,
    reportedBy: students[order % 2],
    category,
    title,
    description,
    status: resolutionNote ? 'resolved' : 'open',
    resolutionNote,
    resolvedAt: resolutionNote ? now : null,
    resolvedBy: resolutionNote ? admin : null,
    createdAt: new Date(now.getTime() - (order + 1) * day),
  }));
  return { equipment, reservations, faults };
}

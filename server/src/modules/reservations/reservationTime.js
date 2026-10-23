import { TZDate } from '@date-fns/tz';
import { addDays, format } from 'date-fns';
import {
  BUSINESS_TIMEZONE,
  BOOKING_WEEKDAYS,
  SLOT_START_TIMES,
  SLOT_DURATION_MS,
  BOOKING_HORIZON_DAYS,
} from '../../config/constants.js';
import { AppError } from '../../shared/AppError.js';

export function bookingHorizon(serverNow) {
  return new Date(
    addDays(
      new TZDate(serverNow, BUSINESS_TIMEZONE),
      BOOKING_HORIZON_DAYS,
    ).getTime(),
  );
}

export function assertLegalStart(startAt, serverNow) {
  let message;
  if (!Number.isFinite(startAt.getTime()))
    message = 'Start time must be a valid instant.';
  else if (startAt <= serverNow)
    message = 'The slot must start strictly in the future.';
  else if (startAt > bookingHorizon(serverNow))
    message = 'The slot must be within the next 14 days.';
  else {
    const local = new TZDate(startAt, BUSINESS_TIMEZONE);
    const time = format(local, 'HH:mm');
    if (
      !BOOKING_WEEKDAYS.includes(local.getDay()) ||
      !SLOT_START_TIMES.includes(time) ||
      local.getSeconds() !== 0 ||
      local.getMilliseconds() !== 0
    ) {
      message =
        'Choose a weekday slot starting hourly from 08:30 through 15:30 in Asia/Colombo.';
    }
  }
  if (message)
    throw new AppError(400, 'VALIDATION_ERROR', message, {
      'body.startAt': [message],
    });
}

export function legalSlotStarts(serverNow) {
  const local = new TZDate(serverNow, BUSINESS_TIMEZONE);
  const firstDay = new TZDate(
    local.getFullYear(),
    local.getMonth(),
    local.getDate(),
    0,
    0,
    0,
    0,
    BUSINESS_TIMEZONE,
  );
  const horizon = bookingHorizon(serverNow);
  const starts = [];
  for (let offset = 0; offset <= BOOKING_HORIZON_DAYS; offset += 1) {
    const day = addDays(firstDay, offset);
    if (!BOOKING_WEEKDAYS.includes(day.getDay())) continue;
    for (const time of SLOT_START_TIMES) {
      const [hour, minute] = time.split(':').map(Number);
      const start = new TZDate(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        hour,
        minute,
        0,
        0,
        BUSINESS_TIMEZONE,
      );
      if (start > serverNow && start <= horizon)
        starts.push(new Date(start.getTime()));
    }
  }
  return starts;
}

export function slotDto(startAt) {
  const endAt = new Date(startAt.getTime() + SLOT_DURATION_MS);
  const localStart = new TZDate(startAt, BUSINESS_TIMEZONE);
  const localEnd = new TZDate(endAt, BUSINESS_TIMEZONE);
  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    label: `${format(localStart, 'EEE, dd MMM yyyy HH:mm')}–${format(localEnd, 'HH:mm')}`,
  };
}

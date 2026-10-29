const DAY_MS = 86_400_000;

export function queueDateAtNineUtc(value: Date) {
  const result = new Date(value);
  result.setUTCHours(9, 0, 0, 0);
  return result;
}

export function queueDateKey(value: Date) {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 9));
}

function shiftedDateKey(value: Date, days: number) {
  return queueDateKey(new Date(value.getTime() + days * DAY_MS));
}

export function brazilLabHolidayName(value: Date) {
  const year = value.getUTCFullYear();
  const key = queueDateKey(value);
  const fixed: Record<string, string> = {
    [`${year}-01-01`]: "New Year's Day",
    [`${year}-01-25`]: 'Anniversary of São Paulo',
    [`${year}-04-21`]: 'Tiradentes Day',
    [`${year}-05-01`]: 'Labour Day',
    [`${year}-07-09`]: 'Constitutionalist Revolution (São Paulo)',
    [`${year}-09-07`]: 'Independence Day',
    [`${year}-10-12`]: 'Our Lady of Aparecida',
    [`${year}-11-02`]: "All Souls' Day",
    [`${year}-11-15`]: 'Republic Proclamation Day',
    [`${year}-11-20`]: 'Black Consciousness Day',
    [`${year}-12-25`]: 'Christmas Day',
  };
  if (fixed[key]) return fixed[key];

  const easter = easterSunday(year);
  const movable: Record<string, string> = {
    [shiftedDateKey(easter, -48)]: 'Carnival Monday',
    [shiftedDateKey(easter, -47)]: 'Carnival Tuesday',
    [shiftedDateKey(easter, -2)]: 'Good Friday',
    [shiftedDateKey(easter, 60)]: 'Corpus Christi',
  };
  return movable[key] ?? null;
}

export function isQueueWorkingDay(value: Date) {
  const day = value.getUTCDay();
  return day !== 0 && day !== 6 && !brazilLabHolidayName(value);
}

export function nextQueueWorkingDay(value: Date, includeCurrent = false) {
  const result = queueDateAtNineUtc(value);
  if (!includeCurrent) result.setUTCDate(result.getUTCDate() + 1);
  while (!isQueueWorkingDay(result)) result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

export function addQueueWorkingDays(value: Date, numberOfDays: number) {
  const result = nextQueueWorkingDay(value, true);
  let remaining = Math.max(0, Math.floor(numberOfDays));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isQueueWorkingDay(result)) remaining -= 1;
  }
  return result;
}

export function countQueueWorkingDays(start: Date, end: Date) {
  if (end < start) return 0;
  const cursor = queueDateAtNineUtc(start);
  const boundary = queueDateAtNineUtc(end);
  let count = 0;
  while (cursor <= boundary) {
    if (isQueueWorkingDay(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

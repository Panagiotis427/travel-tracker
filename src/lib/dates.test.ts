import { describe, it, expect } from 'vitest';
import { isoTime, durationDays, distinctTripDays, fmtDuration } from './dates';

describe('isoTime', () => {
  it('parses the client and the server timestamp formats to the same instant', () => {
    expect(isoTime('2026-05-01T10:00:00.000Z')).toBe(isoTime('2026-05-01T10:00:00+00:00'));
    expect(isoTime('2026-05-01T12:00:00+02:00')).toBe(isoTime('2026-05-01T10:00:00Z'));
  });

  it('treats missing or invalid input as 0 (oldest)', () => {
    expect(isoTime(undefined)).toBe(0);
    expect(isoTime('')).toBe(0);
    expect(isoTime('not a date')).toBe(0);
  });
});

describe('durationDays', () => {
  it('counts inclusive days and rejects incomplete or reversed ranges', () => {
    expect(durationDays('2026-01-01', '2026-01-01')).toBe(1);
    expect(durationDays('2026-01-01', '2026-01-10')).toBe(10);
    expect(durationDays('2026-01-10', '2026-01-01')).toBeNull();
    expect(durationDays('2026-01-01', undefined)).toBeNull();
  });
});

describe('distinctTripDays', () => {
  it('counts a day once when a country and its region both record it', () => {
    const day = { start: '2026-09-29', end: '2026-09-29' };
    expect(distinctTripDays([day, day])).toBe(1);
  });

  it('merges overlapping trips and accepts datetime values', () => {
    expect(distinctTripDays([
      { start: '2026-01-01T09:00', end: '2026-01-05T18:00' },
      { start: '2026-01-04', end: '2026-01-07' },
    ])).toBe(7);
  });

  it('ignores incomplete and reversed trips', () => {
    expect(distinctTripDays([{ start: '2026-01-01' }, { start: '2026-01-10', end: '2026-01-01' }, {}])).toBe(0);
  });
});

describe('fmtDuration', () => {
  it('picks a readable unit', () => {
    expect(fmtDuration(1)).toBe('1 day');
    expect(fmtDuration(21)).toBe('3 weeks');
    expect(fmtDuration(null)).toBe('');
  });
});

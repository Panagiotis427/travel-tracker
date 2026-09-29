import { describe, it, expect } from 'vitest';
import { isoTime, durationDays, fmtDuration } from './dates';

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

describe('fmtDuration', () => {
  it('picks a readable unit', () => {
    expect(fmtDuration(1)).toBe('1 day');
    expect(fmtDuration(21)).toBe('3 weeks');
    expect(fmtDuration(null)).toBe('');
  });
});

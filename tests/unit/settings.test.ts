import { describe, expect, it } from 'vitest';
import { metronomeWanted, sanitizeSettings } from '../../src/ui/settings';

describe('settings', () => {
  it('defaults and clamps', () => {
    expect(sanitizeSettings(null)).toEqual({ offsetMs: 0, metro: false, metroRec: true });
    expect(sanitizeSettings({ offsetMs: 999, metro: true }).offsetMs).toBe(250);
    expect(sanitizeSettings({ offsetMs: -999 }).offsetMs).toBe(-50);
    expect(sanitizeSettings({ offsetMs: 'x', metroRec: 3 })).toEqual({ offsetMs: 0, metro: false, metroRec: true });
  });
  it('metronome wanted', () => {
    const s = { offsetMs: 0, metro: false, metroRec: true };
    expect(metronomeWanted(s, true, true)).toBe(true);
    expect(metronomeWanted(s, true, false)).toBe(false);
    expect(metronomeWanted(s, false, true)).toBe(false);
    expect(metronomeWanted({ ...s, metroRec: false }, true, true)).toBe(false);
    expect(metronomeWanted({ ...s, metro: true }, false, false)).toBe(true);
  });
});

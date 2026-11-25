import { describe, expect, it } from 'vitest';
import { chainText, hasExtras, keyCount, keyLabel, knobToPitch, knobToTone, lenBetween, lowestKey, noteName, pitchToKnob, stepLabel, toneToKnob } from '../../src/ui/stepHelpers';
import { emptySound } from '../../src/store/defaults';

describe('step helpers', () => {
  it('names notes', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C#4');
    expect(noteName(69)).toBe('A4');
    expect(noteName(11)).toBe('B-1');
  });
  it('computes length between steps', () => {
    expect(lenBetween(2, 6)).toBe(4);
    expect(lenBetween(14, 1)).toBe(3);
    expect(lenBetween(5, 5)).toBe(16);
  });
  it('counts keys and labels', () => {
    expect(lowestKey(0b1010)).toBe(1);
    expect(lowestKey(0)).toBe(-1);
    expect(keyCount(0b1011)).toBe(3);
    const m = emptySound(0);
    expect(keyLabel(m, 4)).toBe('E4');
    expect(stepLabel(m, { keys: 0b10001 })).toBe('C4+');
    const d = { ...emptySound(9), hitNames: ['Kick Deep', 'Snare'] };
    expect(keyLabel(d, 0)).toBe('Kick');
    expect(keyLabel(d, 5)).toBe('6');
  });
  it('formats chains and maps locks', () => {
    expect(chainText([0, 2, 1])).toBe('CHAIN 1-3-2');
    expect(hasExtras({ keys: 1 })).toBe(false);
    expect(hasExtras({ keys: 1, lockA: 0 })).toBe(true);
    expect(knobToPitch(pitchToKnob(7))).toBe(7);
    expect(knobToPitch(0.5)).toBe(0);
    expect(knobToTone(0.5)).toBe(0);
    expect(knobToTone(toneToKnob(40))).toBe(40);
  });
});

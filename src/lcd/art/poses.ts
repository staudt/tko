// Pose table for the kitchen art: which segment ids are lit for a given pose + frame.
// Pure (no DOM): `show(id)` is supplied by the caller. Used by the rAF loop in Art.tsx and by the look-dev page.

export type PoseName =
  | 'idle' | 'bob' | 'stir' | 'chop' | 'snare' | 'cleaver' | 'salt' | 'mallet' | 'lid'
  | 'pan' | 'tape' | 'dial' | 'lofi' | 'gate' | 'reverse' | 'throw' | 'sing';
export type CatName = 'sleep' | 'awake' | 'ears';

/** Number of frames per pose (frame index 0..n-1). */
export const POSE_FRAMES: Record<PoseName, number> = {
  idle: 4, bob: 2, stir: 2, chop: 2, snare: 2, cleaver: 2, salt: 2, mallet: 2, lid: 2,
  pan: 2, tape: 2, dial: 3, lofi: 4, gate: 2, reverse: 2, throw: 3, sing: 3,
};

export type Show = (id: string) => void;

/**
 * Draw one chef pose. `arg`: stir = pitch level 1..4; throw = 0 reverb / 1 delay; dial = 0 low / 1 high.
 * Returns true when the whole scene should be dimmed (gate flicker).
 */
export function drawPose(pose: PoseName, frame: number, arg: number, show: Show): boolean {
  const f = frame;
  let pot = true;
  let dim = false;
  let lamp = true;
  switch (pose) {
    case 'idle':
      show('arms_down');
      if (f === 3) { show('head_taste'); show('armR_taste'); show('legs_stand'); }
      else { show('head0'); show(f === 1 ? 'legs_tap' : 'legs_stand'); }
      break;
    case 'bob':
      show(f ? 'head1' : 'head0'); show('arms_down'); show('legs_stand');
      break;
    case 'stir':
      show('head0'); show('legs_stand');
      show(f ? 'armR_stir_r' : 'armR_stir_l');
      for (let i = 1; i <= Math.min(4, arg); i++) show('rise' + i);
      if (arg >= 2) show('steam1');
      if (arg >= 3) show('steam2');
      if (arg >= 4) show('steam3');
      break;
    case 'chop': show('head0'); show('legs_stand'); show(f ? 'chop_b' : 'chop_a'); break;
    case 'snare':
      show('head0'); show('legs_stand'); show(f ? 'chop_b' : 'chop_a'); show(f ? 'slice_a' : 'slice_b');
      break;
    case 'cleaver':
      show('head0'); show('legs_stand'); show(f ? 'cleaver_b' : 'cleaver_a'); if (f) show('shock');
      break;
    case 'mallet':
      show('head0'); show('legs_stand'); show(f ? 'mallet_b' : 'mallet_a'); if (f) show('shock');
      break;
    case 'salt':
      show('head0'); show('legs_stand'); show(f ? 'salt_b' : 'salt_a'); show(f ? 'salt_dots_b' : 'salt_dots_a');
      break;
    case 'lid':
      show('head0'); show('legs_stand'); show(f ? 'armR_lid_dn' : 'armR_lid_up'); if (f) show('clang');
      break;
    case 'pan':
      pot = false; show('head0'); show('legs_stand');
      show(f ? 'armR_pan_b' : 'armR_pan_a'); show(f ? 'cake_up' : 'cake_dn'); show(f ? 'flame_b' : 'flame_a');
      break;
    case 'tape':
      show(f ? 'head_sleep_b' : 'head_sleep_a'); show('arms_down'); show('legs_stand'); show('cz1'); if (f) show('cz2');
      break;
    case 'dial':
      show('head0'); show('legs_stand'); show('armR_dial');
      show((arg ? ['dial_a', 'dial_c', 'dial_b'] : ['dial_b', 'dial_c', 'dial_a'])[f % 3]!);
      break;
    case 'lofi':
      show('head_x'); show('arms_down'); show('legs_stand');
      if (f === 0) show('smoke1');
      else if (f === 1) { show('smoke1'); show('smoke2'); }
      else if (f === 2) { show('smoke2'); show('smoke3'); }
      else show('smoke3');
      break;
    case 'gate':
      show('head0'); show('arms_down'); show('legs_stand');
      if (f) { dim = true; lamp = false; }
      break;
    case 'reverse':
      show('head0'); show('arms_down'); show(f ? 'legs_w2' : 'legs_w1'); show('arrows_rev');
      break;
    case 'throw':
      show('head0'); show('legs_stand');
      show(f === 0 ? 'armR_throw_a' : 'armR_throw_b');
      show('dots1');
      if (f >= 1) show('dots2');
      if (f >= 2) show(arg ? 'dots3' : 'ring');
      break;
    case 'sing':
      show('head_sing'); show('armR_sing'); show('legs_stand'); show('notes' + (f + 1));
      break;
  }
  if (pot) show('pot');
  if (lamp) show('lamp_rays');
  return dim;
}

export function drawCat(cat: CatName, tailB: boolean, zzz: number, show: Show): void {
  show('cat_' + cat);
  if (cat !== 'ears') show(tailB ? 'tail_b' : 'tail_a');
  if (cat === 'sleep') for (let i = 1; i <= 1 + (zzz % 3); i++) show('zzz' + i);
}

/** Classify a drum hit by its name (keyword match), falling back to the key index. */
export function drumPose(name: string | undefined, key: number): PoseName {
  if (name) {
    const n = name.toLowerCase();
    if (/kick|boom|thump|thud|sub|808|punch/.test(n)) return 'cleaver';
    if (/snare|clap|snap|rim|sidestick/.test(n)) return 'snare';
    if (/hat|shaker|tamb|closed|open|pedal|tick|hh/.test(n)) return 'salt';
    if (/crash|ride|cymbal|metal|clang|shimmer|bell|wash/.test(n)) return 'lid';
    if (/tom|conga|bongo/.test(n)) return 'mallet';
    return 'chop';
  }
  if (key < 3) return 'cleaver';
  if (key < 6) return 'snare';
  if (key < 10) return 'salt';
  if (key < 13) return 'mallet';
  return 'lid';
}

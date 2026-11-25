// Kitchen-chaos LCD art: one SVG, every pose and prop pre-drawn as a path group.
// The animator never changes geometry; it only toggles the `on` class on `[data-seg]` groups.
// OFF groups stay faintly visible (ghosting, see .art .seg in ui.css). Static groups (data-static) are always on.
//
// SEGMENT IDS (the contract: redraw any of them without touching code; keep the id and the viewBox 340x110)
//   scene (static, always on): floor counter board stove pot dial lamp shelf body
//   lamp_rays        light rays; blink with the whole scene during the gate FX
//   chef heads       head0 head1(bob, lower) head_taste head_sleep_a head_sleep_b head_sing head_x(lofi)
//   chef legs        legs_stand legs_tap legs_w1 legs_w2 (walk) arrows_rev
//   chef arms        arms_down armR_taste armR_stir_l armR_stir_r armR_sing armR_dial armR_throw_a armR_throw_b
//                    armR_lid_up armR_lid_dn (arm + pot lid) armR_pan_a armR_pan_b (arm + frying pan)
//   chop actions     chop_a(knife up) chop_b(knife down) cleaver_a cleaver_b mallet_a mallet_b salt_a salt_b
//                    salt_dots_a salt_dots_b shock slice_a slice_b
//   pot / melodic    rise1..rise4 (bubbles, cumulative with pitch) steam1..steam3 (more steam for higher keys)
//   lid              clang (vibration lines)
//   pan / fx         flame_a flame_b cake_dn cake_up
//   dial             dial_a dial_b dial_c (pointer positions)
//   fx props         smoke1..smoke3 dots1..dots3 ring
//   sing             notes1..notes3
//   zzz              zzz1..zzz3 (cat) cz1 cz2 (chef)
//   cat              cat_sleep cat_awake cat_ears tail_a tail_b
// Arm groups include the hand and the tool they hold; head groups include hat and face.

const r = (n: number) => Math.round(n * 10) / 10;
const circle = (x: number, y: number, rad: number) => `M${r(x - rad)} ${y}a${rad} ${rad} 0 1 0 ${rad * 2} 0a${rad} ${rad} 0 1 0 ${-rad * 2} 0`;
const dot = (x: number, y: number) => `M${x} ${y}v.1`;
const spark = (x: number, y: number) => `M${x} ${y}h1.4`;
const note = (x: number, y: number) => `M${x} ${y}v-9l5 2M${x - 2.5} ${y}a2.5 2 0 1 0 5 0a2.5 2 0 1 0 -5 0`;
/** Cloud outline from three bumps. */
const cloud = (x: number, y: number, s: number) =>
  `M${r(x - 9 * s)} ${y}a${4 * s} ${4 * s} 0 0 1 ${2 * s} ${-7 * s}a${5 * s} ${5 * s} 0 0 1 ${9 * s} ${-3 * s}a${5 * s} ${5 * s} 0 0 1 ${9 * s} ${3 * s}a${4 * s} ${4 * s} 0 0 1 ${s} ${7 * s}z`;
/** Knife: handle from hand (hx,hy) toward tip (tx,ty), blade triangle on the far 70%. */
function knife(hx: number, hy: number, tx: number, ty: number): string {
  const dx = tx - hx;
  const dy = ty - hy;
  const l = Math.hypot(dx, dy);
  const nx = (-dy / l) * 4;
  const ny = (dx / l) * 4;
  const bx = hx + dx * 0.3;
  const by = hy + dy * 0.3;
  return `M${hx} ${hy}L${r(bx)} ${r(by)}M${r(bx + nx)} ${r(by + ny)}L${r(bx - nx * 0.2)} ${r(by - ny * 0.2)}L${tx} ${ty}Z`;
}

const HAT = (dy: number) =>
  `M159 ${29 + dy}C151 ${28 + dy} 150 ${17 + dy} 158 ${15 + dy}C158 ${9 + dy} 168 ${7 + dy} 171 ${11 + dy}C175 ${7 + dy} 185 ${9 + dy} 184 ${15 + dy}C191 ${17 + dy} 190 ${28 + dy} 181 ${29 + dy}M159 ${29 + dy}H181`;
const FACE = (dy: number) => circle(170, 40 + dy, 11);
const EYES = (dy: number) => `${dot(166, 39 + dy)}${dot(174, 39 + dy)}`;
const SMILE = (dy: number) => `M165 ${44 + dy}q5 4 10 0`;

type Seg = { id: string; d: string };
const S: Seg[] = [];
const seg = (id: string, ...d: string[]) => S.push({ id, d: d.join('') });
/** Segments with 2+ separate sub-paths per id are fine; `d` strings are concatenated. */

// ---- static scene ----
seg('floor', 'M8 104H332');
seg('counter', 'M66 80H138M70 80V104M134 80V104');
seg('board', 'M80 76H128V80H80zM98 75q0-4 6-4h8q4 0 4 4');
seg('stove', 'M205 80H290V104M205 80V104M210 80v-3M285 80v-3');
seg('pot', 'M224 62H270V76q0 4-4 4H228q-4 0-4-4zM220 62H274M224 66h-6M270 66h6');
seg('dial', circle(226, 92, 5), 'M218 85l-2-2M226 83v-3M234 85l2-2');
seg('lamp', 'M310 0V10M301 22L305 10H315L319 22z');
seg('shelf', 'M8 46H74M12 46v8M70 46v8');
seg('body', 'M160 52L180 52L184 82H156zM163 66H177V82M170 57v.1M170 62v.1');
seg('lamp_rays', 'M297 28l-5 5M310 28v7M323 28l5 5');

// ---- chef heads (hat + face) ----
seg('head0', HAT(0), FACE(0), EYES(0), SMILE(0));
seg('head1', HAT(3), FACE(3), EYES(3), SMILE(3));
seg('head_taste', HAT(0), FACE(0), 'M165 38q2 2 4 0M171 38q2 2 4 0', 'M167 45q3 4 6 0');
seg('head_sleep_a', HAT(2), FACE(2), 'M163 41q3 2 6 0M171 41q3 2 6 0', 'M166 47h8');
seg('head_sleep_b', HAT(5), FACE(5), 'M163 44q3 2 6 0M171 44q3 2 6 0', 'M166 50q4 2 8 0');
seg('head_sing', HAT(-1), FACE(-1), 'M164 37q2-2 4 0M172 37q2-2 4 0', circle(170, 44, 2.6));
seg('head_x', HAT(0), FACE(0), 'M164 37l4 4M168 37l-4 4M172 37l4 4M176 37l-4 4', 'M165 46q2-3 5 0t5 0');

// ---- legs ----
seg('legs_stand', 'M163 82V100M177 82V100M163 100H156M177 100H184');
seg('legs_tap', 'M163 82V100M163 100H156M177 82V95L186 92', 'M190 101h3M194 98l2-2');
seg('legs_w1', 'M165 82L156 100H149M175 82L184 100H191');
seg('legs_w2', 'M165 82L172 100H165M175 82L172 100H179M168 100h5');
seg('arrows_rev', 'M140 98H116M122 94l-6 4l6 4M110 98h-4');

// ---- arms (hand + tool) ----
seg('arms_down', 'M162 56L156 68L158 78M178 56L184 68L182 78');
seg('armR_taste', 'M162 56L156 68L158 78M178 56L192 62L180 46', 'M180 46L186 38', circle(187, 36, 3));
seg('armR_stir_l', 'M162 56L156 68L158 78M178 56L196 54L214 50', 'M214 50L238 72', circle(239, 73, 2.5));
seg('armR_stir_r', 'M162 56L156 68L158 78M178 56L204 52L226 46', 'M226 46L258 72', circle(259, 73, 2.5));
seg('armR_sing', 'M162 56L156 68L158 78M178 56L194 60L187 51', 'M187 51L199 74', circle(184, 48, 4.5));
seg('armR_dial', 'M162 56L156 68L158 78M178 56L196 74L218 88');
seg('armR_throw_a', 'M162 56L156 68L158 78M178 56L196 44L208 30', 'M208 30L214 24M212 22l6 4l-4 6l-6 -4z');
seg('armR_throw_b', 'M162 56L156 68L158 78M178 56L200 54L214 56', 'M214 56L222 56M222 52v8h5v-8z');
seg('armR_lid_up', 'M162 56L156 68L158 78M178 56L204 44L238 34', 'M226 48q21-12 42 0H226M247 38v-3h4');
seg('armR_lid_dn', 'M162 56L156 68L158 78M178 56L204 54L242 50', 'M226 62q21-12 42 0H226M247 52v-3h4');
seg('armR_pan_a', 'M162 56L156 68L158 78M178 56L198 66L214 64M214 64H234', 'M232 62H274L272 68q-1 2-4 2H238q-3 0-4-2z');
seg('armR_pan_b', 'M162 56L156 68L158 78M178 56L198 52L212 46M212 46L232 40', 'M231 40L274 28L277 34q0 4-4 5L241 48q-4 0-5-3z');

// ---- left-hand chopping actions (board is at x 80..128) ----
seg('chop_a', 'M178 56L184 68L182 78M162 56L150 60L140 52', knife(140, 52, 108, 70));
seg('chop_b', 'M178 56L184 68L182 78M162 56L150 62L140 64', knife(140, 64, 106, 75));
seg('cleaver_a', 'M178 56L184 68L182 78M162 56L152 40L148 28', 'M148 28V20M138 20H160V4H138z');
seg('cleaver_b', 'M178 56L184 68L182 78M162 56L150 62L136 66', 'M136 66L128 70M128 66H98V76H128z');
seg('mallet_a', 'M178 56L184 68L182 78M162 56L152 46L146 38', 'M146 38L136 24M128 18L140 13L145 24L133 29z');
seg('mallet_b', 'M178 56L184 68L182 78M162 56L150 62L138 64', 'M138 64L116 70M106 66L118 62L121 74L109 78z');
seg('salt_a', 'M178 56L184 68L182 78M162 56L150 52L142 46', 'M142 46L132 36M128 34l8-6l4 6l-8 6z');
seg('salt_b', 'M178 56L184 68L182 78M162 56L150 56L140 54', 'M140 54L128 50M124 46l10 -2l2 8l-10 2z');
seg('salt_dots_a', spark(122, 44), spark(126, 52), spark(118, 54), spark(122, 62));
seg('salt_dots_b', spark(112, 58), spark(116, 66), spark(108, 68), spark(114, 74), spark(104, 62));
seg('shock', 'M96 70L88 66M94 76L85 77M98 64L94 57M126 70l6-4M128 76l7 1');
seg('slice_a', circle(108, 56, 3.5), 'M102 62l-3 3');
seg('slice_b', circle(94, 42, 3.5), 'M98 48l3 4');

// ---- pot extras ----
seg('rise1', circle(236, 55, 2.5), circle(258, 52, 2));
seg('rise2', circle(246, 45, 3), circle(262, 40, 2));
seg('rise3', circle(238, 33, 2.5), circle(254, 28, 3));
seg('rise4', circle(246, 18, 3), circle(260, 12, 2.5));
seg('steam1', 'M232 58c-4-4 4-7 0-11s4-7 0-11');
seg('steam2', 'M262 58c-4-4 4-7 0-11s4-7 0-11');
seg('steam3', 'M247 56c-4-4 4-7 0-11s4-7 0-11');
seg('clang', 'M219 53l-6-3M217 60l-7 0M275 53l6-3M277 60l7 0M247 36v-5M239 38l-3-4M255 38l3-4');

// ---- pan / fx props ----
seg('flame_a', 'M238 80q-4-6 0-11q1 4 4 5q-1-6 4-9q0 5 3 8q-1 3 0 7zM256 80q-4-6 0-11q1 4 4 5q-1-6 4-9q0 5 3 8q-1 3 0 7z');
seg('flame_b', 'M242 80q-3-5 0-9q2 3 4 4q0-5 4-8q-1 5 2 8q0 3-1 5zM262 80q-3-5 0-9q2 3 4 4q0-5 4-8q-1 5 2 8q0 3-1 5z');
seg('cake_dn', 'M242 60H264q3 0 0-3H242q-3 3 0 3z');
seg('cake_up', 'M244 22H266q3 0 0-3H244q-3 3 0 3z', 'M236 28v6M254 30v8M272 28v6');
seg('dial_a', 'M226 92l-4-3');
seg('dial_b', 'M226 92l5-2');
seg('dial_c', 'M226 92v-5');
seg('smoke1', cloud(236, 52, 0.9));
seg('smoke2', cloud(256, 36, 1.1));
seg('smoke3', cloud(240, 18, 1.2));
seg('dots1', spark(220, 24), spark(226, 18), spark(224, 28));
seg('dots2', spark(236, 14), spark(244, 22), spark(240, 8), spark(250, 12));
seg('dots3', spark(262, 6), spark(270, 14), spark(276, 4), spark(282, 18), spark(266, 22));
seg('ring', 'M226 22a14 14 0 0 1 14-12M232 28a22 22 0 0 1 28-24');
seg('notes1', note(198, 38));
seg('notes2', note(212, 26), note(226, 40));
seg('notes3', note(204, 14), note(222, 18), note(236, 28));

// ---- cat on the shelf (rear at x~22, tail hangs off the left edge) ----
seg('cat_sleep', 'M22 46C20 34 38 30 52 36', 'M46 46H62', 'M54 36a7 6 0 0 1 12 2V46', 'M56 32l1-5l4 3M63 31l3-5l1 6', 'M58 38q2 2 4 0M63 38q2 2 4 0');
seg('cat_awake', 'M22 46C22 36 28 28 34 26L40 46', 'M40 46H52', 'M40 22a8 7 0 0 1 14 0V30a7 6 0 0 1-14 0z', 'M41 17l1-8l5 5M52 17l2-8l-6 5', dot(44, 24), dot(51, 24), 'M46 29q2 2 4 0', 'M34 46H30M44 38l-2 8M50 38l1 8');
seg('cat_ears', 'M22 46C22 36 28 28 34 26L40 46', 'M40 46H52', 'M40 22a8 7 0 0 1 14 0V30a7 6 0 0 1-14 0z', 'M41 17l1-8l5 5M52 17l2-8l-6 5', 'M43 22l3 2M51 22l-3 2', 'M46 29h4', 'M36 38L38 28L36 20M56 38L58 28L56 20');
seg('tail_a', 'M22 44C12 44 10 52 14 58');
seg('tail_b', 'M22 44C14 38 8 40 8 32');
seg('zzz1', 'M72 34h5l-5 6h5');
seg('zzz2', 'M80 24h6l-6 7h6');
seg('zzz3', 'M90 12h7l-7 8h7');
seg('cz1', 'M190 30h5l-5 6h5');
seg('cz2', 'M198 20h6l-6 7h6');

export const SEG_IDS: readonly string[] = S.map((s) => s.id);
const STATIC = new Set(['floor', 'counter', 'board', 'stove', 'pot', 'dial', 'lamp', 'shelf', 'body', 'lamp_rays']);
/** Static scene groups that are not always on (toggled by the animator). */
export const TOGGLED_STATIC = ['pot', 'lamp_rays'] as const;

export const KITCHEN_VIEWBOX = '0 0 340 110';
export const KITCHEN_MARKUP: string = S.filter((s) => s.d !== '')
  .map((s) => `<g data-seg="${s.id}" class="seg${STATIC.has(s.id) ? ' on' : ''}"><path d="${s.d}"/></g>`)
  .join('');

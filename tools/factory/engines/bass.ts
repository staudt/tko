// Build-time renderers (not part of the app bundle) for the factory basses, written for this project:
// a Karplus-Strong "Finger Bass" and an "808 Sub". Plain TypeScript, offline, no third-party audio.
import { Svf, softClip } from './dsp';

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Plucked-string bass: damped Karplus-Strong loop, finger-softened excitation, a little sub sine and warm saturation. */
export function renderFingerBass(sr: number, midi: number, seconds: number): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  const f0 = midiHz(midi);
  const delay = Math.max(8, Math.round(sr / f0 - 0.5)); // the 2-tap loop filter adds half a sample
  const buf = new Float64Array(delay);

  // Excitation: noise through a one-pole low-pass (soft finger), with a pluck-position comb (notch at ~1/5 of the string).
  let seed = 0x2f6e2b1;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed | 0) / 2147483648;
  };
  let lp = 0;
  for (let i = 0; i < delay; i++) {
    lp += 0.45 * (rnd() - lp);
    buf[i] = lp;
  }
  const pick = Math.max(1, Math.round(delay / 5));
  const tmp = Float64Array.from(buf);
  for (let i = 0; i < delay; i++) buf[i] = tmp[i]! - 0.7 * tmp[(i + pick) % delay]!;
  let mean = 0;
  for (let i = 0; i < delay; i++) mean += buf[i]!;
  mean /= delay;
  let pk = 0;
  for (let i = 0; i < delay; i++) {
    buf[i] = buf[i]! - mean;
    pk = Math.max(pk, Math.abs(buf[i]!));
  }
  for (let i = 0; i < delay; i++) buf[i] = buf[i]! / pk;

  const gain = 0.986; // per pass (~ -8 dB/s on the fundamental); upper partials die faster via damping
  const damp = 0.43; // 0 = no loop damping, 0.5 = strong
  let pos = 0;
  let prev = 0;
  const tone = new Svf();
  tone.set(2600, 0.7, sr);
  for (let i = 0; i < n; i++) {
    const cur = buf[pos]!;
    const y = gain * ((1 - damp) * cur + damp * prev);
    prev = cur;
    buf[pos] = y;
    pos = pos + 1 === delay ? 0 : pos + 1;
    const t = i / sr;
    // Sub sine one octave below the sounding pitch would sit under a phone speaker's cut-off; instead add the
    // fundamental itself with a quick decay and use saturation to generate 2nd/3rd harmonics that small speakers reproduce.
    const sub = Math.sin(2 * Math.PI * f0 * t) * Math.exp(-t * 2.2) * 0.55;
    tone.tick(cur);
    out[i] = cur * 0.9 + sub + tone.low * 0.5;
  }
  // Warm saturation then a gentle low-pass to remove saturation fizz.
  const post = new Svf();
  post.set(4200, 0.6, sr);
  let hp = 0;
  for (let i = 0; i < n; i++) {
    const x = softClip(out[i]! * 0.9, 0.55);
    post.tick(x);
    hp += 0.0015 * (post.low - hp); // DC-blocker
    out[i] = post.low - hp;
  }
  // Soft attack ramp (2 ms) so the first sample is zero.
  const ramp = Math.round(0.002 * sr);
  for (let i = 0; i < ramp; i++) out[i]! *= i / ramp;
  return out;
}

/** 808-style sub: sine with a fast exponential pitch drop, long decay, saturation for upper harmonics, click transient. */
const HARM = 0.5;

export function renderSub808(sr: number, midi: number, seconds: number): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  const f0 = midiHz(midi);
  let phase = 0;
  let phase2 = 0;
  let phase3 = 0;
  const post = new Svf();
  post.set(5000, 0.6, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f0 * (1 + 2.2 * Math.exp(-t / 0.028)); // starts at ~3.2x f0 and settles within ~100 ms
    phase += (2 * Math.PI * f) / sr;
    phase2 += (2 * Math.PI * f * 2) / sr;
    phase3 += (2 * Math.PI * f * 3) / sr;
    const env = Math.min(1, t / 0.002) * Math.exp(-t * 1.5) * (0.4 + 0.6 * Math.exp(-t * 0.5));
    const click = Math.exp(-t * 400) * Math.sin(2 * Math.PI * 900 * t) * 0.25;
    // Drive follows the envelope, so loud onsets get thicker and the tail relaxes to a pure sub.
    const body = Math.sin(phase) + 0.22 * Math.sin(phase2);
    const x = Math.tanh(body * (2.8 + 2.2 * env)) * env;
    // Phone-speaker layer: 3f/4f/5f partials that decay slower than the sine's drive, so the note stays audible without the sub.
    const hEnv = Math.min(1, t / 0.002) * Math.exp(-t * 1.2);
    const harm = (Math.sin(phase3) * 0.55 + Math.sin(phase3 * (4 / 3)) * 0.4 + Math.sin(phase3 * (5 / 3)) * 0.22) * hEnv * HARM;
    post.tick(x + click + harm);
    out[i] = post.low;
  }
  return out;
}

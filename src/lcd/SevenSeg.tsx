// Seven-segment digits drawn as SVG: all seven segments are always present, unlit ones are ghosted by CSS.
const H = (y: number): string => `1.8,${y} 3,${y - 1.2} 9,${y - 1.2} 10.2,${y} 9,${y + 1.2} 3,${y + 1.2}`;
const V = (x: number, y0: number, y1: number): string => `${x},${y0} ${x + 1.2},${y0 + 1.2} ${x + 1.2},${y1 - 1.2} ${x},${y1} ${x - 1.2},${y1 - 1.2} ${x - 1.2},${y0 + 1.2}`;
const SEGS: Record<string, string> = {
  a: H(1.4),
  b: V(10.6, 2.2, 9.2),
  c: V(10.6, 10.8, 17.8),
  d: H(18.6),
  e: V(1.4, 10.8, 17.8),
  f: V(1.4, 2.2, 9.2),
  g: H(10),
};
const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];

export function Digit({ d }: { d: number | null }) {
  const on = d === null ? '' : (DIGITS[d] ?? '');
  return (
    <svg class="digit" viewBox="0 0 12 20" aria-hidden="true">
      {Object.entries(SEGS).map(([k, pts]) => (
        <polygon key={k} points={pts} class={on.includes(k) ? 'seg on' : 'seg'} />
      ))}
    </svg>
  );
}

/** `n` rendered as `width` digits (leading zeros shown, like the real thing). */
export function Digits({ n, width, label }: { n: number; width: number; label: string }) {
  const s = String(Math.max(0, Math.round(n))).padStart(width, '0').slice(-width);
  return (
    <span class="digits" role="img" aria-label={label}>
      {[...s].map((c, i) => (
        <Digit key={i} d={Number(c)} />
      ))}
    </span>
  );
}

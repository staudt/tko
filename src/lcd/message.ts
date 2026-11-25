// Brief messages for the dot-matrix strip. The strip polls `currentMessage()` from its rAF loop.
let text = '';
let until = 0;
let started = 0;
let version = 0;

/** Show `text` (scrolls when wider than the strip) for about `ms`. */
export function lcdMessage(t: string, ms = 1500): void {
  text = t.toUpperCase();
  started = performance.now();
  until = started + ms;
  version++;
}

export function currentMessage(now: number): { text: string; since: number; version: number } | null {
  return text && now < until ? { text, since: now - started, version } : null;
}
/** Extends the message lifetime to cover a scroll of `ms`. */
export function extendMessage(ms: number): void {
  until = Math.max(until, started + ms);
}

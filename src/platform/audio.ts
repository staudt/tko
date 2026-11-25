// Audio unlock: create/resume the AudioContext from a user gesture (Android/iOS autoplay rules).
// Adapted from beatboy (MIT, same author).
let ctx: AudioContext | null = null;
let unlocked = false;
const listeners = new Set<() => void>();

export function getAudioContext(): AudioContext {
  if (!ctx) {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor({ latencyHint: 'interactive' });
    ctx.addEventListener('statechange', () => listeners.forEach((l) => l()));
  }
  return ctx;
}

/** Call from inside a user-gesture handler (resume() / iOS unlock need the gesture). */
export function ensureRunning(): Promise<AudioContext> {
  const c = getAudioContext();
  setAudioSession('playback');
  if (!unlocked) {
    unlocked = true;
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, c.sampleRate);
      src.connect(c.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
  }
  if (c.state === 'suspended' || (c.state as string) === 'interrupted') {
    return c.resume().then(() => c, () => c);
  }
  return Promise.resolve(c);
}

export function onAudioStateChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

/**
 * iOS (Safari 16.4+): 'playback' keeps sound on with the silent switch on; 'play-and-record' is
 * needed while the mic is open. Other browsers: no-op.
 */
export function setAudioSession(type: 'playback' | 'play-and-record'): void {
  try {
    const s = (navigator as AudioSessionNav).audioSession;
    if (s && s.type !== type) s.type = type;
  } catch {
    /* unsupported */
  }
}

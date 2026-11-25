// Microphone recording: getUserMedia (all processing off) -> recorder worklet -> Float32Array.
import recorderUrl from './recorderWorklet.ts?worker&url';
import { ensureRunning } from './audio';
import { joinChunks } from './trim';

export const MAX_RECORD_SECONDS = 30;

export type MicErrorReason = 'denied' | 'nomic' | 'unsupported' | 'failed';
export class MicError extends Error {
  constructor(readonly reason: MicErrorReason, message: string) {
    super(message);
  }
}

export type RecordingSession = {
  /** Smoothed peak level 0..1 of the most recent audio (cheap; call from rAF). */
  level(): number;
  /** Seconds recorded so far. */
  elapsed(): number;
  /** Stops, releases the mic and resolves with the audio. */
  stop(): Promise<{ l: Float32Array; rate: number }>;
  /** Stops and discards. */
  cancel(): void;
};

let moduleLoaded = false;

export type RecordingOptions = {
  /** Attach extra nodes to the mic source (e.g. the live pitch tap). Returns a cleanup run at teardown. */
  tap?: (ctx: AudioContext, src: MediaStreamAudioSourceNode) => (() => void) | Promise<() => void>;
};

/** Starts recording. Call from a user gesture. `onLimit` fires once at MAX_RECORD_SECONDS (the caller should stop). */
export async function startRecording(onLimit?: () => void, opts: RecordingOptions = {}): Promise<RecordingSession> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError('unsupported', 'Recording is not supported in this browser.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicError('denied', 'Microphone access was denied. Allow it in the browser settings and try again.');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicError('nomic', 'No microphone found.');
    throw new MicError('failed', 'Could not open the microphone.');
  }
  const release = () => stream.getTracks().forEach((t) => t.stop());
  try {
    const ctx = await ensureRunning();
    if (!moduleLoaded) {
      await ctx.audioWorklet.addModule(recorderUrl);
      moduleLoaded = true;
    }
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'tko-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    // Muted tap into the destination so the graph is pulled; nothing is audible (no feedback).
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    const untap = opts.tap ? await opts.tap(ctx, src) : null;

    const chunks: Float32Array[] = [];
    let frames = 0;
    let level = 0;
    let done: (() => void) | null = null;
    let limited = false;
    node.port.onmessage = (e: MessageEvent<{ type: string; data?: Float32Array }>) => {
      if (e.data.type === 'chunk' && e.data.data) {
        const d = e.data.data;
        chunks.push(d);
        frames += d.length;
        let p = 0;
        for (let i = 0; i < d.length; i++) {
          const a = Math.abs(d[i]!);
          if (a > p) p = a;
        }
        level = p;
        if (!limited && frames >= MAX_RECORD_SECONDS * ctx.sampleRate) {
          limited = true;
          onLimit?.();
        }
      } else if (e.data.type === 'flushed') {
        done?.();
      }
    };

    let shown = 0;
    let closed = false;
    const teardown = () => {
      if (closed) return;
      closed = true;
      try { untap?.(); src.disconnect(); node.disconnect(); mute.disconnect(); } catch { /* already gone */ }
      release();
    };
    return {
      level() {
        shown = Math.max(level, shown * 0.9);
        level = 0;
        return Math.min(1, shown);
      },
      elapsed: () => frames / ctx.sampleRate,
      async stop() {
        if (!closed) {
          await new Promise<void>((resolve) => {
            done = resolve;
            node.port.postMessage('flush');
            setTimeout(resolve, 500); // never hang if the worklet is gone
          });
        }
        teardown();
        const max = Math.round(MAX_RECORD_SECONDS * ctx.sampleRate);
        const all = joinChunks(chunks);
        return { l: all.length > max ? all.slice(0, max) : all, rate: ctx.sampleRate };
      },
      cancel: teardown,
    };
  } catch (e) {
    release();
    throw new MicError('failed', e instanceof Error ? e.message : 'Could not start recording.');
  }
}

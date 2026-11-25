// AudioWorklet entry: hosts the whole engine (clock, sequencer, voices, FX, limiter).
// AUDIO THREAD RULES: no allocations in process(), no closures created per block, no postMessage
// per block except the engine's throttled events (step changes and ~30 Hz meters).
import { Engine } from './core';
import type { EngineCommand, EngineEvent } from './protocol';

// Minimal typings for the AudioWorkletGlobalScope (not in lib.dom).
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;

export type EngineProcessorOptions = { commands?: EngineCommand[] };

class EngineProcessor extends AudioWorkletProcessor {
  private engine = new Engine(sampleRate);
  private synced = false;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const port = this.port;
    this.engine.emit = (ev: EngineEvent) => {
      // Resampled audio goes back without copying.
      if (ev.type === 'resampled') port.postMessage(ev, [ev.l.buffer]);
      else port.postMessage(ev);
    };
    port.onmessage = (e: MessageEvent<EngineCommand>) => this.engine.command(e.data);
    // Initial state can be passed at construction (used by offline render tests,
    // where port messages could arrive after rendering has started).
    const init = (options?.processorOptions as EngineProcessorOptions | undefined)?.commands;
    if (init) for (const c of init) this.engine.command(c);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.synced) {
      this.engine.syncFrame(currentFrame);
      this.synced = true;
    }
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const l = out[0]!;
    const r = out[1] ?? l;
    this.engine.process(l, r, l.length);
    return true;
  }
}

registerProcessor('tko-engine', EngineProcessor);

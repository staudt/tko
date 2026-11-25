# tko (working name)

A mobile-browser pocket sampler and sequencer with the *functionality* of a PO-33-style device (16 sample slots, 16-step sequencer, mic sampling, punch-in FX, parameter locks, pattern chains), re-imagined for a touchscreen. Android Chrome is the main target, iOS Safari is best effort, and desktop must still work.

The full plan is in `docs/plan.md`. Progress notes go in `docs/progress.md`.

## Intellectual property
Do not use Teenage Engineering names, logos, trade dress or artwork, and do not copy their factory samples. Generic function names (sound, pattern, bpm, fx, record, play, write) are fine. The LCD art is original ("kitchen chaos" theme). Sounds are CC0, or rendered by our own engines. Never copy GPL code.

## Stack
- Vite, TypeScript (strict, `noUncheckedIndexedAccess`), Preact with @preact/signals, pnpm. Installable PWA: `scripts/sw-plugin.ts` precaches everything.
- One AudioWorklet (`src/engine/worklet.ts`) hosts the clock, the sequencer, all voices and the FX. The engine core (`src/engine/core.ts`) is pure TypeScript, so Vitest renders it offline in Node.
- The main-thread store (`src/store/`) is the single source of truth. It sends commands to the engine (`src/engine/protocol.ts`), and the engine sends back throttled events (step, meters).
- Visuals that update at 60 fps (playhead, LCD animation, meters) are driven by rAF and write straight to the DOM or a canvas, never through component re-renders.
- Storage: IndexedDB for projects, OPFS for samples (falls back to IndexedDB).
- Tests: Vitest for units and offline engine renders (`tests/unit`, `tests/audio`). Playwright drives a phone project (390x844) with real touch via CDP (`tests/e2e`).
- Code reused from `../groovebox` and `../beatboy` is the same author's own code.

## Audio thread rules
No allocations in `process()`. No closures created per block. Smooth every parameter change, so nothing zippers or clicks. The clock lives only in the worklet; never schedule notes from timers on the main thread. Every worklet-side file starts with a comment that restates these rules.

## Domain
- **16 sounds.** Slots 1–8 are melodic: one sample played chromatically across the 16 keys, key k = root + k semitones (key 0 = root). Slots 9–16 are drum: one sample cut into 16 slices, and key k plays slice k.
- **16 patterns × 16 steps.** Each pattern has a lane for each of the 16 sounds. A step stores a key bitmask, plus optional length and parameter locks A and B.
- **Knobs A/B** depend on what is held:
  - nothing held: pitch / tone
  - SOUND held: trim start / end
  - BPM held: tempo / swing
  - FX held: the effect's X / Y
  - a step held: lock A / B
- **16 punch-in FX**, held with FX + key.

## UI
- One portrait screen with no scrolling, filling `100dvh` within the safe areas. Layout from top to bottom: header, LCD, the knob row, the function row (SOUND, PATTERN, BPM), then the 4×4 pads with a right-hand column (REC, FX, PLAY, WRITE).
- Pads are soft-touch squircles: dark matte rubber, a large numeral, and a thin LED ring that glows amber when lit.
- Multi-touch goes through a single pointer router (`src/ui/input/`). It keeps `Map<pointerId, control>`, so a combo is just a lookup in the set of held controls. Pads fire on `pointerdown`. On `pointercancel`, `blur` or `visibilitychange`, everything is released.
- Tapping SOUND, PATTERN, BPM or FX opens a pop-up sheet. Holding one gives the hardware-style combos.
- Touch targets are at least 44 px.

## Conventions
- No `any` in engine or store code. A new runtime dependency needs a justification and a license check.
- Small commits, one concern each, and only when the user asks.
- Claude cannot judge sound or feel. When a change affects either, say what to listen for and ask the user to try it on the phone.
- `pnpm dev:lan` serves HTTPS on the LAN (AudioWorklet needs a secure context).

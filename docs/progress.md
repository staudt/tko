# Progress

## Phase 1 — shell, pads, engine (2026-11-25)
- Worklet engine (`src/engine/core.ts`): 16 sounds × 16 patterns × 16 steps, key bitmasks, p-locks (pitch/tone), note length, pattern chains, 40-voice pool (32 sounding + fade spares), per-sound tone filter, 12 punch-in FX (from groovebox), resample, flam suppression for live recording.
- Factory sounds (`pnpm factory`): 8 melodic FM renders + Studio kit (CC0) + 7 synth kits, ~1.3 MB.
- UI: full-screen portrait layout, squircle pads, knobs, single pointer router (multi-touch), SOUND hold/tap sheet, FX hold + knobs X/Y, BPM hold + knobs tempo/swing, LCD v1 (7-seg, art placeholder, dot-matrix waveform), look-dev page (`lookdev.html`).
- Tests: 43 unit (engine renders, store, factory loader), 12 Playwright (layout fit, CDP multi-touch combos).

**Try on the phone:** pad latency and multi-touch (chords, finger drumming), knob feel while holding a pad, SOUND hold labels, FX hold + knobs, sound quality/levels of all 16 factory slots (Studio kit may be quieter than the synth kits).

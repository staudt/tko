# Progress

## Phase 1 — shell, pads, engine (2026-11-25)
- Worklet engine (`src/engine/core.ts`): 16 sounds × 16 patterns × 16 steps, key bitmasks, p-locks (pitch/tone), note length, pattern chains, 40-voice pool (32 sounding + fade spares), per-sound tone filter, 12 punch-in FX (from groovebox), resample, flam suppression for live recording.
- Factory sounds (`pnpm factory`): 8 melodic FM renders + Studio kit (CC0) + 7 synth kits, ~1.3 MB.
- UI: full-screen portrait layout, squircle pads, knobs, single pointer router (multi-touch), SOUND hold/tap sheet, FX hold + knobs X/Y, BPM hold + knobs tempo/swing, LCD v1 (7-seg, art placeholder, dot-matrix waveform), look-dev page (`lookdev.html`).
- Tests: 43 unit (engine renders, store, factory loader), 12 Playwright (layout fit, CDP multi-touch combos).

**Try on the phone:** pad latency and multi-touch (chords, finger drumming), knob feel while holding a pad, SOUND hold labels, FX hold + knobs, sound quality/levels of all 16 factory slots (Studio kit may be quieter than the synth kits).

## Phase 2 — step sequencer UI (2026-11-25)
- WRITE mode (pads = steps of the selected lane, playhead, labels, status dots), hold step + knobs = p-locks, hold step + tap step = note length, long-press = Step sheet.
- PATTERN hold + pads = chain (applied on release, queued marker), Pattern sheet (density cards, chain builder, copy/paste/clear). BPM hold + pad = master volume, BPM sheet (nudge, drag, presets, tap tempo, swing, volume). Header undo/redo; LCD shows audible pattern, chain, lane strip.
- Tests: `tests/e2e/seq.spec.ts`, `tests/unit/stepHelpers.test.ts`. Screenshots: `docs/screenshots/*-390x844.png`.

**Try on the phone:** step tap vs long-press timing (350/450 ms), knob-while-holding-step feel, tap tempo, BPM hold-to-repeat, playhead sync with audio.

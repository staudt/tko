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

## Phase 3 — live recording, latency calibration, metronome (2026-11-25)
- REC tap arms (red LED, blinking LCD rec icon while armed and playing); REC hold + pad shows "SAMPLING SOON" (reserved for Phase 4, no note, no arming).
- Armed + playing: pad hits still sound at once and are also written: heard time = event time - output latency - user offset, quantized to the nearest step (`quantizeHit`), melodic hold length via `heldLength`. One take (arm/play until disarm/stop) = one undo step (`rec:N` merge key). LCD step row flashes a tall block on the recorded step.
- Metronome follows settings (always on / while recording, default on while recording) through `src/ui/settings.ts`.
- Header menu button opens Settings: metronome toggles, latency offset slider (-50..250 ms, -/+), Calibrate (tap along with 10 clicks, "Use NN ms"), licenses links. Stored in localStorage `tko.settings`.
- Tests: `tests/unit/settings.test.ts`, `tests/e2e/rec.spec.ts`. Screenshots: `docs/screenshots/{rec-armed,settings,calibrate}-390x844.png`.

**Try on the phone:** do the calibration a few times (with speaker and with headphones; Bluetooth especially) and check the offsets agree; arm REC, play, finger-drum on the beat and listen whether recorded hits land where you played them (adjust latency +/-); hits near the end of a pattern landing on step 1 of the next; held melodic notes get a length; metronome click level and timing; one Undo removes a whole take.

## UI batch — notes, scales, erase, FX record (2026-11-25)
- Melodic pads show note names (project key + scale aware, tonic keys accented); drum pads show hit names. SOUND sheet has Key and Scale chips (undoable, LCD "KEY D MINOR PENT..."); long-press a sound card -> "Clear in pattern NN".
- SAMPLE button added to the function row (placeholder "SAMPLING SOON" for Phase 4); REC-hold+pad is now live erase while playing (`erase:N` undo step; REC+FX clears the FX lane). `src/ui/stepTicker.ts` is the shared rAF heard-step watcher.
- FX record: armed + playing, FX + pad k writes fx lane k on the press step and every passed step (part of the take's undo step).
- Step sheet is a quick note picker: tap key = only that key and close; hold key (400 ms) = toggle chord member. Length/locks removed from the sheet. SOUND-held pad dot = sound has notes in the edit pattern. One-line gesture hint under the LCD readout title.
- Tests: new `tests/e2e/notes.spec.ts`, helper unit tests. Screenshots: `docs/screenshots/{notes,sound-sheet}-390x844.png`.

**Try on the phone:** erase feel (does the key vanish just as the playhead passes?), FX recording alignment vs. what you heard, key/scale note names vs. what you hear, tap vs. hold timing in the step sheet, hint line legibility.

## ERASE button (2026-11-25)
- New 5th function-row button ERASE (coral eraser icon) replaces REC+pad live erase and REC+FX erase (REC held + pad now does nothing). Logic in `src/ui/erase.ts`, sheet in `src/ui/EraseSheet.tsx`.
- Target pattern = audible pattern while playing, else edit pattern. Hold ERASE + pad k: clear sound k (pads show the 16 sound names, dot = has notes, coral flash, LCD "CLEAR S10 P01"); in write mode ERASE + step pad clears that step; ERASE + FX clears the fx lane; ERASE held alone while playing (> 300 ms, nothing else touched) live-erases the selected sound's step as the playhead passes. Each hold gesture is one undo step (`erase:N`).
- Quick tap opens the Erase sheet (clear sound / FX / pattern / ALL; ALL needs a second tap within 3 s). Hint line updated.
- Tests: `tests/e2e/erase.spec.ts`, updated `notes.spec.ts`/`ui.spec.ts`. Screenshots: `docs/screenshots/erase-390x844.png`, `erase-held-390x844.png`.

**Try on the phone:** live-erase timing (does the step vanish as the playhead passes?), tap vs hold threshold on ERASE, 5-button row touch size.

## Inline tempo pill (2026-11-25)
- BPM sheet removed. Tempo pill in the knob row centre (`src/ui/TempoPill.tsx`, logic `src/ui/tempo.ts`, router id `tempo`, new optional `move` router handler): drag = 1 BPM per 6 px after a 6 px dead zone (one undo step per drag), tap = tap tempo (>= 3 taps, pill shows TAP and flashes, resets after 2 s idle, one undo step per sequence), long-press 500 ms = presets 80/120/140. Shows swing when != 50 and a dot when the metronome is on.
- BPM button tap toggles the metronome "always on" setting (LCD METRO ON/OFF, button lit); BPM hold + knobs/pads unchanged.
- Tests: tempo pill + metronome tests in `tests/e2e/seq.spec.ts`. Screenshot `docs/screenshots/tempo-390x844.png`.

**Try on the phone:** drag feel (px per BPM, dead zone), tap vs long-press timing on the pill, tap-tempo accuracy, drag while holding a pad.

## Phase 4 — sampling UI (2026-11-25)
- Hold SAMPLE + hold pad k records the mic into slot k (start on press, stop on release of either, 12 s cap). While recording: SAMPLE pulses red, the pad shows a red ring, the LCD strip shows a scrolling level meter + progress bar (countdown digits in the last 3 s), the chef sings (art trigger is the new `sampling` signal). Result: trim silence (20 ms pre-roll) -> normalize -1 dB -> fade -> saved as `Rec k`, one undo step, drum slots get auto slices, key 0 plays as confirmation, LCD "SAMPLED S10 2.3S". Mic errors show an LCD message and a toast and leave the slot unchanged.
- Quick tap SAMPLE opens the Sample sheet (`src/ui/SampleSheet.tsx`, `Waveform.tsx`, logic `sampling.ts`): rename, Melodic/Drum toggle, waveform editor (trim handles, or 16 draggable numbered slice markers; tap to audition), Auto-slice, Equal slices, Normalize, Reverse, Crop to trim, Record (tap/tap, level meter), Import file, Resample 1/2/4 patterns (waits for the next pattern start while playing), Restore factory, Clear slot, memory gauge. Every edit is undoable; drags merge into one step. New `toast.tsx` for errors.
- Superseded samples are not deleted from storage (undo can bring them back); the gauge counts only samples the project uses.
- Tests: `tests/e2e/sample.spec.ts` (fake mic in `fakeMic.ts`, denied mic, import, restore, rename, trim drag, slices, 360x640 layout). Screenshots: `docs/screenshots/sample-{recording,sheet-melodic,sheet-drum}-390x844.png`.

**Try on the phone:** the mic permission prompt on first use (the first hold may be cancelled by the prompt; hold again), record latency at the pad press, level meter responsiveness, trim of silence at start/end of your takes, auto-slice quality on real loops, handle drag feel and the 12 px marker grab radius on a small phone, resample timing against the pattern start, Bluetooth headset mic behaviour.

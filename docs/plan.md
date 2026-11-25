# tko — a pocket sampler for the phone (PO-33-style), plan

## Context

`/home/ricardo/git/tko` is an empty repo. Goal: a mobile-browser instrument with the *functionality* and immediacy of the Teenage Engineering PO-33 K.O! (16 sample slots, 16-step sequencer, mic sampling, punch-in FX, p-locks, pattern chains), re-imagined for a touchscreen: full-screen, multi-touch (hold a key while turning a knob, play chords/finger-drum), pop-up pickers instead of cycling lists, and an original animated LCD. Later we may extend toward the KO II, so the engine and model should not hard-code "PO-33 only" assumptions where it's cheap to avoid.

**IP guardrails:** no TE names/logos/trade dress, no copied artwork, no copied factory samples. Our own name ("tko" working title), own layout, own LCD art ("kitchen chaos" theme), CC0 or self-rendered sounds. Generic function names (sound, pattern, bpm, fx, record, play, write) are fine.

**Decisions made with the user**
- Buttons: *soft-touch squircles* — matte dark rubber, large numerals, thin LED ring that glows amber when lit, small per-pad status dot (step on / p-lock), press = slight scale-down + inner shadow.
- LCD art theme: **kitchen chaos** (original characters).
- Factory sounds: CC0 drums (existing Virtuosity kit + VCSL) + melodic samples rendered offline from groovebox's FM/drum engines.
- Controls: **both** — tap SOUND/PATTERN/BPM/FX opens a pop-up picker; holding them keeps the fast hold+key / hold+knob combos.

## Stack & conventions (carried over from groovebox `CLAUDE.md`)
Vite + TypeScript strict (`noUncheckedIndexedAccess`) + Preact/@preact/signals, pnpm, installable PWA (own `sw-plugin`), one AudioWorklet hosting clock + sequencer + voices + FX. Audio-thread rules: no allocations, no per-block closures, smoothed params, clock only in the worklet. Store on the main thread is the single source of truth (commands → engine, throttled events back). 60 fps visuals via rAF, never component re-renders. Vitest (node renders of the pure engine) + Playwright (phone 390×844 project, CDP real touch). GitHub Pages deploy with `base: './'`. A `CLAUDE.md` spec for tko is the first commit, condensed from this plan.

## Feature set (v1, PO-33-like)
- **16 sound slots:** 1–8 melodic (sample played chromatically across the 16 keys → chords for free), 9–16 drum (sample auto-chopped into 16 onset-aware slices, one per key).
- **Sampling:** hold REC + slot = mic record; also file import and resample master. Mono, ≤12 s per slot, 180 s total, memory gauge on the LCD.
- **Sequencer:** 16 patterns × 16 steps, every pattern holds lanes for all 16 sounds. Write mode (step entry), live record while playing (quantized), note length, **parameter locks** (hold step + turn knob → pitch/tone per step), pattern chains (switch at pattern end), copy/clear, undo.
- **Knobs A/B** context-sensitive: default pitch / tone (LP↔HP); SOUND held → trim start / end; BPM held → tempo / swing; FX held → FX X / Y; step held → p-lock.
- **BPM:** presets 80/120/140, tap tempo, swing, master volume, metronome.
- **16 punch-in FX** (hold FX + key): groovebox's 12 (stutter ¼–1/32, tape stop, low/high sweep, lo-fi, gate, reverse, reverb throw, delay throw) + 4 new: stutter 1/8T, scratch, octave, unison. Recordable into patterns per step.
- Autosave + projects, WAV export/share, backup/restore.

## Engine (new, smaller `src/engine/core.ts` ≈600 lines lifting groovebox parts)
groovebox's `core.ts` is built around 8 tracks × 4 slots and a note-list `Step` union, so rewrite instead of adapting, but lift verbatim: the sample-counting clock (`anchorFrame/anchorStep`, `posAt`, `frameAt`, `nextSixteenth`, swing, `LOOKAHEAD_STEPS`, tempo re-anchoring), the event queue + split-block `process()` loop, `capture()` for resample, meter throttling, PunchChain/reverb/delay/limiter wiring.
- **Worklet data** (preallocated, index `(pattern*16 + sound)*16 + step`): `keys: Uint16Array(4096)` (bit k = key/slice/semitone k), `len: Uint8Array`, `lockA/lockB: Int8Array` (-128 = none; A = semitones, B = tone), `fxLane: Int8Array(256)`, `chain: Uint8Array(64)` + pos. Per sound: kind, start/end, `slices` boundaries, pitch, tone, vol, root, sample ref.
- **Voices:** global pool of 32 `SampleVoice` (adapted `sampler/voice.ts`, Hermite interp, click-free end/steal fades), ≤4 per sound, same-slice retrigger chokes. Per-sound bus with one `Svf` (tone) + smoothed volume.
- **Protocol:** `transport, tempo, volume, pattern{typed arrays}, chain, sound{…}, sample{id, l, rate}` (buffer **transferred**), `sampleFree, play{sound,key,on}, fx{fx,on}, fxKnob{x,y}, resample, panic`. Events: `step{step,pattern,chainPos,time}`, `resampled`, `meters{master, activeSounds bitmask}` (drives LCD).
- **Live record:** pad sounds immediately; main thread quantizes `round(songPos − calibratedLatency)` from the host step ring (which carries pattern index for chains) and writes via a store command. Engine keeps `lastLive[sound*16+key]` and skips a sequenced retrigger within ½ step to avoid flams.
- **FX lanes:** step-quantized; engine diffs `fxLane[step]` vs previous step to press/release; a live press overrides. New FX ids only ever appended.

## Domain types / store
```ts
type Sound = { name; kind: 'melodic'|'drum'; sampleId: string|null; start; end; slices: number[]; pitch; tone; volume; root };
type StepData = { keys: number; len?: number; lockA?: number; lockB?: number };
type Pattern = { lanes: (StepData|null)[][]; fx: (FxId|null)[] };   // [16 sounds][16 steps]
type Project = { id; version; bpm; swing; volume; sounds: Sound[]; patterns: Pattern[]; chain: number[] };
```
Commands (with inverses, mergeable for knob drags): `setStepKeys, toggleKey, setLock, setLen, setFxStep, clearPattern, clearLane, copyPattern, setSound, setSlices, setBpm, setSwing, setVolume, setChain, replaceProject`. UI-only signals: `selectedSound, mode, editPattern, heldButtons, heldStep, playing`. A lane text notation (`parseLane/formatLane`) for tests.

## Input: one pointer router
Root-level `Map<pointerId, controlId>` resolved via `closest('[data-ctl]')`; combos are set lookups (REC+slot, FX+key, SOUND+key, step+knob). Pads fire on `pointerdown`. Knobs capture their own pointer. On `pointercancel`, `lostpointercapture`, `blur`, `visibilitychange` → release all (notes off, FX off). `touch-action:none`, `user-select:none`, `-webkit-touch-callout:none`, no `contextmenu`. Tap-vs-hold on SOUND/PATTERN/BPM/FX: released < 300 ms with no other control touched → open sheet.

## Screen layout (portrait, one screen, no scrolling)

```
┌──────────────────────────────────┐ ← safe-area top
│ ≡  tko                  🎙  ⇪  🔒 │ header 44px: menu · input/monitor · share/export · lock
├──────────────────────────────────┤
│ ┌ LCD ─────────────────────────┐ │ ~27% of height
│ │ SND 07  PAT 03→04  ▶  128 ⏱  │ │ segment row (7-seg digits + icons)
│ │  [ kitchen-chaos art band ]  │ │ fixed-segment SVG, ghosted off-segments
│ │ ▪▪▫▪▫▫▪▫▪▪▫▪▫▫▪▫ / waveform  │ │ dot-matrix strip (steps, waveform, messages)
│ └──────────────────────────────┘ │
│  (KNOB A)   PITCH  +3 │ TONE  (KNOB B) │ knobs ~96px, live label/value between them
│  [ SOUND ] [ PATTERN ] [  BPM  ] │ function row (3 wide)
│ ┃ [ 1][ 2][ 3][ 4]   [ REC  ]    │
│ ┃ [ 5][ 6][ 7][ 8]   [  FX  ]    │ 4×4 pads + right column of 4 aligned buttons
│ ┃ [ 9][10][11][12]   [ PLAY ]    │ thin amber/grey brackets mark melodic 1–8 / drum 9–16
│ ┃ [13][14][15][16]   [ WRITE]    │
└──────────────────────────────────┘ ← safe-area bottom
```
- Sizes from `100dvh` with CSS grid; pads are square-ish and ≥ 64px on a 360×740 phone. Portrait-only (landscape shows a "rotate" hint).
- **Dynamic pad labels** (touchscreen advantage): while SOUND is held, pads show sound names; PATTERN held → pattern numbers with fill state/chain order; FX held → the 16 FX names; BPM held → volume levels; WRITE on → step LEDs + playhead.
- **Knobs:** each knob captures its own pointer (vertical or circular drag, fine mode with a second finger, double-tap = reset). The label between them always says what A/B currently do (pitch/tone, trim start/length, tempo/swing, FX X/Y, p-lock values).
- **Pop-up sheets** (tap = quick tap with no other key pressed during the hold):
  - SOUND → 4×4 grid of slot cards (name, mini waveform, melodic/drum badge). Long-press a card → record mic / import file / edit (trim, slices, reverse, normalize) / rename / clear / restore factory.
  - PATTERN → 16 patterns with mini step maps; chain builder (tap in order), copy/paste/clear.
  - BPM → tempo wheel, tap-tempo pad, presets (80/120/140), swing, master volume, metronome.
  - FX → the 16 FX on a grid with descriptions; toggle "record FX into pattern".
  - ≡ menu → projects (save/load/duplicate), export WAV loop / share, backup/restore, settings (haptics, fullscreen, latency calibration, pad velocity mode), licenses.
- **Haptics:** `navigator.vibrate(8)` on pad down (Android; toggle). **Wake lock** while playing. **Fullscreen** on first tap (Android, optional); PWA standalone install for iOS/Android.

## LCD
- SVG in a fixed aspect box, colors `#B8C0A8`-ish LCD gradient with a soft glare overlay.
- **Fixed-segment art:** every pose of every character is pre-drawn as path groups in one SVG (`src/lcd/art/kitchen.svg`); the renderer only toggles `on/off` classes. Off segments render at ~6% opacity → authentic ghosting. 7-segment digits for numbers, icon segments for play/rec/mic/chain/lock.
- **Dot-matrix strip** (canvas, DPR-aware, e.g. 128×14 dots) for things segments can't do: waveform + trim/slice markers while editing, 16-step lane with playhead, scrolling text messages ("COPIED", "CHAIN 1-3-2").
- **Kitchen chaos cast** (original): chopping chef (drum hits 9–16, knife down on hit, veg flies on accents), stirring chef (melodic 1–8, steam height follows pitch), pan-flipper (FX; flames for lo-fi/crush, ice for tape-stop, pan spin for stutter), shouting-into-ladle chef (recording/sampling), ticking egg-timer (BPM edit), stacking plates (pattern chain position), idle: foot tap on the beat. Driven by engine step/voice events at rAF, never by component re-renders.
- Art is authored by Claude as simple line-art SVG first; it's designed to be swapped for hand-drawn art later without code changes (segment ids are the contract).

## Reuse map
| From | To (tko) | How |
|---|---|---|
| groovebox `src/engine/{worklet,dsp,limiter}.ts`, `fx/{reverb,delay,punch,ids}.ts` | `src/engine/…` | copy; punch/ids + 4 FX |
| groovebox `src/engine/sampler/voice.ts` | `src/engine/voice.ts` | adapt to `noteOn(sound, from, to, semis, vel)` |
| groovebox `src/engine/core.ts`, `protocol.ts`, `sync.ts`, `host.ts` | `src/engine/` | rewrite core/protocol; adapt host (step ring + pattern idx, transfer `sendSample`) |
| groovebox `src/platform/{audio,recorder,recorderWorklet,trim,latency}.ts` | `src/platform/` | copy (add `navigator.audioSession`, iOS restore after mic) |
| groovebox `src/store/{project,persist,samples}.ts` | `src/store/` | keep apply/undo/merge + autosave + OPFS; new reducer; feature-detect `createWritable` |
| groovebox `ui/Macros.tsx` Knob, `FxHoldButton`, `Waveform.tsx` | `src/ui/Knob.tsx`, `src/ui/input/router.ts`, `src/lcd/Matrix.tsx` | generalize |
| groovebox `scripts/{sw-plugin.ts,build-notices.mjs}`, vite/ts/playwright configs, `.github/workflows/deploy.yml` | same | copy, rename |
| groovebox `tests/unit/render.ts`, `tests/audio/analysis.ts`, `tests/e2e/fakeMic.ts`, CDP helpers in `touch.spec.ts` | `tests/` | copy |
| groovebox `engine/fm/*`, `voices/drum.ts`, `store/fmPresets.ts` | `tools/factory/engines/` | build-time only, never shipped |
| beatboy `scripts/build-kit.mjs`, `public/kits/virtuosity`, `ASSET_LICENSES.md` | `scripts/build-drums.mjs`, factory drums | adapt to 16-hit sprites + slice JSON |
| beatboy `src/audio/onset.ts` | `src/dsp/onset.ts` → new `src/dsp/slice.ts` (spectral flux) | adapt |

**Factory content:** `pnpm factory` (TOOLS=1 vitest tool, like groovebox `render-demo`) renders 8 FM presets as 2 s notes (slots 1–8) and synth kits from the drum engine; `build-drums.mjs` builds CC0 acoustic kits (Virtuosity + VCSL). ffmpeg → `public/factory/*.mp3` + `factory.json` (slices, lead-in offsets). Licenses in `ASSET_LICENSES.md` + generated notices.

## Phases (each ends playable on the phone; stop and ask the user to try it)
1. **Shell, look-dev, pads.** Scaffold + CLAUDE.md, look-dev page (squircle pads/knobs/LCD palette at 360×740 and 412×915), full-screen layout, pointer router, new engine + voice pool, factory sounds, 16 keys play the selected sound multi-touch, SOUND+key select, knobs pitch/tone, basic dot-matrix LCD. *Tests:* node render — slice k timing, chromatic pitch ±5 cents, no clicks on steal; CDP two-finger touch fires two notes; hold-key+drag-knob works simultaneously. Profile CPU on Android early.
2. **Sequencer.** Write mode, play/stop, 16 patterns, chains, BPM presets/tap/swing/volume, copy/clear, undo, autosave, SOUND/PATTERN/BPM sheets. *Tests:* onsets ±1 ms at 60–240 BPM, swing, chain switch at pattern end, store/undo units, reload persistence e2e.
3. **Live record, p-locks, note length.** *Tests:* quantize unit (position + latency → step), engine flam dedup, locked steps differ only on those steps (pitch/centroid).
4. **Sampling.** REC+slot mic, import, resample, trim via SOUND+knobs, auto-slice, slot editor sheet, OPFS, memory gauge, latency calibration. *Tests:* slicer on synthetic click trains, fakeMic e2e, samples survive reload.
5. **FX.** 16 FX, FX sheet, X/Y on knobs, recording into patterns. *Tests:* grid snapping, triplet period, octave doubles f0, lane replay, all FX < 0 dBFS and click-free.
6. **LCD art & polish.** Kitchen-chaos segment SVG driven by `activeSounds`/step events, glare, messages; offline SW, wake lock, haptics, fullscreen, WAV export/share, iOS pass.

## Risks
- iOS: gesture-resumed context; set `navigator.audioSession.type='playback'` (silent switch); mic opens play-and-record (lower volume, rate change) → stop tracks + restore after; `storage.persist()`; no Fullscreen API on iPhone (rely on standalone PWA).
- Android output latency 20–80 ms, `outputLatency` sometimes 0 → calibration + manual offset for live record.
- Stuck notes/FX from system gestures → global release on cancel/blur/visibility.
- Memory → mono, caps, peaks-only on main thread, transferred buffers.
- My SVG art will be simple at first; swappable by design.

## Verification
- `pnpm typecheck && pnpm test` (engine renders, store, slicer, quantize) and `pnpm test:e2e` (phone viewport, CDP multi-touch incl. "hold step + turn knob" and "two pads at once", fakeMic, reload persistence, every screen fits 360×640…412×915 with no scroll).
- `pnpm dev:lan` (HTTPS for AudioWorklet) → user tests on their Android phone each phase: timing steadiness, clicks, pad latency feel, knob feel, LCD readability. Claude can't judge sound/feel, so each phase ends with a "what to listen for" note in `docs/progress.md`.

# Asset licenses

## Factory sounds (`public/factory/`)

The 16 factory sound slots are rendered offline by `pnpm factory` (`tools/factory/`).

- **Slots 2-8 (melodic: Finger Bass, 808 Sub, Electric Piano, Soft Pad, Pluck Lead, Bell, Marimba)** and **slots 10-16 (synth drum kits)** are rendered by this project's own engines (an FM synthesizer, a Karplus-Strong / sine bass synth in `tools/factory/engines/bass.ts`, and a synthesized drum voice written by the project author). They contain no third-party audio.
- **Slot 1 (Piano)** and **slot 9 (Studio kit)** use CC0-1.0 recordings, listed below. CC0 needs no attribution; credit is given anyway.

### Piano source (CC0-1.0)

- Versilian Community Sample Library (VCSL) by Versilian Studios and contributors: https://github.com/sgossner/VCSL, commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`. The repository `LICENSE` is the CC0 1.0 Universal legal code (GitHub reports `CC0-1.0`).
- File: `Chordophones/Zithers/Grand Piano, Steinway B/NoSus/JHPiano_NoSus_Close_C4_vl3_rr1.wav` (Steinway B, no sustain pedal, close mics, C4, velocity layer 3), https://raw.githubusercontent.com/sgossner/VCSL/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Chordophones/Zithers/Grand%20Piano%2C%20Steinway%20B/NoSus/JHPiano_NoSus_Close_C4_vl3_rr1.wav (sha256 `238d6f0ed77d5696997e8be45e8d157389868cbd7396a59ad272c315fc464e5b`). `pnpm factory` downloads and checks it.
- Processing: stereo to mono, trimmed to the onset (-45 dB, 3 ms pre-roll), first 4.2 s kept with a 1.2 s quarter-sine tail fade, f0 measured (autocorrelation) and resampled to exactly C4 when more than 5 cents off, peak-normalized to -1 dBFS, 112 kbps MP3.

### Bass notes

No bass instrument exists in VCSL (checked the whole tree), so Finger Bass (C2, damped Karplus-Strong with soft-finger excitation, sub sine and gentle saturation) and 808 Sub (A1, sine with exponential pitch drop and level-dependent soft saturation) are synthesized by this project's own code.

### Studio kit sources (all CC0-1.0)

- Virtuosity Drums by Versilian Studios: https://github.com/sfzinstruments/virtuosity_drums (commit `9f04cf9a734527edfbb0a4eee1f674e45bbf71bc`). Kick, snare, sidestick, hi-hats, ride, ride bell, crash, flat-ride crash, toms, tambourine and cowbell.
- Phazite Sounds by august-byrne: https://github.com/august-byrne/phazite-sounds (commit `bd71faf5035e8aa278ebfe3f4dc68804ae7bc5ca`), used only for the clap (`pack/Drums/Claps/Clap Studio.flac`).
  - Upstream provenance (Phazite `pack/sources.json`): Versilian Community Sample Library (VCSL), `Idiophones/Struck Idiophones/Claps/Clap_rr1.wav` by Versilian Studios and contributors, CC0-1.0: https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Claps/Clap_rr1.wav
  - Phazite processing: trimmed to -60 dB, 10 ms fade-out, peak-normalized to -1 dBFS, 44.1 kHz 16-bit FLAC with triangular dither.

Source files per sound (paths inside the repositories above, same as the sibling project beatboy):

- kick: `Samples/kickmic/kick/kickmic_kick_snoff_vl3_rr1.flac` x0.7 + `Samples/oh/kick/oh_kick_snoff_vl3_rr1.flac` x0.3
- snare: `Samples/snaremic/snare/snaremic_snare_center_vl27.flac` x0.6 + `Samples/oh/snare/oh_snare_center_vl27.flac` x0.4
- sidestick: `Samples/snaremic/snare/snaremic_snare_crossstick_vl12.flac` x0.5 + `Samples/oh/snare/oh_snare_crossstick_vl12.flac` x0.5
- clap: Phazite `pack/Drums/Claps/Clap Studio.flac`
- hatClosed / hatPedal / hatOpen: `Samples/oh/hh/oh_hh_closed_vl3_rr1.flac`, `oh_hh_pedal_vl2_rr1.flac`, `oh_hh_open_vl3_rr1.flac`
- ride / rideBell: `Samples/oh/ride/oh_ride_ride_vl2_rr1.flac`, `oh_ride_bell_vl2_rr1.flac`
- crash / crash2: `Samples/oh/crash/oh_crash_crash_vl2_rr1.flac`, `Samples/oh/flatride/oh_flatride_crash_vl3.flac`
- tomHigh: `Samples/oh/htom/oh_htom_center_vl12.flac` x0.7 + `Samples/mid/htom/mid_htom_center_vl12.flac` x0.3
- tomMid: the high tom pitched down 3 semitones by resampling (the library has no mid tom)
- tomFloor: `Samples/oh/ltom/oh_ltom_center_vl12.flac` x0.7 + `Samples/mid/ltom/mid_ltom_center_vl12.flac` x0.3
- tambourine: `Samples/perc/oh/tambourine/Tamb1_Shake_rr1_Overhead.wav`
- cowbell: `Samples/perc/oh/cowbell/Cowbell1_Normal_v2_rr1_Overhead.wav`

### Processing

Stereo mixed to mono, leading silence trimmed, truncated with a fade, peak-normalized to -1 dBFS (44.1 kHz mono). For this app, per-sound gains are then applied, cymbals are cut to at most 1.2 s with a fade, and all hits are concatenated with 0.08 s gaps and encoded as a mono MP3 (libmp3lame, 112 kbps).

# [Temperaments](https://muk-labs.github.io/temperaments/)

An interactive tuning laboratory by **Adrián Artacho**, for the **Musik und Kunst Privatuniversität der Stadt Wien (MUK)**. See and hear how historical temperaments and contemporary divisions reshape the distances between notes.

## Play

Open the [instrument](https://adrianartacho.github.io/temperaments/), enable sound, and choose a temperament. Click the octave circle, cents ruler, or keyboard; use the computer keys `A W S E D F T G Y H U J K O L P ;`; or connect a MIDI controller.

- **15 Scala presets:** quarter-, third-, and sixth-comma meantone; Pythagorean; Werckmeister III; Kirnberger III; Vallotti; Young; Robert Rich's 12-note just scale; 12-, 19-, 24-, 31-, and 53-EDO; and Bohlen–Pierce.
- **Compare immediately:** switch between the selected temperament and 12-EDO, including held notes and a playing MIDI file.
- **Three sounds:** synthesized harpsichord, piano, and sine. These are harmonic synthesis models, not recordings of acoustic instruments. All audio is generated locally without external sample downloads.
- **MIDI input:** choose any exposed device or listen to all inputs; supports note velocity, sustain, and all-notes-off. Device connections refresh automatically.
- **MIDI performances:** open or drop a `.mid` / `.midi` file. Formats 0 and 1, multiple tracks, running status, and tempo changes are supported. Play, pause, resume, and stop; play through any selected sound and tuning.
- **Your scales:** drop or import a `.scl` file. Directly clicking a scale degree always accesses that degree, including pitches absent from the ordinary keyboard mapping.
- **Share a setup:** use “Copy this setup.” Imported scales are embedded in the URL fragment; MIDI performances are not shared.
- **All notes off:** use the button or `Esc`. Playback pauses when the page becomes hidden.

The wheel places the selected tuning around its repeating period, next to 100-cent reference positions. The linear view draws each selected pitch against the nearest 12-EDO position. The interval table reports exact cents, step sizes, and the original Scala values: ratios remain ratios, while decimal cent values are marked with ¢. The implicit unison is shown as 1/1. For non-octave scales, the display explicitly changes to a repeating-period view.

## Classroom presentation

The cents ruler uses the full content width. Directly below, the tuning circle sits beside the open interval table.

- [Jump to the ruler](https://adrianartacho.github.io/temperaments/#cents) with the `#cents` anchor.
- [Open presentation view](https://adrianartacho.github.io/temperaments/?present=1) with `present=1` (or append `&present=1` to existing parameters). It fills the browser window with the ruler and the temperament, sound, and comparison menus; the circle and other sections are hidden.
- Click **Enter fullscreen** to hide the browser chrome. A URL cannot automatically activate browser fullscreen because the Fullscreen API requires a user gesture. The **Presentation view** button enters the focused layout and requests fullscreen in the same click. If fullscreen is unavailable, the focused layout still works.
- **Leave fullscreen** keeps the focused view; **Exit presentation** restores the complete page. `Esc` still stops all sound and can leave browser fullscreen. MIDI input and a running MIDI file keep working when switching views.

Shared setup links retain presentation mode, and imported-scale links retain the original ratios and decimal precision.

## Keyboard mapping and pitch reference

The chosen root is fixed to its standard MIDI frequency on the selected A4 reference grid. By default, MIDI 60 / C4 is 261.625565 Hz on the A4=440 Hz grid. A4 itself may move under the temperament unless A4 is the chosen root. This gives both tunings the same root for comparisons.

| Setting | Behavior |
| --- | --- |
| 12-note scale | Consecutive MIDI keys follow the twelve Scala degrees; octaves repeat normally. |
| Nearest degree | For other octave scales, each MIDI semitone chooses the nearest degree. Twelve MIDI keys still span the octave, and some degrees may be omitted or repeated. |
| Sequential | One MIDI key per scale degree. A 31-note scale takes 31 keys to reach the next octave. Ordinary MIDI pieces consequently change melodic contours. |
| Non-octave scale | Sequential mapping is used automatically, preserving the scale's own period. |
| 12-EDO reference | MIDI keys play ordinary 12-EDO pitches on the same A4 reference grid. Directly clicked degrees compare with the nearest 100-cent position. |

`A4 reference` accepts 300–500 Hz. The visible keyboard spans two octaves from the C at or below the root; hardware/file input covers MIDI 0–127. The synthesizer plays frequencies from 8 Hz to 20 kHz. Extremely high or low results of unusual mappings are silent.

## URL parameters

Example: [Werckmeister III, sine tones](https://adrianartacho.github.io/temperaments/?scale=werckmeister-iii&instrument=sine).

| Parameter | Values / default |
| --- | --- |
| `scale` | ID from [`scales/catalog.json`](scales/catalog.json); default `meantone` |
| `instrument` | `harpsichord` (default), `piano`, `sine` |
| `mode` | `12edo` to start in the reference; otherwise the temperament |
| `root` | MIDI anchor 24–96; default `60` |
| `a4` | Reference-grid frequency, default `440` |
| `mapping` | `chromatic` (default) or `sequential` |
| `volume` | 0–100; default `55` |
| `present` | `1` opens the focused classroom view; omitted by default |

The interface keeps its URL in sync with these settings. An imported scale uses `scale=custom` and a `#scl=…` fragment with a concise Scala representation. Audio and MIDI permission are always started by the visitor's gesture; URLs never autoplay.

## Browser and file notes

Web Audio drives all three instruments. Hardware input uses the browser's **Web MIDI API**, which requires HTTPS (or localhost), a supported browser/OS, and MIDI permission. Chrome and Edge are recommended for controller use. If Web MIDI is unavailable, the on-screen instrument and MIDI file player remain available. Actual USB/Bluetooth device availability depends on the browser and operating system.

The app reads files locally; it has no accounts, analytics, upload service, or MIDI output. MIDI program changes and pitch bends are intentionally ignored so the selected instrument and tuning remain authoritative. MIDI channel 10 (percussion) is skipped. Playback uses a foreground browser timer; it is a teaching player, not a sample-accurate sequencer. Format 2 and SMPTE-timed files should be re-exported as format 0/1 with musical tick timing. Maximum MIDI size is 12 MiB, 500,000 events, and six hours.

Scala imports support cents, integer ratios, integer pitches interpreted as ratios, comments, and trailing labels. This player accepts 1–256 strictly ascending positive intervals and periods up to 4,800 cents. Unsupported scales produce an explanation and preserve the current playable setup. `.kbm` keyboard maps, MIDI Tuning Standard, and adaptive/context-dependent just intonation are not implemented. A static just scale changes its relationships when music modulates; this is part of the comparison.

## Run and develop

No bundler or production dependencies are needed. Use a web server rather than opening `index.html` via `file://`:

```sh
python3 -m http.server 8000
# Open http://localhost:8000
```

Node 20+ is used only for tests and preparing a clean deployment folder:

```sh
npm test
npm run build
```

Optional Chromium integration and real Web Audio tests:

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/browser.mjs
node tests/audio.browser.mjs
# CHROMIUM_PATH=/path/to/chromium can select an existing browser executable.
```

The automated checks cover Scala parsing, tuning mathematics, negative-note wrapping, MIDI tempo maps and malformed files; browser checks cover MIDI input with a simulated device, sustain, A/B frequencies, custom-scale URL restoration, MIDI file playback, and phone layout. Web Audio rendering verifies synthesis, decay, held-note pitch changes, and note-off. A physical controller cannot be exercised in the automated environment.

## GitHub Pages

The root `index.html` and relative asset paths support the repository's `/temperaments/` URL. The workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) tests the source, copies only the site assets into `dist/`, and publishes through GitHub Pages.

For the repository's initial activation, select **Settings → Pages → Build and deployment → Source: GitHub Actions**. Run “Test and publish GitHub Pages” from Actions if no new push follows that setting. Subsequent pushes to `main` publish automatically; pull requests run checks without deploying. If Pages has not been enabled, the build passes but the deploy job reports the missing Pages configuration.

## Sources and credits

Concept and development: **Adrián Artacho**. Institutional identity: **Musik und Kunst Privatuniversität der Stadt Wien · Institut I**.

- [`docs/SCALE-SOURCES.md`](docs/SCALE-SOURCES.md): exact Scala archive files, sources, and mapping rationale. Original historical descriptions and pitch data are preserved. Equal divisions are provided as ordinary `.scl` source files.
- [`docs/BRANDING.md`](docs/BRANDING.md): official MUK logo source and university-use terms. The institutional logo is not included in any blanket software license.
- [Scala file format](https://www.huygens-fokker.org/scala/scl_format.html) and [scale archive](https://www.huygens-fokker.org/scala/downloads.html).
- [Web MIDI documentation](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMIDIAccess).


## 📝 [ToDo](https://trello.com/c/MFrG2Ar2/108-temperaments)

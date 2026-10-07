# Scala sources and pitch mapping

The application reads every preset from its `.scl` file at runtime. The dropdown is indexed by [`scales/catalog.json`](../scales/catalog.json). The parser follows the [official Scala format](https://www.huygens-fokker.org/scala/scl_format.html): the root is implicit, decimal values mean cents, integer fractions mean frequency ratios, and a lone integer means a ratio to 1. A file's final interval is its repeating period.

## Preset provenance

The historical and just-intonation files are unchanged musical data from the [Huygens–Fokker Scala scale archive](https://www.huygens-fokker.org/docs/scales.zip), maintained by Manuel Op de Coul, version 94 (March 2026), downloaded 7 October 2026. Only filenames, text encoding (Latin-1 → UTF-8), and line endings (CRLF → LF) have changed. Original descriptions and pitch values are preserved. The archive's SHA-256 at retrieval was `d2218f2fa6acd3b11c116e0626bd178af927636e2ed26d0ab7a4c27741b97b9a`.

| Local preset | Original archive member | Interpretation |
| --- | --- | --- |
| `meantone` | `scl/meanquar.scl` | Quarter-comma meantone; the default. |
| `pythagorean` | `scl/pyth_12.scl` | A twelve-note Pythagorean selection. |
| `werckmeister-iii` | `scl/werck3.scl` | Werckmeister III. |
| `kirnberger-iii` | `scl/kirnberger3.scl` | Kirnberger III. |
| `vallotti` | `scl/vallotti.scl` | The archive's Vallotti version. |
| `young` | `scl/young.scl` | Young well temperament (the archive's 1807 variant). |
| `meantone-sixth` | `scl/meansixth.scl` | Sixth-comma meantone. |
| `meantone-third` | `scl/meanthird.scl` | Third-comma meantone. |
| `just` | `scl/ji_12.scl` | Robert Rich's twelve-note JI collection with a 7/5 tritone. |
| `bohlen-pierce` | `scl/bohlen-p_et.scl` | Thirteen equal divisions of 3:1, a tritave rather than an octave. |

The five EDO files (`12edo`, `19edo`, `24edo`, `31edo`, `53edo`) are generated here using `cents(k) = 1200 × k / N`, written to twelve decimal places, with an exact `2/1` endpoint. These are mathematical equal divisions, not historical measurements or copied archive files. The application does not depend on Scala software. Attribution for the source collection is retained here; no ownership of the source tunings is asserted.

Names such as “just intonation” and “Pythagorean” describe families, not one uniquely determined twelve-note set. This tool presents the specific selections above. Dates in original archive descriptions are retained as source metadata, not independently established historical claims. The numerical data must not be taken as a verdict on disputed reconstruction or performance practice.

## Keyboard mapping and the A/B reference

The selected root is assigned its ordinary equal-tempered MIDI frequency, calibrated by the A4 reference (440 Hz by default). With root C4, C4 remains about 261.626 Hz in both comparisons. Other notes—including A4—can move in the chosen temperament. Thus “A4 reference” defines the reference grid; it does not impose a second fixed note on every temperament.

- **Chromatic mapping, twelve-note octave scale:** successive MIDI semitones play successive scale degrees; twelve MIDI keys span an octave.
- **Chromatic mapping, another octave scale:** each equal-tempered semitone selects the nearest available degree by cent distance. Exact ties choose the lower pitch. An octave remains twelve MIDI keys; scales with fewer degrees can map several keys to the same pitch, and scales with more degrees leave some pitches off the conventional keyboard.
- **Sequential mapping:** each MIDI key advances one degree. An N-note scale repeats after N MIDI keys. This reaches every degree, but changes the interval layout of ordinary MIDI music.
- **Non-octave scale:** both settings use sequential mapping. This preserves the file's actual period instead of pretending that a tritave is an octave. A period within 0.01 cents of 1200 is treated as an octave for chromatic mapping.
- **12-EDO reference:** MIDI notes always use their ordinary semitone frequencies. For direct degree-based visual audition, the interface may instead compare a selected pitch against the nearest 12-EDO semitone; it should label that comparison explicitly.

Imported files are processed locally. `.kbm` keyboard mapping files are not interpreted. This player accepts 1–256 intervals that are positive and strictly ascending after the implicit unison; valid Scala files containing descending or duplicated degrees are outside this pedagogical player's supported subset. Empty descriptions, comments, trailing pitch labels, ratios, decimal cents, BOMs and common line endings are supported. Non-octave periods are accepted and retained.

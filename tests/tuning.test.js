import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseScala, serializeScala, degreeCents, centsForMidi, frequencyForMidi } from '../src/tuning.js';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('scales/catalog.json', root), 'utf8'));
const scales = Object.fromEntries(await Promise.all(catalog.map(async entry => [
  entry.id, parseScala(await readFile(new URL(entry.file, root), 'utf8'), entry.file),
])));
const close = (actual, expected, tolerance = 1e-8) => assert.ok(
  Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`,
);

test('all catalog entries load with unique IDs and playable intervals', () => {
  assert.equal(catalog.length, 15);
  assert.equal(new Set(catalog.map(entry => entry.id)).size, catalog.length);
  for (const scale of Object.values(scales)) {
    assert.equal(scale.cents.length, scale.count + 1);
    assert.equal(scale.cents[0], 0);
    assert.ok(scale.cents.every((value, i) => !i || value > scale.cents[i - 1]));
  }
});

test('Scala comments, BOM, CRLF, blank description, ratios and labels', () => {
  const raw = '\uFEFF! file\r\n   ! comment\r\n\r\n3 ! degrees\r\n! pitches\r\n100.0 C#\r\n 3 / 2 fifth\r\n2 octave\r\n';
  const scale = parseScala(raw, 'import.scl');
  assert.equal(scale.description, '');
  assert.equal(scale.count, 3);
  assert.equal(scale.raw, raw);
  close(scale.cents[1], 100);
  close(scale.cents[2], 1200 * Math.log2(3 / 2));
  close(scale.period, 1200);
});

test('an integer interval is a ratio, never an integer number of cents', () => {
  close(parseScala('Integer ratio\n1\n2').period, 1200);
  close(parseScala('Decimal cents\n1\n2.').period, 2);
});

test('original Scala numeric values and types retain notation, not pitch labels', () => {
  const scale = parseScala('Mixed notation\n5\n 100.000000001 label\n100.000000002 ! comment\n +5 / 4 major third\n +700.0000 cents\n2 octave');
  assert.deepEqual(scale.sourceValues, ['1/1', '100.000000001', '100.000000002', '+5 / 4', '+700.0000', '2']);
  assert.deepEqual(scale.sourceTypes, ['ratio', 'cents', 'cents', 'ratio', 'cents', 'ratio']);
  assert.equal(scales.meantone.sourceValues[4], '5/4');
  assert.equal(scales.meantone.sourceValues[7], '696.57843');
  assert.equal(scales.meantone.sourceTypes[7], 'cents');
});

test('Scala serialization preserves ratios, integers and close decimal degrees exactly', () => {
  const scale = parseScala('! file comment\nMixed notation\n5\n100.000000001 first\n100.000000002 second\n5 / 4 third\n700. fourth\n2 octave');
  const serialized = serializeScala(scale);
  assert.equal(serialized, 'Mixed notation\n5\n100.000000001\n100.000000002\n5 / 4\n700.\n2\n');
  const restored = parseScala(serialized);
  assert.deepEqual(restored.cents, scale.cents);
  assert.deepEqual(restored.sourceValues, scale.sourceValues);
  assert.deepEqual(restored.sourceTypes, scale.sourceTypes);
  for (const preset of Object.values(scales)) {
    const roundTrip = parseScala(serializeScala(preset));
    assert.deepEqual(roundTrip.cents, preset.cents);
    assert.deepEqual(roundTrip.sourceValues, preset.sourceValues);
  }
});

test('Scala serialization supports blank descriptions and limits long descriptions', () => {
  const empty = parseScala('! comment\n\n1\n2');
  assert.equal(serializeScala(empty), '\n1\n2\n');
  assert.equal(parseScala(serializeScala(empty)).description, '');
  const long = parseScala('x'.repeat(1200) + '\n1\n2');
  const restored = parseScala(serializeScala(long));
  assert.equal(restored.description, 'x'.repeat(500));
  assert.deepEqual(restored.cents, long.cents);
});

test('malformed and non-playable scales produce useful errors', () => {
  for (const text of [
    'Missing notes\n2\n2/1', 'Extra notes\n1\n3/2\n2/1',
    'Zero count\n0', 'Too many\n257', 'Bad count\n2.0\n100.0\n2/1',
    'Zero denominator\n1\n3/0', 'Negative ratio\n1\n-3/2',
    'Bad fraction\n1\n3/2/1', 'Bad fraction\n1\n3 / -2',
    'Unison\n1\n1/1', 'Negative cents\n1\n-1.0',
    'Descending\n2\n3/2\n5/4', 'Repeated\n2\n100.0\n100.0',
  ]) assert.throws(() => parseScala(text, 'bad.scl'), /bad\.scl:/);
});

test('historical scale values are sourced pitches, including pure thirds', () => {
  close(scales.meantone.cents[4], 1200 * Math.log2(5 / 4));
  close(scales.meantone.cents[7], 696.57843);
  close(scales.pythagorean.cents[7], 1200 * Math.log2(3 / 2));
  close(scales['kirnberger-iii'].cents[4], scales.meantone.cents[4]);
  close(scales.just.cents[6], 1200 * Math.log2(7 / 5));
});

test('12-EDO reproduces standard MIDI and reference comparison exactly', () => {
  for (let note = 0; note <= 127; note++) {
    close(frequencyForMidi(note, scales['12edo']), 440 * 2 ** ((note - 69) / 12), 1e-8);
    close(frequencyForMidi(note, scales.meantone, { reference: true }), 440 * 2 ** ((note - 69) / 12), 1e-8);
  }
});

test('the root stays fixed; A4 calibration is a reference grid, not a second anchor', () => {
  close(frequencyForMidi(60, scales.meantone), 440 * 2 ** (-9 / 12));
  close(frequencyForMidi(64, scales.meantone), frequencyForMidi(60, scales.meantone) * 5 / 4);
  close(frequencyForMidi(69, scales.meantone, { root: 69, a4: 415 }), 415);
  assert.notEqual(frequencyForMidi(69, scales.meantone), 440);
});

test('degrees and MIDI mapping repeat correctly below the root', () => {
  close(degreeCents(-1, scales.meantone), scales.meantone.cents[11] - 1200);
  close(centsForMidi(48, scales.meantone), -1200);
  close(centsForMidi(59, scales.meantone), scales.meantone.cents[11] - 1200);
  close(centsForMidi(79, scales['19edo'], { mapping: 'sequential' }), 1200);
  close(centsForMidi(41, scales['19edo'], { mapping: 'sequential' }), -1200);
});

test('chromatic mapping selects nearest pitch and keeps a 12-key octave', () => {
  close(centsForMidi(61, scales['19edo']), 2400 / 19);
  close(centsForMidi(59, scales['19edo']), -2400 / 19);
  close(centsForMidi(72, scales['31edo']), 1200);
  close(centsForMidi(61, scales['24edo']), 100);
  close(centsForMidi(61, scales['24edo'], { mapping: 'sequential' }), 50);
  const wholeTone = parseScala('whole tone\n6\n200.0\n400.0\n600.0\n800.0\n1000.0\n2');
  close(centsForMidi(61, wholeTone), 0); // Equidistant notes prefer the lower pitch.
});

test('non-octave scales keep their own period and use one key per degree', () => {
  const bp = scales['bohlen-pierce'];
  close(bp.period, 1200 * Math.log2(3));
  close(centsForMidi(73, bp), bp.period);
  close(frequencyForMidi(73, bp), frequencyForMidi(60, bp) * 3);
  close(centsForMidi(47, bp), -bp.period);
});

test('invalid numerical API input is rejected', () => {
  assert.throws(() => centsForMidi(60.5, scales.meantone), /integer/);
  assert.throws(() => centsForMidi(60, scales.meantone, { mapping: 'typo' }), /Mapping/);
  assert.throws(() => frequencyForMidi(60, scales.meantone, { a4: 0 }), /positive/);
});

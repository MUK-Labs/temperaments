/** Scala parsing and pitch arithmetic. All distances are cents from the selected root. */
const MAX_DEGREES = 256;
const OCTAVE_TOLERANCE = 0.01;

/**
 * Read a playable, ascending Scala scale. Degree 0 (1/1) is implicit in .scl files.
 * Returns N + 1 cent values: unison, intermediate degrees, and the repeating period.
 */
export function parseScala(text, filename = '') {
  const prefix = filename ? `${filename}: ` : '';
  const fail = message => { throw new Error(`${prefix}${message}`); };
  if (typeof text !== 'string') fail('Scala data must be text.');
  if (text.length > 1024 * 1024) fail('Scala file is too large (maximum 1 MiB).');
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
    .map((value, index) => ({ value, number: index + 1 }))
    .filter(line => !/^\s*!/.test(line.value));
  if (lines.length < 2) fail('Expected a description line and a note count.');
  // A blank first non-comment line is a valid, deliberately empty description.
  const description = lines.shift().value.trim();
  const entries = lines.map(line => ({ ...line, value: line.value.split('!')[0].trim() }))
    .filter(line => line.value !== '');
  if (!entries.length || !/^\d+$/.test(entries[0].value)) {
    fail('The note count must be an integer from 1 to 256.');
  }
  const count = Number(entries.shift().value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_DEGREES) {
    fail('The note count must be an integer from 1 to 256.');
  }
  if (entries.length !== count) {
    fail(`Declared ${count} intervals, but found ${entries.length}.`);
  }
  const cents = [0];
  for (const line of entries) {
    const token = line.value;
    let value;
    // Numeric labels must be separated by whitespace. Ratio members may have spaces.
    const ratio = token.match(/^(\+?\d+)\s*\/\s*(\+?\d+)(?=\s|$)/);
    const decimal = token.match(/^([+-]?(?:\d+\.\d*|\.\d+))(?=\s|$)/);
    const integer = token.match(/^(\+?\d+)(?=\s|$)/);
    if (ratio) {
      const numerator = Number(ratio[1]);
      const denominator = Number(ratio[2]);
      if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator <= 0 || denominator <= 0) {
        fail(`Line ${line.number}: ratios need positive, safe integer numerator and denominator.`);
      }
      value = 1200 * Math.log2(numerator / denominator);
    } else if (decimal) {
      value = Number(decimal[1]);
    } else if (integer && !token.slice(integer[0].length).trimStart().startsWith('/')) {
      const numerator = Number(integer[1]);
      if (!Number.isSafeInteger(numerator) || numerator <= 0) {
        fail(`Line ${line.number}: an integer interval must be a positive ratio to 1.`);
      }
      value = 1200 * Math.log2(numerator);
    } else {
      fail(`Line ${line.number}: invalid pitch “${token}”. Use decimal cents (100.0) or an integer ratio (9/8).`);
    }
    if (!Number.isFinite(value) || value <= cents[cents.length - 1]) {
      fail(`Line ${line.number}: intervals must be positive and strictly ascending after the implicit 1/1.`);
    }
    cents.push(value);
  }
  return { description, count, cents, period: cents[count], raw: text };
}

function assertScale(scale) {
  if (!scale || !Number.isInteger(scale.count) || scale.count < 1 ||
      !Array.isArray(scale.cents) || scale.cents.length !== scale.count + 1 ||
      !Number.isFinite(scale.period) || scale.period <= 0) {
    throw new TypeError('Expected a parsed Scala scale.');
  }
}

function assertInteger(value, name) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be an integer.`);
}

/** Return a scale degree in cents, repeating correctly below and above the root. */
export function degreeCents(index, scale) {
  assertScale(scale);
  assertInteger(index, 'Scale degree');
  const periods = Math.floor(index / scale.count);
  const degree = index - periods * scale.count;
  return periods * scale.period + scale.cents[degree];
}

/**
 * Chromatic: preserve 12-key octaves; for N != 12 choose the nearest degree to each
 * 12-EDO semitone (ties choose the lower pitch). Sequential: one key per degree.
 * Non-octave scales always use sequential mapping, so their period is respected.
 */
export function centsForMidi(note, scale, { root = 60, mapping = 'chromatic' } = {}) {
  assertScale(scale);
  assertInteger(note, 'MIDI note');
  assertInteger(root, 'Root note');
  if (mapping !== 'chromatic' && mapping !== 'sequential') {
    throw new TypeError('Mapping must be “chromatic” or “sequential”.');
  }
  const delta = note - root;
  if (mapping === 'sequential' || Math.abs(scale.period - 1200) > OCTAVE_TOLERANCE || scale.count === 12) {
    return degreeCents(delta, scale);
  }
  const octaves = Math.floor(delta / 12);
  const target = (delta - octaves * 12) * 100;
  let nearest = 0;
  let distance = Infinity;
  for (const value of scale.cents) {
    const current = Math.abs(value - target);
    if (current < distance - 1e-9) {
      distance = current;
      nearest = value;
    }
  }
  return octaves * scale.period + nearest;
}

/** The root retains its 12-EDO frequency. “a4” calibrates that reference grid. */
export function frequencyForMidi(note, scale, { root = 60, mapping = 'chromatic', reference = false, a4 = 440 } = {}) {
  assertInteger(note, 'MIDI note');
  if (!Number.isFinite(a4) || a4 <= 0) throw new TypeError('A4 reference must be a positive frequency.');
  if (reference) return a4 * 2 ** ((note - 69) / 12);
  const cents = centsForMidi(note, scale, { root, mapping });
  return a4 * 2 ** ((root - 69) / 12 + cents / 1200);
}

/**
 * Standard MIDI File reader (formats 0 and 1, metrical tick division).
 * References: MIDI Association RP-001 Standard MIDI Files Specification.
 * Events use seconds and zero-based channels; same-tick file order is preserved.
 * Program changes and pitch bend are intentionally not applied: the instrument
 * and the tuning selected by the learner remain authoritative.
 */
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_EVENTS = 500000;
const MAX_DURATION = 6 * 60 * 60;

class Reader {
  constructor(bytes, start = 0, end = bytes.length) {
    this.bytes = bytes;
    this.position = start;
    this.end = end;
  }
  require(count) {
    if (!Number.isSafeInteger(count) || count < 0 || this.position + count > this.end) throw new Error('Truncated MIDI file: an event or chunk extends beyond its data.');
  }
  byte() { this.require(1); return this.bytes[this.position++]; }
  uint16() { return this.byte() * 256 + this.byte(); }
  uint32() { return this.byte() * 16777216 + this.byte() * 65536 + this.byte() * 256 + this.byte(); }
  text(count) { this.require(count); let value = ''; for (let i = 0; i < count; i++) value += String.fromCharCode(this.byte()); return value; }
  skip(count) { this.require(count); this.position += count; }
  vlq() {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.byte();
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('Invalid MIDI variable-length number (more than four bytes).');
  }
  data() { const value = this.byte(); if (value >= 128) throw new Error('Invalid MIDI data byte: expected a value from 0 to 127.'); return value; }
}

/**
 * @returns {{events: Array, duration: number, format: number, trackCount: number}}
 * Types: on/off {note, velocity, channel}; sustain {value, channel};
 * panic {channel, value: 120|123}. Sustain value is the raw CC64 value (0–127).
 * A panic event requests release of every held/sustained note on its channel.
 */
export function parseMidi(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error('Expected MIDI file data as an ArrayBuffer.');
  if (arrayBuffer.byteLength > MAX_BYTES) throw new Error('MIDI file is too large. The limit is 12 MB.');
  const reader = new Reader(new Uint8Array(arrayBuffer));
  if (reader.text(4) !== 'MThd') throw new Error('This is not a Standard MIDI File: missing MThd header.');
  const headerLength = reader.uint32();
  if (headerLength < 6) throw new Error('Invalid MIDI header length.');
  reader.require(headerLength);
  const format = reader.uint16();
  const trackCount = reader.uint16();
  const division = reader.uint16();
  reader.skip(headerLength - 6);
  if (format === 2) throw new Error('MIDI format 2 contains independent sequences. Please export a format 0 or format 1 file.');
  if (format !== 0 && format !== 1) throw new Error(`Unsupported MIDI format ${format}. Use format 0 or 1.`);
  if (!trackCount || (format === 0 && trackCount !== 1)) throw new Error('Invalid number of MIDI tracks. Format 0 must contain exactly one track.');
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported. Please export using beats/ticks (PPQ).');
  if (!division) throw new Error('Invalid MIDI tick division: PPQ must be greater than zero.');
  const timeline = [];
  let eventCount = 0;
  let order = 0;
  let lastTick = 0;
  let tracksRead = 0;
  while (tracksRead < trackCount) {
    const chunk = reader.text(4);
    const length = reader.uint32();
    reader.require(length);
    const end = reader.position + length;
    if (chunk !== 'MTrk') { reader.skip(length); continue; }
    const track = new Reader(reader.bytes, reader.position, end);
    reader.position = end;
    let tick = 0;
    let runningStatus = 0;
    let ended = false;
    while (track.position < track.end) {
      if (++eventCount > MAX_EVENTS) throw new Error('MIDI file has too many events. The limit is 500,000.');
      tick += track.vlq();
      if (!Number.isSafeInteger(tick)) throw new Error('MIDI timestamp exceeds the supported range.');
      lastTick = Math.max(lastTick, tick);
      let status = track.byte();
      if (status < 0x80) {
        if (!runningStatus) throw new Error('Invalid MIDI running status: data appears before a channel status.');
        track.position--;
        status = runningStatus;
      } else if (status < 0xf0) runningStatus = status;
      else runningStatus = 0;
      if (status === 0xff) {
        const type = track.byte();
        const size = track.vlq();
        track.require(size);
        if (type === 0x51) {
          if (size !== 3) throw new Error('Invalid MIDI tempo event length.');
          const tempo = track.byte() * 65536 + track.byte() * 256 + track.byte();
          if (tempo <= 0) throw new Error('Invalid MIDI tempo: microseconds per quarter note must be positive.');
          timeline.push({ tick, order: order++, type: 'tempo', tempo });
        } else if (type === 0x2f) {
          if (size !== 0) throw new Error('Invalid MIDI end-of-track event length.');
          ended = true;
          break;
        } else track.skip(size);
      } else if (status === 0xf0 || status === 0xf7) {
        track.skip(track.vlq());
      } else if (status >= 0xf0) {
        throw new Error(`Unsupported MIDI system status 0x${status.toString(16)} in track data.`);
      } else {
        const command = status >> 4;
        const channel = status & 0x0f;
        const first = track.data();
        const second = command === 0xc || command === 0xd ? 0 : track.data();
        if (command === 0x8 || command === 0x9) {
          timeline.push({ tick, order: order++, type: command === 0x8 || second === 0 ? 'off' : 'on', note: first, velocity: second, channel });
        } else if (command === 0xb && first === 64) {
          timeline.push({ tick, order: order++, type: 'sustain', value: second, channel });
        } else if (command === 0xb && (first === 120 || first === 123)) {
          timeline.push({ tick, order: order++, type: 'panic', value: first, channel });
        }
      }
    }
    if (!ended) throw new Error(`MIDI track ${tracksRead + 1} is missing its end-of-track event.`);
    tracksRead++;
  }
  timeline.sort((left, right) => left.tick - right.tick || left.order - right.order);
  let previousTick = 0;
  let seconds = 0;
  let tempo = 500000; // MIDI default: 120 quarter notes/minute.
  const events = [];
  for (const entry of timeline) {
    seconds += (entry.tick - previousTick) * tempo / (division * 1000000);
    previousTick = entry.tick;
    if (entry.type === 'tempo') tempo = entry.tempo;
    else {
      const { tick, order: fileOrder, ...event } = entry;
      events.push({ ...event, time: seconds });
    }
  }
  const duration = seconds + (lastTick - previousTick) * tempo / (division * 1000000);
  if (duration > MAX_DURATION) throw new Error('MIDI duration exceeds six hours. Please use a shorter excerpt.');
  return { events, duration, format, trackCount };
}

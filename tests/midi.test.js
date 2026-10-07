import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi } from '../src/midi-file.js';

const ascii = (text) => [...text].map((character) => character.charCodeAt(0));
const u32 = (number) => [number >>> 24 & 255, number >>> 16 & 255, number >>> 8 & 255, number & 255];
const end = [0, 0xff, 0x2f, 0];
const vlq = (number) => {
  const result = [number & 0x7f];
  while ((number >>>= 7)) result.unshift((number & 0x7f) | 0x80);
  return result;
};
function midi(tracks, { format = tracks.length > 1 ? 1 : 0, division = 480 } = {}) {
  return new Uint8Array([
    ...ascii('MThd'), ...u32(6), 0, format, tracks.length >> 8, tracks.length & 255, division >> 8, division & 255,
    ...tracks.flatMap((track) => [...ascii('MTrk'), ...u32(track.length), ...track]),
  ]).buffer;
}

test('format 0: running status, zero-velocity note-off and default tempo', () => {
  const result = parseMidi(midi([[0, 0x90, 60, 100, ...vlq(480), 64, 80, ...vlq(480), 60, 0, 0, 0x80, 64, 30, ...end]]));
  assert.equal(result.format, 0);
  assert.equal(result.trackCount, 1);
  assert.equal(result.duration, 1);
  assert.deepEqual(result.events, [
    { type: 'on', note: 60, velocity: 100, channel: 0, time: 0 },
    { type: 'on', note: 64, velocity: 80, channel: 0, time: 0.5 },
    { type: 'off', note: 60, velocity: 0, channel: 0, time: 1 },
    { type: 'off', note: 64, velocity: 30, channel: 0, time: 1 },
  ]);
});

test('format 1: conductor tempo map applies to merged tracks and trailing rest', () => {
  const result = parseMidi(midi([
    [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, ...vlq(480), 0xff, 0x51, 3, 0x0f, 0x42, 0x40, ...vlq(960), 0xff, 0x2f, 0],
    [0, 0x91, 60, 100, ...vlq(960), 0x81, 60, 0, ...end],
    [...vlq(480), 0x92, 67, 100, ...vlq(480), 0x82, 67, 0, ...end],
  ]));
  assert.equal(result.trackCount, 3);
  assert.deepEqual(result.events.map(({ time, channel }) => [time, channel]), [[0, 1], [0.5, 2], [1.5, 1], [1.5, 2]]);
  assert.equal(result.duration, 2.5);
});

test('sustain and channel panic survive parsing; program changes are skipped', () => {
  const result = parseMidi(midi([[0, 0xc3, 6, 0, 0xb3, 64, 127, 0, 120, 0, 0, 123, 0, 0, 64, 0, ...end]]));
  assert.deepEqual(result.events, [
    { type: 'sustain', value: 127, channel: 3, time: 0 },
    { type: 'panic', value: 120, channel: 3, time: 0 },
    { type: 'panic', value: 123, channel: 3, time: 0 },
    { type: 'sustain', value: 0, channel: 3, time: 0 },
  ]);
});

test('same-tick rearticulation preserves note-off before note-on', () => {
  const result = parseMidi(midi([[0, 0x90, 60, 90, ...vlq(240), 0x80, 60, 0, 0, 0x90, 60, 90, ...vlq(240), 0x80, 60, 0, ...end]]));
  assert.deepEqual(result.events.map(({ type, time }) => [type, time]), [['on', 0], ['off', 0.25], ['on', 0.25], ['off', 0.5]]);
});

test('SysEx and text meta events are safely skipped', () => {
  const result = parseMidi(midi([[0, 0xf0, 3, 1, 2, 0xf7, 0, 0xff, 1, 2, 65, 66, 0, 0x99, 35, 90, ...end]]));
  assert.equal(result.events[0].channel, 9);
  assert.equal(result.events[0].note, 35);
});

test('unsupported timing and independent sequences explain the required export', () => {
  assert.throws(() => parseMidi(midi([end], { division: 0xe728 })), /SMPTE/);
  assert.throws(() => parseMidi(midi([end], { format: 2 })), /format 2/);
  assert.throws(() => parseMidi(midi([end], { division: 0 })), /PPQ/);
});

test('rejects truncation, invalid data, missing track endings and invalid running status', () => {
  const valid = midi([[0, 0x90, 60, 80, ...end]]);
  assert.throws(() => parseMidi(valid.slice(0, -1)), /Truncated/);
  assert.throws(() => parseMidi(midi([[0, 60, 80, ...end]])), /running status/);
  assert.throws(() => parseMidi(midi([[0, 0x90, 60, 0x90, ...end]])), /data byte/);
  assert.throws(() => parseMidi(midi([[0, 0x90, 60, 80]])), /end-of-track/);
  assert.throws(() => parseMidi(midi([[0x80, 0x80, 0x80, 0x80, 0, ...end]])), /four bytes/);
});

test('tempo and meta event lengths are validated', () => {
  assert.throws(() => parseMidi(midi([[0, 0xff, 0x51, 2, 1, 2, ...end]])), /tempo event length/);
  assert.throws(() => parseMidi(midi([[0, 0xff, 0x51, 3, 0, 0, 0, ...end]])), /tempo/);
  assert.throws(() => parseMidi(midi([[0, 0xff, 0x01, 100, 65, ...end]])), /Truncated/);
});

test('bounded file size and duration fail clearly', () => {
  assert.throws(() => parseMidi(new ArrayBuffer(12 * 1024 * 1024 + 1)), /too large/);
  assert.throws(() => parseMidi(midi([[...vlq(268435455), 0xff, 0x2f, 0]])), /six hours/);
});

test('running status is cleared by meta and SysEx events', () => {
  assert.throws(() => parseMidi(midi([[0, 0x90, 60, 100, 0, 0xff, 1, 0, 0, 60, 0, ...end]])), /running status/);
  assert.throws(() => parseMidi(midi([[0, 0x90, 60, 100, 0, 0xf7, 0, 0, 60, 0, ...end]])), /running status/);
});

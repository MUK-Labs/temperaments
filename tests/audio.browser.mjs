/** Optional real-Web-Audio smoke test: requires Playwright + Chromium. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const playwrightPath = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? pathToFileURL(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright/index.mjs`).href
  : 'playwright';
const { chromium } = await import(playwrightPath);
const source = await readFile(new URL('../src/audio.js', import.meta.url));
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': request.url === '/audio.js' ? 'application/javascript' : 'text/html' });
  response.end(request.url === '/audio.js' ? source : '<!doctype html><title>Audio verification</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const results = await page.evaluate(async () => {
    const { AudioEngine } = await import('/audio.js');
    const rms = (data, begin, end) => {
      let sum = 0;
      for (let index = begin; index < end; index++) sum += data[index] ** 2;
      return Math.sqrt(sum / (end - begin));
    };
    const pitch = (data, begin, end, sampleRate) => {
      const crossings = [];
      for (let index = begin + 1; index < end; index++) {
        if (data[index - 1] <= 0 && data[index] > 0) crossings.push(index - data[index] / (data[index] - data[index - 1]));
      }
      return (crossings.length - 1) * sampleRate / (crossings.at(-1) - crossings[0]);
    };
    const results = {};
    for (const instrument of ['harpsichord', 'piano', 'sine']) {
      const sampleRate = 44100;
      const offline = new OfflineAudioContext(1, sampleRate * 2, sampleRate);
      // Adapt the running-context contract to deterministic offline rendering.
      const adapter = new Proxy(offline, {
        get(target, key) {
          if (key === 'state') return 'running';
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const original = globalThis.AudioContext;
      globalThis.AudioContext = class { constructor() { return adapter; } };
      const engine = new AudioEngine();
      await engine.start();
      globalThis.AudioContext = original;
      engine.setInstrument(instrument);
      if (!engine.noteOn('test', 440, 100)) throw new Error('Voice did not start');
      let retuned;
      if (instrument === 'sine') {
        retuned = offline.suspend(0.7).then(() => {
          engine.retune('test', 466.1637615);
          return offline.resume();
        });
        offline.suspend(1.3).then(() => {
          engine.noteOff('test');
          return offline.resume();
        });
      }
      const buffer = await offline.startRendering();
      if (retuned) await retuned;
      const data = buffer.getChannelData(0);
      results[instrument] = {
        onsetSeconds: data.findIndex(value => Math.abs(value) > 0.00001) / sampleRate,
        attackRms: rms(data, sampleRate * 0.05, sampleRate * 0.15),
        tailRms: rms(data, sampleRate * 1.75, sampleRate * 1.85),
        peak: data.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0),
      };
      if (instrument === 'sine') {
        results.sine.beforeHz = pitch(data, sampleRate * 0.2, sampleRate * 0.4, sampleRate);
        results.sine.afterHz = pitch(data, sampleRate * 0.95, sampleRate * 1.15, sampleRate);
      }
      // Clear wall-clock cleanup timers without affecting the rendered buffer.
      for (const voice of [...engine.voices]) engine._destroy(voice);
    }
    return results;
  });
  for (const instrument of ['harpsichord', 'piano', 'sine']) {
    assert(results[instrument].onsetSeconds >= 0 && results[instrument].onsetSeconds < 0.02, `${instrument} must begin promptly after note-on`);
    assert(results[instrument].attackRms > 0.001, `${instrument} must produce audible audio`);
    assert(results[instrument].peak < 1, `${instrument} must remain below clipping`);
  }
  for (const instrument of ['harpsichord', 'piano']) {
    assert(results[instrument].tailRms < results[instrument].attackRms * 0.5, `${instrument} must decay naturally`);
  }
  assert(Math.abs(results.sine.beforeHz - 440) < 0.1, 'Sine fundamental must start at the requested pitch');
  assert(Math.abs(results.sine.afterHz - 466.1637615) < 0.1, 'Held sine must retune to the requested comparison pitch');
  assert(results.sine.tailRms < 0.000001, 'Note-off must release the sustained sine');
  console.log(JSON.stringify(results, null, 2));
  console.log('Web Audio output, natural decay, held-note retuning, and note-off verified.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

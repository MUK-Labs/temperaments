// Optional browser integration test: npm install --no-save playwright && npx playwright install chromium
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = resolve(".");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".scl": "text/plain",
};
const server = createServer(async (req, res) => {
  try {
    const path = resolve(
      root,
      decodeURIComponent(req.url.split("?")[0]).replace(
        /^\/temperaments\//,
        "",
      ) || "index.html",
    );
    if (!path.startsWith(root + "/")) throw Error();
    res.setHeader(
      "Content-Type",
      types[extname(path)] || "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/temperaments/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const input = {
      id: "test",
      name: "Test keyboard",
      state: "connected",
      type: "input",
    };
    const access = { inputs: new Map([["test", input]]) };
    window.testMidi = (bytes) =>
      input.onmidimessage?.({ data: new Uint8Array(bytes) });
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: async () => access,
      configurable: true,
    });
  });
  await page.goto(url);
  await page.waitForFunction(
    () =>
      document.querySelector("#scale-title").textContent ===
      "Quarter-comma meantone",
  );
  await page.screenshot({
    path: process.env.SCREENSHOT_DESKTOP || "/tmp/temperaments-desktop.png",
    fullPage: true,
  });
  await page.locator("#audio-start").click();
  assert.equal(await page.locator("#audio-label").innerText(), "Sound on");
  await page.locator('[data-note="64"]').click();
  assert.match(await page.locator("#note-frequency").innerText(), /327\.03/);
  assert.match(await page.locator("#note-delta").innerText(), /13\.69/);
  await page.locator("#reference-mode").click();
  assert.match(await page.locator("#note-frequency").innerText(), /329\.63/);
  await page.locator("#connect-midi").click();
  assert.equal(await page.locator("#midi-indicator").innerText(), "CONNECTED");
  await page.evaluate(() => testMidi([0x90, 64, 100]));
  await page.waitForSelector('[data-note="64"].active');
  await page.evaluate(() => {
    testMidi([0xb0, 64, 127]);
    testMidi([0x80, 64, 0]);
  });
  assert.equal(
    await page.locator('[data-note="64"]').getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#tuned-mode").click();
  assert.match(await page.locator("#note-frequency").innerText(), /327\.03/);
  await page.evaluate(() => testMidi([0xb0, 64, 0]));
  assert.equal(
    await page.locator('[data-note="64"]').getAttribute("aria-pressed"),
    "false",
  );
  await page.locator("#scale-select").selectOption("31edo");
  await page.waitForFunction(
    () => document.querySelector("#scale-title").textContent === "31-EDO",
  );
  assert.equal(await page.locator("#wheel .svg-note").count(), 31);
  await page.locator(".detail-card").first().locator("summary").click();
  await page.locator("#mapping").selectOption("sequential");
  await page.locator('[data-note="64"]').click();
  assert.match(await page.locator("#note-frequency").innerText(), /286\.10/);
  const share = page.url();
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector("#scale-title").textContent === "31-EDO",
  );
  assert.equal(await page.locator("#mapping").inputValue(), "sequential");
  assert.equal(page.url(), share);
  await page.locator("#scl-file").setInputFiles({
    name: "test.scl",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Test pentatonic\n5\n200.0\n400.0\n700.0\n900.0\n2/1\n",
    ),
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#scale-title").textContent === "Test pentatonic",
  );
  assert.equal(await page.locator("#wheel .svg-note").count(), 5);
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector("#scale-title").textContent === "Test pentatonic",
  );
  await page.locator("#scl-file").setInputFiles({
    name: "bad.scl",
    mimeType: "text/plain",
    buffer: Buffer.from("Bad\n2\n200.0\n-100.0"),
  });
  await page.waitForFunction(() => !document.querySelector("#notice").hidden);
  assert.match(await page.locator("#notice").innerText(), /ascending/);
  assert.equal(
    await page.locator("#scale-title").innerText(),
    "Test pentatonic",
  );
  const track = [0, 0x90, 60, 90, 0x83, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0];
  const bytes = Buffer.from([
    ...Buffer.from("MThd"),
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    1,
    0xe0,
    ...Buffer.from("MTrk"),
    0,
    0,
    0,
    track.length,
    ...track,
  ]);
  await page
    .locator("#midi-file")
    .setInputFiles({ name: "test.mid", mimeType: "audio/midi", buffer: bytes });
  await page.waitForFunction(
    () => !document.querySelector("#midi-play").disabled,
  );
  await page.locator("#midi-play").click();
  await page.waitForSelector('[data-note="60"].active');
  await page.locator("#reference-mode").click();
  await page.locator("#midi-stop").click();
  assert.equal(await page.locator(".key.active").count(), 0);
  await page.locator("#scale-select").selectOption("bohlen-pierce");
  await page.waitForFunction(() =>
    document.querySelector("#scale-title").textContent.includes("Bohlen"),
  );
  assert.match(await page.locator("#period-value").innerText(), /1,901\.96/);
  assert.match(
    await page.locator("#mapping-summary").innerText(),
    /13 keys per period/,
  );
  await page.locator("#scale-select").selectOption("custom");
  assert.equal(
    await page.locator("#scale-title").innerText(),
    "Test pentatonic",
  );
  await page
    .locator("#scl-file")
    .setInputFiles({
      name: "huge.scl",
      mimeType: "text/plain",
      buffer: Buffer.from("Huge\n1\n1000000000.0"),
    });
  assert.match(await page.locator("#notice").innerText(), /4,800/);
  assert.equal(
    await page.locator("#scale-title").innerText(),
    "Test pentatonic",
  );
  await page.goto(`${url}#scl=Invalid`);
  await page.waitForFunction(
    () =>
      document.querySelector("#scale-title").textContent ===
      "Quarter-comma meantone",
  );
  await page.locator("#scale-select").selectOption("19edo");
  await page.waitForFunction(
    () => document.querySelector("#scale-title").textContent === "19-EDO",
  );
  await page.goto(url);
  await page.waitForFunction(
    () =>
      document.querySelector("#scale-title").textContent ===
      "Quarter-comma meantone",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: process.env.SCREENSHOT_MOBILE || "/tmp/temperaments-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser integration passed: sound start, pitch A/B, MIDI input + sustain, Scala import + URL, MIDI file playback, non-octave, responsive layout.",
  );
} finally {
  await browser.close();
  server.close();
}

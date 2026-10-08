import {
  parseScala,
  serializeScala,
  centsForMidi,
  frequencyForMidi,
  degreeCents,
} from "./tuning.js";
import { AudioEngine } from "./audio.js";
import { parseMidi } from "./midi-file.js";

const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const mod = (n, d) => ((n % d) + d) % d;
const noteName = (n) => names[mod(n, 12)] + (Math.floor(n / 12) - 1);
const signed = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
const audio = new AudioEngine();
const query = new URLSearchParams(location.search);
const numberParam = (key, fallback, min, max) => {
  const n = Number(query.get(key));
  return query.has(key) && Number.isFinite(n)
    ? Math.min(max, Math.max(min, n))
    : fallback;
};
const state = {
  scale: null,
  entry: null,
  catalog: [],
  root: Math.round(numberParam("root", 60, 24, 96)),
  a4: numberParam("a4", 440, 300, 500),
  mapping: query.get("mapping") === "sequential" ? "sequential" : "chromatic",
  reference: ["12edo", "reference"].includes(query.get("mode")),
  instrument: ["harpsichord", "piano", "sine"].includes(query.get("instrument"))
    ? query.get("instrument")
    : "harpsichord",
  volume: numberParam("volume", 55, 0, 100),
  custom: false,
  present: query.get("present") === "1",
};
document.body.classList.toggle("presenting", state.present);

const active = new Map(),
  pedals = new Map(),
  pendingReleases = new Set(),
  demoTimers = new Set();
let catalogRequest = 0,
  access = null,
  file = null,
  fileLabel = "",
  playing = false,
  playPosition = 0,
  eventIndex = 0,
  playStart = 0,
  lastSpec = null,
  importedScale = null;
const baseFrequency = () => state.a4 * 2 ** ((state.root - 69) / 12);
const options = () => ({
  root: state.root,
  a4: state.a4,
  mapping: state.mapping,
  reference: state.reference,
});
const effectiveMapping = () =>
  Math.abs(state.scale.period - 1200) > 0.01 ? "sequential" : state.mapping;
function notify(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}
function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
function add(parent, tag, attrs, text) {
  const el = svg(tag, attrs, text);
  parent.append(el);
  return el;
}
function scaleCents(spec) {
  return spec.kind === "degree"
    ? degreeCents(spec.degree, state.scale)
    : centsForMidi(spec.note, state.scale, options());
}
function referenceCents(spec) {
  return spec.kind === "degree"
    ? Math.round(degreeCents(spec.degree, state.scale) / 100) * 100
    : (spec.note - state.root) * 100;
}
function frequency(spec) {
  return spec.kind === "degree"
    ? baseFrequency() *
        2 **
          ((state.reference ? referenceCents(spec) : scaleCents(spec)) / 1200)
    : frequencyForMidi(spec.note, state.scale, options());
}
async function startAudio() {
  try {
    await audio.start();
    $("audio-start").classList.add("running");
    $("audio-label").textContent = "Sound on";
    return true;
  } catch (error) {
    notify(`Sound could not start: ${error.message}`);
    return false;
  }
}
async function beginNote(id, spec, velocity = 92, channelKey = "ui") {
  if (!state.scale) return;
  endNote(id, true);
  const record = { spec, velocity, channelKey };
  active.set(id, record);
  lastSpec = spec;
  updateReadout(spec);
  highlight();
  if (audio.state === "running") {
    audio.noteOn(id, frequency(spec), velocity);
  } else if (await startAudio()) {
    if (active.get(id) === record) audio.noteOn(id, frequency(spec), velocity);
  } else {
    if (active.get(id) === record) active.delete(id);
    highlight();
  }
}
function endNote(id, force = false) {
  const record = active.get(id);
  if (!record) return;
  if (!force && pedals.get(record.channelKey)) {
    pendingReleases.add(id);
    return;
  }
  pendingReleases.delete(id);
  active.delete(id);
  audio.noteOff(id);
  highlight();
}
function clearSource(prefix) {
  for (const [id] of active) if (id.startsWith(prefix)) endNote(id, true);
  for (const key of pedals.keys())
    if (key.startsWith(prefix)) pedals.delete(key);
}
function clearDemo() {
  for (const timer of demoTimers) clearTimeout(timer);
  demoTimers.clear();
  clearSource("demo:");
}
function panic() {
  clearDemo();
  active.clear();
  pendingReleases.clear();
  pedals.clear();
  audio.allOff();
  highlight();
}
function later(fn, ms) {
  const timer = setTimeout(() => {
    demoTimers.delete(timer);
    fn();
  }, ms);
  demoTimers.add(timer);
}
function pulseDegree(degree) {
  const id = `demo:degree:${degree}`;
  beginNote(id, { kind: "degree", degree });
  later(() => endNote(id, true), 650);
}
function updateReadout(spec) {
  if (!spec) return;
  const cents = state.reference ? referenceCents(spec) : scaleCents(spec);
  $("note-name").textContent =
    spec.kind === "degree" ? `deg ${spec.degree}` : noteName(spec.note);
  $("note-frequency").textContent = `${frequency(spec).toFixed(2)} Hz`;
  $("note-delta").textContent = `${signed(cents - referenceCents(spec))} ¢`;
}
function highlight() {
  document.querySelectorAll(".key").forEach((el) => {
    const on = [...active.values()].some(
      (x) => x.spec.kind === "midi" && x.spec.note === Number(el.dataset.note),
    );
    el.classList.toggle("active", on);
    el.setAttribute("aria-pressed", String(on));
  });
  if (!state.scale) return;
  const period = state.scale.period;
  document.querySelectorAll(".svg-note").forEach((el) => {
    const cent = Number(el.dataset.cents);
    const on = [...active.values()].some(
      (x) =>
        Math.abs(mod(scaleCents(x.spec), period) - mod(cent, period)) < 0.01,
    );
    el.classList.toggle("active", on);
  });
}
function setMode(reference) {
  state.reference = reference;
  document.body.classList.toggle("reference-active", reference);
  $("tuned-mode").classList.toggle("selected", !reference);
  $("reference-mode").classList.toggle("selected", reference);
  $("tuned-mode").setAttribute("aria-pressed", String(!reference));
  $("reference-mode").setAttribute("aria-pressed", String(reference));
  for (const [id, record] of active) audio.retune(id, frequency(record.spec));
  updateReadout(lastSpec);
  updateUrl();
}
function updateUrl() {
  if (!state.entry) return;
  const url = new URL(location.href);
  url.search = "";
  const p = url.searchParams;
  p.set("scale", state.custom ? "custom" : state.entry.id);
  p.set("instrument", state.instrument);
  if (state.reference) p.set("mode", "12edo");
  if (state.root !== 60) p.set("root", state.root);
  if (state.a4 !== 440) p.set("a4", state.a4);
  if (state.mapping !== "chromatic") p.set("mapping", state.mapping);
  if (state.volume !== 55) p.set("volume", state.volume);
  if (state.present) p.set("present", "1");
  url.hash = state.custom
    ? new URLSearchParams({
        scl: serializeScala(state.scale),
      }).toString()
    : state.present || location.hash === "#cents"
      ? "cents"
      : "";
  history.replaceState(null, "", url);
}
function playableNode(parent, x, y, degree, cents, label, small = false) {
  const g = add(parent, "g", {
    class: "svg-note",
    "data-cents": cents,
    tabindex: "0",
    role: "button",
    "aria-label": `Play ${label}, ${cents.toFixed(2)} cents`,
  });
  add(g, "circle", { cx: x, cy: y, r: small ? 12 : 14, fill: "transparent" });
  add(g, "circle", {
    cx: x,
    cy: y,
    r: small ? 4 : 5.5,
    fill: "#a01414",
    stroke: "#fff",
    "stroke-width": 2,
  });
  add(g, "title", {}, `${label} · ${cents.toFixed(2)} ¢`);
  g.addEventListener("click", () => pulseDegree(degree));
  g.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pulseDegree(degree);
    }
  });
  return g;
}
function renderRuler() {
  if (!state.scale) return;
  const scale = state.scale;
  const { count, period } = scale;
  const ruler = $("ruler");
  const bounds = ruler.parentElement.getBoundingClientRect();
  const viewWidth =
    state.present && bounds.height > 0
      ? Math.max(760, (bounds.width / bounds.height) * 255)
      : 760;
  ruler.setAttribute("viewBox", `0 0 ${viewWidth} 255`);
  ruler.replaceChildren();
  const left = 25,
    right = viewWidth - 25,
    w = right - left,
    X = (c) => left + (c / period) * w;
  for (let c = 0; c <= period + 0.001; c += 100) {
    const x = X(c);
    add(ruler, "line", {
      x1: x,
      x2: x,
      y1: 34,
      y2: 211,
      stroke: "#eeeae5",
      "stroke-width": 1,
    });
    add(
      ruler,
      "text",
      {
        x,
        y: 229,
        "text-anchor": "middle",
        fill: "#8b817a",
        "font-family": "monospace",
        "font-size": 11,
      },
      String(c),
    );
  }
  for (const y of [78, 170])
    add(ruler, "line", {
      x1: left,
      x2: right,
      y1: y,
      y2: y,
      stroke: "#dad4cc",
      "stroke-width": 1,
    });
  add(
    ruler,
    "text",
    {
      x: left,
      y: 25,
      fill: "#8b817a",
      "font-family": "Arial",
      "font-size": 10,
      "letter-spacing": 1.4,
    },
    "12-EDO REFERENCE",
  );
  add(
    ruler,
    "text",
    {
      x: left,
      y: 134,
      fill: "#a01414",
      "font-family": "Arial",
      "font-size": 10,
      "letter-spacing": 1.4,
    },
    "SELECTED SCALE",
  );
  for (let c = 0; c <= period + 0.001; c += 100) {
    const x = X(c);
    add(ruler, "circle", {
      cx: x,
      cy: 78,
      r: 4,
      fill: "white",
      stroke: "#a9a096",
      "stroke-width": 1,
    });
    if (c % 200 === 0 || period <= 1200)
      add(
        ruler,
        "text",
        {
          x,
          y: 62,
          "text-anchor": "middle",
          fill: "#8b817a",
          "font-family": "Arial",
          "font-size": 10,
        },
        names[mod(state.root + c / 100, 12)],
      );
  }
  for (let i = 0; i <= count; i++) {
    const cents = scale.cents[i],
      x = X(cents),
      refC = Math.round(cents / 100) * 100;
    add(ruler, "line", {
      x1: X(refC),
      y1: 85,
      x2: x,
      y2: 161,
      stroke: "#d5a39c",
      "stroke-width": 1,
      class: "tuning-connector",
    });
    const label = count === 12 ? names[mod(state.root + i, 12)] : String(i);
    playableNode(ruler, x, 170, i, cents, label, count > 24);
    if (count <= 24 || i % Math.ceil(count / 24) === 0)
      add(
        ruler,
        "text",
        {
          x,
          y: 198,
          "text-anchor": "middle",
          fill: "#a01414",
          "font-family": "monospace",
          "font-size": 10,
        },
        signed(cents - refC),
      );
  }
  highlight();
}
function renderVisuals() {
  const scale = state.scale,
    count = scale.count,
    period = scale.period,
    octave = Math.abs(period - 1200) <= 0.01;
  $("scale-title").textContent = state.entry.name;
  $("scale-family").textContent = state.entry.family;
  $("scale-description").textContent =
    state.entry.description || scale.description;
  $("period-label").textContent = octave
    ? "THE OCTAVE, IN CENTS"
    : "THE REPEATING PERIOD, IN CENTS";
  $("period-value").textContent =
    `${period.toLocaleString("en", { maximumFractionDigits: 2 })} ¢`;
  $("scale-source").href = state.custom ? "#" : state.entry.file;
  $("scale-source").hidden = state.custom;
  const wheel = $("wheel");
  wheel.replaceChildren();
  const cx = 210,
    cy = 210,
    r = 145,
    ref = 119;
  for (const radius of [ref, r])
    add(wheel, "circle", {
      cx,
      cy,
      r: radius,
      fill: "none",
      stroke: "#e3dfd8",
      "stroke-width": 1,
      "stroke-dasharray": radius === ref ? "2 4" : "none",
    });
  const pos = (cent, radius) => {
    const angle = (cent / period) * Math.PI * 2 - Math.PI / 2;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  };
  for (let cent = 0; cent < period - 0.01; cent += 100) {
    const [x, y] = pos(cent, ref);
    add(wheel, "circle", {
      cx: x,
      cy: y,
      r: 3,
      fill: "#fff",
      stroke: "#aaa49c",
      "stroke-width": 1,
    });
  }
  for (let i = 0; i < count; i++) {
    const cents = scale.cents[i],
      [x, y] = pos(cents, r),
      [x2, y2] = pos(Math.round(cents / 100) * 100, ref);
    add(wheel, "line", {
      x1: x,
      y1: y,
      x2,
      y2,
      stroke: "#d5a39c",
      "stroke-width": 1,
      class: "tuning-spoke",
    });
    const label = count === 12 ? names[mod(state.root + i, 12)] : String(i);
    playableNode(wheel, x, y, i, cents, label, count > 24);
    if (count <= 24 || i % Math.ceil(count / 24) === 0) {
      const [tx, ty] = pos(cents, 169);
      add(
        wheel,
        "text",
        {
          x: tx,
          y: ty + 4,
          "text-anchor": "middle",
          fill: i === 0 ? "#a01414" : "#6a625c",
          "font-family": "Arial,sans-serif",
          "font-size": count > 24 ? 9 : 12,
        },
        label,
      );
    }
  }
  add(
    wheel,
    "text",
    {
      x: cx,
      y: cy - 3,
      "text-anchor": "middle",
      fill: "#292625",
      "font-family": "Georgia,serif",
      "font-size": 58,
    },
    count,
  );
  add(
    wheel,
    "text",
    {
      x: cx,
      y: cy + 25,
      "text-anchor": "middle",
      fill: "#8b8077",
      "font-family": "Arial,sans-serif",
      "font-size": 9,
      "letter-spacing": 2.5,
    },
    "TONES / PERIOD",
  );
  add(
    wheel,
    "text",
    {
      x: cx,
      y: cy + 48,
      "text-anchor": "middle",
      fill: "#a01414",
      "font-family": "Arial,sans-serif",
      "font-size": 10,
    },
    `${noteName(state.root)} · ${baseFrequency().toFixed(2)} Hz`,
  );
  renderRuler();
  const tbody = $("interval-table");
  tbody.replaceChildren();
  for (let i = 0; i <= count; i++) {
    const row = document.createElement("tr");
    [
      i,
      scale.sourceValues[i] + (scale.sourceTypes[i] === "cents" ? " ¢" : ""),
      scale.cents[i].toFixed(3),
      i ? (scale.cents[i] - scale.cents[i - 1]).toFixed(3) : "—",
      signed(scale.cents[i] - Math.round(scale.cents[i] / 100) * 100),
    ].forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v;
      row.append(td);
    });
    tbody.append(row);
  }
  const sequential = effectiveMapping() === "sequential";
  $("mapping-summary").textContent =
    `${noteName(state.root)} anchor · ${sequential ? `${count} keys per period` : "12 keys per octave"} · A4 reference ${state.a4} Hz`;
  $("mapping-help").textContent =
    `The root stays at its 12-EDO reference frequency. ${sequential ? `Consecutive MIDI keys advance by one scale degree; ${count} keys span the ${octave ? "octave" : "period"}. MIDI pieces therefore change melodic contours when the scale has other than 12 degrees.` : "Each MIDI key uses the nearest available degree within its octave. In a 12-note scale, degrees map directly to the twelve keys."}${!octave ? " Non-octave scales automatically use sequential mapping." : ""} A/B compares the same MIDI key with its ordinary 12-EDO pitch; directly clicked degrees compare with the nearest 100-cent position.`;
  highlight();
}
function renderKeyboard() {
  const keyboard = $("keyboard");
  keyboard.replaceChildren();
  const first = Math.floor(state.root / 12) * 12,
    notes = Array.from({ length: 25 }, (_, i) => first + i);
  const whites = notes.filter((n) => ![1, 3, 6, 8, 10].includes(n % 12));
  let whiteIndex = 0;
  for (const note of notes) {
    const black = [1, 3, 6, 8, 10].includes(note % 12);
    const button = document.createElement("button");
    button.className = `key ${black ? "black" : "white"}`;
    button.dataset.note = note;
    button.setAttribute("aria-label", `Play ${noteName(note)}, MIDI ${note}`);
    button.setAttribute("aria-pressed", "false");
    button.textContent = noteName(note);
    if (black) button.style.left = `${(whiteIndex / whites.length) * 100}%`;
    else whiteIndex++;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      beginNote(`pointer:${event.pointerId}`, { kind: "midi", note });
    });
    for (const eventType of [
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ])
      button.addEventListener(eventType, (event) =>
        endNote(`pointer:${event.pointerId}`, true),
      );
    button.addEventListener("keydown", (event) => {
      if (["Enter", " "].includes(event.key) && !event.repeat) {
        event.preventDefault();
        beginNote(`button:${note}`, { kind: "midi", note });
      }
    });
    button.addEventListener("keyup", (event) => {
      if (["Enter", " "].includes(event.key)) {
        event.preventDefault();
        endNote(`button:${note}`, true);
      }
    });
    button.addEventListener("blur", () => endNote(`button:${note}`, true));
    keyboard.append(button);
  }
}
async function selectScale(id) {
  const entry = state.catalog.find(
    (x) => x.id === id || x.file.endsWith("/" + id),
  );
  if (!entry) throw new Error(`Unknown scale “${id}”.`);
  const request = ++catalogRequest;
  const response = await fetch(entry.file);
  if (!response.ok) throw new Error(`Cannot load ${entry.file}.`);
  const text = await response.text();
  const scale = parseScala(text, entry.file);
  if (request !== catalogRequest) return;
  stopPlayback();
  panic();
  state.scale = scale;
  state.entry = entry;
  state.custom = false;
  lastSpec = null;
  $("scale-select").value = entry.id;
  renderVisuals();
  renderKeyboard();
  updateUrl();
}
function applyCustom(text, filename) {
  const scale = parseScala(text, filename);
  if (scale.period > 4800)
    throw new Error(
      "This viewer supports repeating periods up to 4,800 cents (four octaves).",
    );
  importedScale = { text, filename };
  ++catalogRequest;
  stopPlayback();
  panic();
  state.scale = scale;
  state.entry = {
    id: "custom",
    name: scale.description || filename || "Imported scale",
    family: "IMPORTED SCALA SCALE",
    description: scale.description,
  };
  state.custom = true;
  let option = $("scale-select").querySelector("[value=custom]");
  if (!option) {
    option = new Option("", "custom");
    $("scale-select").append(option);
  }
  option.textContent = `Imported · ${state.entry.name}`;
  $("scale-select").value = "custom";
  lastSpec = null;
  renderVisuals();
  renderKeyboard();
  updateUrl();
}
function handleMidi(event, source) {
  const channelKey = `${source}:${event.channel}`,
    id = `${channelKey}:${event.note}`;
  if (event.channel === 9) return;
  if (event.type === "on")
    beginNote(
      id,
      { kind: "midi", note: event.note },
      event.velocity,
      channelKey,
    );
  else if (event.type === "off") endNote(id);
  else if (event.type === "sustain") {
    const down = event.value >= 64;
    pedals.set(channelKey, down);
    if (!down)
      for (const key of [...pendingReleases])
        if (active.get(key)?.channelKey === channelKey) endNote(key, true);
  } else if (event.type === "panic") {
    if (event.value === 120) {
      for (const [key, record] of active)
        if (record.channelKey === channelKey) endNote(key, true);
    } else {
      for (const [key, record] of active)
        if (record.channelKey === channelKey) endNote(key);
    }
  }
}
function receiveMidi(message, source) {
  const [status, note, value] = message.data,
    type = status & 0xf0,
    channel = status & 15;
  if (type === 0x90)
    handleMidi(
      { type: value ? "on" : "off", note, velocity: value, channel },
      source,
    );
  else if (type === 0x80) handleMidi({ type: "off", note, channel }, source);
  else if (type === 0xb0 && [64, 120, 123].includes(note))
    handleMidi(
      {
        type: note === 64 ? "sustain" : "panic",
        value: note === 64 ? value : note,
        channel,
      },
      source,
    );
}
function refreshMidi() {
  const selected = $("midi-input").value;
  const inputs = [...access.inputs.values()].filter(
    (input) => input.state === "connected",
  );
  $("midi-input").replaceChildren(new Option("All available inputs", "all"));
  for (const input of inputs)
    $("midi-input").append(new Option(input.name || input.id, input.id));
  $("midi-input").value = inputs.some((x) => x.id === selected)
    ? selected
    : "all";
  $("midi-input").disabled = !inputs.length;
  for (const input of access.inputs.values())
    input.onmidimessage = (event) => {
      if ($("midi-input").value === "all" || $("midi-input").value === input.id)
        receiveMidi(event, `live:${input.id}`);
    };
  $("midi-status").textContent = inputs.length
    ? `${inputs.length} input${inputs.length === 1 ? "" : "s"} available. Notes, velocity, and sustain pedal are active; percussion channel 10 is skipped.`
    : "MIDI access allowed. No inputs found yet—connect a USB or virtual MIDI device.";
  $("midi-indicator").textContent = inputs.length
    ? "CONNECTED"
    : "WAITING FOR INPUT";
  $("midi-indicator").classList.toggle("connected", inputs.length > 0);
  $("connect-midi").textContent = "Refresh MIDI";
}
async function connectMidi() {
  if (!navigator.requestMIDIAccess) {
    $("midi-status").textContent =
      "This browser does not expose Web MIDI. Try Chrome or Edge on a supported device. Clicking notes and MIDI file playback still work.";
    return;
  }
  if (!(await startAudio())) return;
  try {
    if (!access) {
      access = await navigator.requestMIDIAccess({ sysex: false });
      access.onstatechange = (event) => {
        if (event.port.type === "input" && event.port.state === "disconnected")
          clearSource(`live:${event.port.id}:`);
        refreshMidi();
      };
    }
    refreshMidi();
  } catch (error) {
    $("midi-status").textContent =
      `MIDI access was not granted (${error.message}). Allow MIDI in your browser’s site settings and try again.`;
  }
}
const clock = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
function drawTransport() {
  $("midi-play").textContent = playing ? "Ⅱ Pause" : "▶ Play";
  $("midi-play").setAttribute(
    "aria-label",
    playing ? "Pause MIDI file" : "Play MIDI file",
  );
  $("file-progress").value = file ? playPosition / file.duration : 0;
  $("file-time").textContent = file
    ? `${clock(playPosition)} / ${clock(file.duration)}`
    : "0:00";
}
function stopPlayback() {
  playing = false;
  playPosition = 0;
  eventIndex = 0;
  clearSource("file:");
  drawTransport();
}
function pausePlayback() {
  if (!playing) return;
  playPosition = Math.min(
    file.duration,
    (performance.now() - playStart) / 1000,
  );
  playing = false;
  clearSource("file:");
  drawTransport();
}
async function togglePlayback() {
  if (!file) return;
  if (playing) {
    pausePlayback();
    return;
  }
  if (!(await startAudio())) return;
  if (playPosition >= file.duration) {
    playPosition = 0;
    eventIndex = 0;
  }
  clearSource("file:");
  if (playPosition > 0) {
    const held = new Map(),
      sustains = new Map();
    for (let i = 0; i < eventIndex; i++) {
      const ev = file.events[i],
        key = `${ev.channel}:${ev.note}`;
      if (ev.type === "on") held.set(key, { ...ev, released: false });
      if (ev.type === "off") {
        if (sustains.get(ev.channel)) {
          if (held.has(key)) held.get(key).released = true;
        } else held.delete(key);
      }
      if (ev.type === "sustain") {
        sustains.set(ev.channel, ev.value >= 64);
        if (ev.value < 64)
          for (const [k, v] of held)
            if (v.channel === ev.channel && v.released) held.delete(k);
      }
      if (ev.type === "panic")
        for (const [k, v] of held)
          if (v.channel === ev.channel) {
            if (ev.value === 120 || !sustains.get(ev.channel)) held.delete(k);
            else v.released = true;
          }
    }
    for (const [channel, down] of sustains)
      if (down) handleMidi({ type: "sustain", channel, value: 127 }, "file");
    for (const ev of held.values()) {
      handleMidi(ev, "file");
      if (ev.released) handleMidi({ ...ev, type: "off" }, "file");
    }
  }
  playStart = performance.now() - playPosition * 1000;
  playing = true;
  drawTransport();
}
setInterval(() => {
  if (!playing || !file) return;
  playPosition = Math.min(
    file.duration,
    (performance.now() - playStart) / 1000,
  );
  while (
    eventIndex < file.events.length &&
    file.events[eventIndex].time <= playPosition
  )
    handleMidi(file.events[eventIndex++], "file");
  if (playPosition >= file.duration) {
    playing = false;
    clearSource("file:");
  }
  drawTransport();
}, 12);
async function loadFile(upload) {
  if (!upload) return;
  try {
    if (/\.scl$/i.test(upload.name)) {
      if (upload.size > 128 * 1024)
        throw new Error("Scala files must be smaller than 128 KB.");
      applyCustom(await upload.text(), upload.name);
      notify("");
      return;
    }
    if (!/\.midi?$/i.test(upload.name))
      throw new Error(
        "Choose a Scala .scl or standard MIDI .mid / .midi file.",
      );
    if (upload.size > 12 * 1024 * 1024)
      throw new Error("MIDI files must be smaller than 12 MB.");
    const parsed = parseMidi(await upload.arrayBuffer());
    if (!parsed.events.some((e) => e.type === "on" && e.channel !== 9))
      throw new Error(
        "This file has no pitched note events (percussion channel 10 is skipped).",
      );
    stopPlayback();
    file = parsed;
    fileLabel = upload.name;
    $("file-name").textContent = fileLabel;
    $("file-name").title = fileLabel;
    $("midi-play").disabled = false;
    $("midi-stop").disabled = false;
    drawTransport();
    notify("");
  } catch (error) {
    notify(error.message);
  }
}

function updateFullscreenControl() {
  $("fullscreen-toggle").textContent = document.fullscreenElement
    ? "Leave fullscreen"
    : "Enter fullscreen";
  $("fullscreen-toggle").setAttribute(
    "aria-pressed",
    String(Boolean(document.fullscreenElement)),
  );
}
function setPresentation(present, focus = false) {
  state.present = present;
  document.body.classList.toggle("presenting", present);
  $("presentation-toggle").setAttribute("aria-pressed", String(present));
  $("presentation-status").textContent = "";
  updateUrl();
  requestAnimationFrame(() => {
    renderRuler();
    $("cents").scrollIntoView({ block: "start" });
    if (focus)
      $(present ? "scale-select" : "presentation-toggle").focus({
        preventScroll: true,
      });
  });
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    } else {
      $("presentation-status").textContent =
        "Fullscreen is unavailable here. Presentation view still fills the browser window.";
    }
  } catch {
    $("presentation-status").textContent =
      "Your browser kept this view in the window. You can still project it.";
  }
  updateFullscreenControl();
}
$("presentation-toggle").addEventListener("click", () => {
  setPresentation(true, true);
  // Fullscreen requires this explicit click; URL startup uses the window-filling view.
  if (!document.fullscreenElement) toggleFullscreen();
});
$("fullscreen-toggle").addEventListener("click", toggleFullscreen);
$("presentation-exit").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  setPresentation(false, true);
});
document.addEventListener("fullscreenchange", updateFullscreenControl);
document.querySelector(".tuning-anchor").addEventListener("click", (event) => {
  // Imported scales already occupy the URL fragment; keep their share data intact.
  if (state.custom) {
    event.preventDefault();
    $("cents").scrollIntoView({ block: "start" });
  }
});
const rulerObserver = new ResizeObserver(() => renderRuler());
rulerObserver.observe($("ruler").parentElement);
updateFullscreenControl();

$("audio-start").addEventListener("click", startAudio);
$("tuned-mode").addEventListener("click", () => setMode(false));
$("reference-mode").addEventListener("click", () => setMode(true));
$("instrument").value = state.instrument;
audio.setInstrument(state.instrument);
$("instrument").addEventListener("change", () => {
  state.instrument = $("instrument").value;
  audio.setInstrument(state.instrument);
  for (const [id, record] of active)
    audio.noteOn(id, frequency(record.spec), record.velocity);
  updateUrl();
});
$("volume").value = state.volume;
audio.setVolume(state.volume / 100);
$("volume").addEventListener("input", () => {
  state.volume = Number($("volume").value);
  audio.setVolume(state.volume / 100);
  updateUrl();
});
for (let note = 24; note <= 96; note++)
  $("root").append(new Option(`${noteName(note)} · MIDI ${note}`, note));
$("root").value = state.root;
$("a4").value = state.a4;
$("mapping").value = state.mapping;
for (const id of ["root", "a4", "mapping"])
  $(id).addEventListener("change", () => {
    stopPlayback();
    panic();
    const a4 = Number($("a4").value);
    state.a4 = Number.isFinite(a4) && a4 >= 300 && a4 <= 500 ? a4 : 440;
    $("a4").value = state.a4;
    state.root = Number($("root").value);
    state.mapping = $("mapping").value;
    if (state.scale) {
      renderVisuals();
      renderKeyboard();
      updateReadout(lastSpec);
      updateUrl();
    }
  });
$("scale-select").addEventListener("change", async () => {
  if ($("scale-select").value === "custom") {
    if (importedScale) applyCustom(importedScale.text, importedScale.filename);
    return;
  }
  const previous = state.entry?.id || "meantone";
  try {
    await selectScale($("scale-select").value);
    notify("");
  } catch (error) {
    $("scale-select").value = previous;
    notify(error.message);
  }
});
$("play-scale").addEventListener("click", async () => {
  if (!state.scale || !(await startAudio())) return;
  clearDemo();
  const count = state.scale.count;
  for (let degree = 0; degree <= count; degree++) {
    later(
      () => {
        const id = `demo:scale:${degree}`;
        beginNote(id, { kind: "degree", degree });
        later(() => endNote(id, true), 300);
      },
      degree * (count > 31 ? 120 : 330),
    );
  }
});
$("play-chord").addEventListener("click", async () => {
  if (!state.scale || !(await startAudio())) return;
  clearDemo();
  for (const offset of [0, 4, 7]) {
    const id = `demo:chord:${offset}`;
    beginNote(id, { kind: "midi", note: state.root + offset }, 90);
    later(() => endNote(id, true), 2200);
  }
});
$("panic").addEventListener("click", () => {
  pausePlayback();
  panic();
});
$("connect-midi").addEventListener("click", connectMidi);
$("midi-input").addEventListener("change", () => clearSource("live:"));
$("midi-play").addEventListener("click", togglePlayback);
$("midi-stop").addEventListener("click", stopPlayback);
for (const id of ["midi-file", "scl-file"])
  $(id).addEventListener("change", (event) => {
    loadFile(event.target.files[0]);
    event.target.value = "";
  });
$("share").addEventListener("click", async () => {
  updateUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    $("share").textContent = "Link copied ✓";
    setTimeout(() => ($("share").textContent = "Copy this setup ↗"), 2200);
  } catch {
    notify(
      `Copy the address in your browser to share this setup. Imported MIDI files are not included.`,
    );
  }
});
let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (event.dataTransfer.types.includes("Files")) {
    event.preventDefault();
    dragDepth++;
    document.body.classList.add("dragging");
  }
});
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
});
document.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove("dragging");
  }
});
document.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const uploads = [...event.dataTransfer.files];
  for (const upload of uploads) await loadFile(upload);
});
const keyMap = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ";": 16,
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    pausePlayback();
    panic();
    return;
  }
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)
  )
    return;
  const offset = keyMap[event.key.toLowerCase()];
  if (offset !== undefined && !event.repeat) {
    event.preventDefault();
    beginNote(`typing:${event.code}`, {
      kind: "midi",
      note: state.root + offset,
    });
  }
});
document.addEventListener("keyup", (event) =>
  endNote(`typing:${event.code}`, true),
);
window.addEventListener("blur", () => {
  clearSource("typing:");
  clearSource("pointer:");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pausePlayback();
    panic();
  }
});
async function init() {
  try {
    const response = await fetch("scales/catalog.json");
    if (!response.ok) throw new Error("The scale catalog could not be loaded.");
    state.catalog = await response.json();
    $("scale-select").replaceChildren();
    const groups = new Map();
    for (const entry of state.catalog) {
      if (!groups.has(entry.family)) {
        const group = document.createElement("optgroup");
        group.label = entry.family;
        groups.set(entry.family, group);
        $("scale-select").append(group);
      }
      groups.get(entry.family).append(new Option(entry.name, entry.id));
    }
    $("scale-select").disabled = false;
    const custom = new URLSearchParams(location.hash.slice(1)).get("scl");
    if (custom) {
      try {
        if (custom.length > 128 * 1024)
          throw new Error("The shared Scala scale is too large.");
        applyCustom(custom, "Shared Scala scale");
      } catch (error) {
        await selectScale("meantone");
        notify(`${error.message} Showing quarter-comma meantone.`);
      }
    } else {
      let id = query.get("scale") || "meantone";
      if (
        !state.catalog.some((x) => x.id === id || x.file.endsWith("/" + id))
      ) {
        notify(`Scale “${id}” was not found. Showing quarter-comma meantone.`);
        id = "meantone";
      }
      await selectScale(id);
    }
    setMode(state.reference);
    if (state.present) setPresentation(true);
    else if (location.hash === "#cents")
      requestAnimationFrame(() =>
        $("cents").scrollIntoView({ block: "start" }),
      );
    if (!navigator.requestMIDIAccess) {
      $("midi-status").textContent =
        "Web MIDI is unavailable in this browser. Use Chrome or Edge for a controller; the screen keyboard and MIDI files work here.";
      $("connect-midi").disabled = true;
    }
  } catch (error) {
    notify(`${error.message} Refresh to try again, or import a .scl file.`);
  }
}
init();

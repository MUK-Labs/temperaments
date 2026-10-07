/**
 * Small, entirely synthesized Web Audio instruments. No recordings or downloads.
 * The harpsichord has a short pluck, bright harmonics and a longer string body;
 * piano uses a softer hammer and a darker, longer body. Sine is a pure oscillator.
 * All harmonic layers share the exact requested fundamental for tuning comparisons.
 */
const INSTRUMENTS = new Set(['harpsichord', 'piano', 'sine']);
const MAX_VOICES = 64;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export class AudioEngine {
  constructor() {
    this.context = null;
    this.instrument = 'harpsichord';
    this.volume = 0.55;
    this.active = new Map();
    this.voices = new Set();
    this.waves = new Map();
  }

  get state() {
    return this.context?.state ?? 'uninitialized';
  }

  /** Call from a click, tap or key gesture before accepting hardware MIDI. */
  async start() {
    if (!this.context || this.context.state === 'closed') {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('This browser does not support Web Audio.');
      this.context = new AudioContextClass({ latencyHint: 'interactive' });
      this.waves.clear();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      // Leave headroom for chords and limit very dense MIDI performances.
      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.threshold.value = -12;
      this.limiter.knee.value = 12;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.004;
      this.limiter.release.value = 0.12;
      this.master.connect(this.limiter).connect(this.context.destination);
      this.noise = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * 0.03), this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.12));
    }
    if (this.context.state !== 'running') await this.context.resume();
    return this.context.state;
  }

  setInstrument(instrument) {
    if (!INSTRUMENTS.has(instrument)) throw new Error(`Unknown instrument: ${instrument}`);
    this.instrument = instrument;
  }

  setVolume(volume) {
    if (!Number.isFinite(Number(volume))) return;
    this.volume = clamp(Number(volume), 0, 1);
    if (this.context) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.015);
  }

  noteOn(id, frequency, velocity = 100) {
    if (this.state !== 'running' || !Number.isFinite(frequency) || frequency < 8 || frequency > 20000) return false;
    if (!Number.isFinite(velocity) || velocity <= 0) {
      this.noteOff(id);
      return false;
    }
    if (this.active.has(id)) this.noteOff(id);
    // Include release tails in the cap, so fast repeated notes cannot leak nodes.
    while (this.voices.size >= MAX_VOICES) this._destroy(this.voices.values().next().value);
    const context = this.context;
    const now = context.currentTime;
    const instrument = this.instrument;
    const strength = clamp(velocity, 1, 127) / 127;
    const out = context.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(1, now + 0.004);
    out.connect(this.master);
    const voice = { id, frequency, instrument, out, sources: [], tones: [], nodes: [out], started: now, ending: false, timer: null };
    this.active.set(id, voice);
    this.voices.add(voice);
    if (instrument === 'sine') {
      this._tone(voice, null, 0.2 * strength, null, now);
    } else {
      // Upper notes decay faster; low strings retain their resonant body.
      const decay = clamp(Math.pow(220 / frequency, 0.3), 0.45, 1.9);
      const lifetime = (instrument === 'harpsichord' ? 7 : 12) * decay;
      const amplitude = instrument === 'harpsichord' ? 0.16 * (0.6 + strength * 0.4) : 0.22 * Math.pow(strength, 1.25);
      this._tone(voice, `${instrument}-body`, amplitude, lifetime, now);
      this._tone(voice, `${instrument}-upper`, amplitude * (instrument === 'harpsichord' ? 0.65 : 0.3 + 0.25 * strength), (instrument === 'harpsichord' ? 2.8 : 2.2) * decay, now);
      this._tone(voice, `${instrument}-attack`, amplitude * (instrument === 'harpsichord' ? 0.8 : strength * 0.45), (instrument === 'harpsichord' ? 0.38 : 0.2) * decay, now);
      const transient = context.createBufferSource();
      transient.buffer = this.noise;
      const transientGain = context.createGain();
      transientGain.gain.value = amplitude * (instrument === 'harpsichord' ? 0.09 : 0.035);
      transient.connect(transientGain).connect(out);
      transient.start(now);
      voice.sources.push(transient);
      voice.nodes.push(transientGain);
      // The audio clock guarantees silence even if background-tab timers slow down.
      for (const source of voice.tones) source.stop(now + lifetime + 0.05);
      voice.timer = setTimeout(() => this._destroy(voice), (lifetime + 0.1) * 1000);
    }
    return true;
  }

  noteOff(id) {
    const voice = this.active.get(id);
    if (voice) this._release(voice, voice.instrument === 'piano' ? 0.18 : 0.09);
  }

  retune(id, frequency) {
    const voice = this.active.get(id);
    if (!voice || !Number.isFinite(frequency) || frequency < 8 || frequency > 20000) return;
    voice.frequency = frequency;
    for (const source of voice.tones) source.frequency.setTargetAtTime(frequency, this.context.currentTime, 0.008);
  }

  allOff() {
    for (const voice of [...this.voices]) this._release(voice, 0.035);
  }

  _tone(voice, waveName, amplitude, lifetime, now) {
    const oscillator = this.context.createOscillator();
    oscillator.frequency.value = voice.frequency;
    if (waveName) oscillator.setPeriodicWave(this._wave(waveName));
    else oscillator.type = 'sine';
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(amplitude, now);
    if (lifetime !== null) {
      gain.gain.exponentialRampToValueAtTime(Math.max(amplitude * 0.001, 0.000001), now + lifetime);
      gain.gain.linearRampToValueAtTime(0, now + lifetime + 0.025);
    }
    oscillator.connect(gain).connect(voice.out);
    oscillator.start(now);
    voice.sources.push(oscillator);
    voice.tones.push(oscillator);
    voice.nodes.push(gain);
  }

  _wave(name) {
    if (this.waves.has(name)) return this.waves.get(name);
    const real = new Float32Array(33);
    const imaginary = new Float32Array(33);
    const [instrument, band] = name.split('-');
    let total = 0;
    for (let harmonic = 1; harmonic <= 32; harmonic++) {
      let weight = 0;
      if (band === 'body' && harmonic <= 4) weight = 1 / Math.pow(harmonic, instrument === 'piano' ? 2.1 : 1.35);
      if (band === 'upper' && harmonic >= 2 && harmonic <= 12) weight = 1 / Math.pow(harmonic, instrument === 'piano' ? 1.6 : 1.15);
      if (band === 'attack' && harmonic >= 4) weight = 1 / Math.pow(harmonic, instrument === 'piano' ? 1.4 : 0.9);
      // A pluck away from the middle excites a recognizably uneven spectrum.
      if (instrument === 'harpsichord') weight *= Math.abs(Math.sin(harmonic * Math.PI * 0.23));
      imaginary[harmonic] = weight;
      total += weight;
    }
    for (let harmonic = 1; harmonic <= 32; harmonic++) imaginary[harmonic] /= total || 1;
    const wave = this.context.createPeriodicWave(real, imaginary, { disableNormalization: true });
    this.waves.set(name, wave);
    return wave;
  }

  _release(voice, seconds) {
    if (!this.voices.has(voice)) return;
    const now = this.context.currentTime;
    if (this.active.get(voice.id) === voice) this.active.delete(voice.id);
    voice.ending = true;
    clearTimeout(voice.timer);
    const gain = voice.out.gain;
    if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
    else {
      // Master amplitude is 1 after its four-millisecond attack.
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(clamp((now - voice.started) / 0.004, 0, 1), now);
    }
    gain.linearRampToValueAtTime(0, now + seconds);
    for (const source of voice.sources) {
      try { source.stop(now + seconds + 0.01); } catch { /* Source already ended. */ }
    }
    voice.timer = setTimeout(() => this._destroy(voice), (seconds + 0.035) * 1000);
  }

  _destroy(voice) {
    if (!voice || !this.voices.has(voice)) return;
    clearTimeout(voice.timer);
    if (this.active.get(voice.id) === voice) this.active.delete(voice.id);
    this.voices.delete(voice);
    for (const source of voice.sources) {
      try { source.stop(); } catch { /* Source already ended. */ }
      source.disconnect();
    }
    for (const node of voice.nodes) node.disconnect();
  }
}

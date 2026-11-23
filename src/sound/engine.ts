import { soundDesign as SD, type ChapterKey } from '../config/soundDesign';

export type Body = 'glass' | 'stone';

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** seeded random, so the set of sounds is the same on every visit */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Variant { f0: number; ratios: number[]; levels: number[]; decay: number; click: number; second: number }
interface Live { src: AudioBufferSourceNode; gain: GainNode; end: number }

/**
 * Everything is synthesised. A quiet pad follows the chapter; touches between plates play
 * short glass or stone knocks, pre-rendered once as a set of variants and picked at random
 * (never the same one twice in a row) with a small random re-pitch.
 */
export class SoundEngine {
  private master: GainNode;
  private fx: GainNode;
  private padFilter: BiquadFilterNode;
  private padVoices: { a: OscillatorNode; b: OscillatorNode }[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private chapter: ChapterKey = 'hero';
  private lastNote = -Infinity;
  private lastSwell = -Infinity;
  private recent: number[] = [];
  private live: Live[] = [];
  private variants: Record<Body, Variant[]> = { glass: [], stone: [] };
  private samples: Record<Body, AudioBuffer[]> = { glass: [], stone: [] };
  private preparing: Promise<void> | null = null;
  private lastRing = new Map<number, number>();
  private lastPick: Record<Body, number> = { glass: -1, stone: -1 };
  private noise: AudioBuffer;

  constructor(private ctx: AudioContext) {
    const random = rng(SD.tones.seed);
    for (const body of ['glass', 'stone'] as const) {
      const T = SD.tones[body];
      for (let k = 0; k < T.variants; k++) {
        const u = (k + 0.25 + random() * 0.5) / T.variants;
        this.variants[body].push({
          f0: T.pitch[0] * Math.pow(T.pitch[1] / T.pitch[0], u),
          ratios: T.ratios.map((r, i) => (i === 0 ? 1 : r * (1 + (random() * 2 - 1) * T.jitter))),
          levels: T.levels.map((l, i) => (i === 0 ? l : l * (0.6 + random() * 0.8))),
          decay: T.decay[0] + random() * (T.decay[1] - T.decay[0]),
          click: T.click * (0.7 + random() * 0.6),
          second: random() < T.double ? 0.022 + random() * 0.035 : 0,
        });
      }
    }
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    this.master.connect(limiter).connect(ctx.destination);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(SD.reverb.seconds, SD.reverb.decay);
    const wet = ctx.createGain();
    wet.gain.value = SD.reverb.wet;
    reverb.connect(wet).connect(this.master);
    const ambient = ctx.createGain();
    ambient.gain.value = SD.levels.ambient;
    ambient.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = SD.reverb.ambientSend;
    ambient.connect(send).connect(reverb);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = SD.pad.cutoff;
    this.padFilter.Q.value = 0.6;
    this.padFilter.connect(ambient);
    const breath = ctx.createOscillator();
    breath.frequency.value = SD.pad.breathHz;
    const depth = ctx.createGain();
    depth.gain.value = SD.pad.breathDepth;
    breath.connect(depth).connect(this.padFilter.frequency);
    breath.start();
    this.sources.push(breath);
    const chord = SD.chords.hero;
    chord.forEach((note, i) => {
      const hz = midiToHz(note);
      const tri = ctx.createOscillator();
      tri.type = 'triangle';
      tri.frequency.value = hz;
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = hz;
      saw.detune.value = i % 2 ? 7 : -7;
      const gt = ctx.createGain();
      gt.gain.value = 0.5;
      const gs = ctx.createGain();
      gs.gain.value = 0.16;
      const pan = ctx.createStereoPanner();
      pan.pan.value = SD.pad.spread[i] ?? 0;
      const voice = ctx.createGain();
      voice.gain.value = 0.8;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.031 + i * 0.013;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.2;
      lfo.connect(lfoGain).connect(voice.gain);
      tri.connect(gt).connect(voice);
      saw.connect(gs).connect(voice);
      voice.connect(pan).connect(this.padFilter);
      tri.start();
      saw.start();
      lfo.start();
      this.sources.push(tri, saw, lfo);
      this.padVoices.push({ a: tri, b: saw });
    });
    const sub = ctx.createOscillator();
    sub.frequency.value = midiToHz(chord[0] - 12);
    const subGain = ctx.createGain();
    subGain.gain.value = SD.pad.sub;
    sub.connect(subGain).connect(ambient);
    sub.start();
    this.sources.push(sub);
    this.padVoices.push({ a: sub, b: sub });
    this.noise = this.makeNoise(4);
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = SD.air.centre;
    band.Q.value = 0.5;
    const airGain = ctx.createGain();
    airGain.gain.value = SD.air.level;
    air.connect(band).connect(airGain).connect(ambient);
    air.start();
    this.sources.push(air);
    this.fx = ctx.createGain();
    this.fx.gain.value = SD.levels.fx;
    this.fx.connect(this.master);
    const fxSend = ctx.createGain();
    fxSend.gain.value = SD.reverb.fxSend;
    this.fx.connect(fxSend).connect(reverb);
  }

  fade(to: number, seconds: number, at = this.ctx.currentTime) {
    const g = this.master.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(g.value, at);
    g.linearRampToValueAtTime(to * SD.levels.master, at + seconds);
  }

  setChapter(chapter: ChapterKey, at = this.ctx.currentTime) {
    if (chapter === this.chapter) return;
    this.chapter = chapter;
    const chord = SD.chords[chapter];
    this.padVoices.forEach((v, i) => {
      const hz = midiToHz(i < chord.length ? chord[i] : chord[0] - 12);
      v.a.frequency.setTargetAtTime(hz, at, SD.pad.glide);
      if (v.b !== v.a) v.b.frequency.setTargetAtTime(hz, at, SD.pad.glide);
    });
    if (at - this.lastSwell > 1.2) {
      this.lastSwell = at;
      this.swell(at);
    }
  }

  prepare() {
    this.preparing ??= (async () => {
      for (const body of ['glass', 'stone'] as const) for (const v of this.variants[body]) this.samples[body].push(await this.renderVariant(v));
    })();
    return this.preparing;
  }

  get ready() {
    return this.samples.glass.length === this.variants.glass.length && this.samples.stone.length === this.variants.stone.length;
  }

  /** a touch on plate `index`: returns false when the limiter drops it */
  ring(index: number, body: Body, strength: number, pan = 0, at = this.ctx.currentTime) {
    const L = SD.tones.limit;
    if (!this.ready) return false;
    const last = this.lastRing.get(index) ?? -Infinity;
    if (at - last < L.cooldown || at - this.lastNote < L.minGap) return false;
    this.recent = this.recent.filter((t) => at - t < 1);
    if (this.recent.length >= L.perSecond) return false;
    this.lastRing.set(index, at);
    this.lastNote = at;
    this.recent.push(at);
    const dense = this.recent.filter((t) => at - t < 0.5).length;
    const level = Math.max(0.3, Math.min(1, 0.45 + 0.55 * strength) / (1 + L.densitySoftening * (dense - 1)));
    this.live = this.live.filter((v) => v.end > at);
    while (this.live.length >= L.voices) {
      const old = this.live.shift()!;
      old.gain.gain.cancelScheduledValues(at);
      old.gain.gain.setTargetAtTime(0, at, 0.02);
      try { old.src.stop(at + 0.12); } catch { /* already stopped */ }
    }
    const set = this.samples[body];
    let pick = Math.floor(Math.random() * set.length);
    if (set.length > 1 && pick === this.lastPick[body]) pick = (pick + 1 + Math.floor(Math.random() * (set.length - 1))) % set.length;
    this.lastPick[body] = pick;
    const rate = 1 + (Math.random() * 2 - 1) * SD.tones.detune;
    this.play(set[pick], level, pan + (Math.random() - 0.5) * 0.2, rate, at);
    return true;
  }

  private play(buffer: AudioBuffer, level: number, pan: number, rate: number, at: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = SD.tones.gain * (0.35 + 0.65 * level);
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-0.7, Math.min(0.7, pan * 0.6));
    src.connect(gain).connect(p).connect(this.fx);
    src.start(at);
    src.onended = () => { gain.disconnect(); p.disconnect(); };
    this.live.push({ src, gain, end: at + buffer.duration / rate });
  }

  private async renderVariant(v: Variant) {
    const rate = this.ctx.sampleRate;
    const off = new OfflineAudioContext(1, Math.ceil(rate * (v.second + v.decay + 0.12)), rate);
    this.knock(off, off.destination, v, 1, 0);
    if (v.second) this.knock(off, off.destination, { ...v, f0: v.f0 * 1.012 }, 0.45, v.second);
    return off.startRendering();
  }

  private knock(ctx: BaseAudioContext, dest: AudioNode, v: Variant, level: number, at: number) {
    const out = ctx.createGain();
    out.gain.value = level;
    out.connect(dest);
    const sum = v.levels.reduce((a, b) => a + b, 0);
    v.ratios.forEach((ratio, i) => {
      const hz = v.f0 * ratio;
      if (hz > 16000) return;
      const amp = v.levels[i] / sum;
      const decay = v.decay / Math.pow(i + 1, 0.7);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(amp, at + 0.0015);
      env.gain.exponentialRampToValueAtTime(1e-5, at + decay);
      osc.connect(env).connect(out);
      osc.start(at);
      osc.stop(at + decay + 0.02);
    });
    const click = ctx.createBufferSource();
    click.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(9000, v.f0 * 2.2);
    bp.Q.value = 0.8;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(v.click * 0.5, at);
    cg.gain.exponentialRampToValueAtTime(1e-4, at + 0.012);
    click.connect(bp).connect(cg).connect(out);
    click.start(at, Math.random() * 3, 0.02);
  }

  private swell(at: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(320, at);
    bp.frequency.exponentialRampToValueAtTime(2200, at + 1.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(SD.swell.level, at + 0.7);
    g.gain.linearRampToValueAtTime(0, at + 1.8);
    src.connect(bp).connect(g).connect(this.fx);
    src.start(at, Math.random() * 2, 2);
  }

  private makeNoise(seconds: number) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      a = 0.997 * a + 0.029591 * w;
      b = 0.985 * b + 0.032534 * w;
      c = 0.95 * c + 0.048056 * w;
      d[i] = (a + b + c + w * 0.05) * 2.2;
    }
    return buf;
  }

  private impulse(seconds: number, decay: number) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let s = 0;
      for (let i = 0; i < n; i++) {
        const t = i / this.ctx.sampleRate;
        const smooth = 0.6 - 0.5 * Math.min(1, t / seconds);
        s += smooth * (Math.random() * 2 - 1 - s);
        d[i] = s * Math.exp(-t / decay) * Math.min(1, t / 0.008);
      }
    }
    return buf;
  }

  stopAll() {
    this.sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
  }
}

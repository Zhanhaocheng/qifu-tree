/**
 * 全部音频均由 WebAudio 实时合成（无第三方采样，无授权问题）。
 * - 背景音乐：五声音阶的生成式氛围乐（长音垫底 + 古筝式拨弦 + 回声/混响）
 * - 音效：点击、签到、祈福（铜钟）、福币、错误
 * - 环境声：风声（随风力变化）、夜间虫鸣
 */
import type { ItemId, TerrainId } from '../shared/game';

export type AudioState = 'on' | 'muted' | 'blocked';

const STORAGE_KEY = 'qifu.muted';

const NOTE = (name: string) => {
  const m = /^([A-G])(#?)(\d)$/.exec(name)!;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const semi = base[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * Math.pow(2, (semi - 69) / 12);
};

const CHORDS: string[][] = [
  ['C3', 'G3', 'E4', 'A4'],
  ['A2', 'E3', 'C4', 'G4'],
  ['F2', 'C3', 'A3', 'E4'],
  ['G2', 'D3', 'A3', 'D4'],
];
const SCALE = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6'].map(NOTE);
const LOW_SCALE = ['G3', 'A3', 'C4', 'D4', 'E4', 'G4', 'A4'].map(NOTE);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  terrain: TerrainId = 'mountain';
  private windGain!: GainNode;
  private waterGain!: GainNode;
  private natureTimer: number | null = null;
  private chimeAt = 0;
  private lastAnimal = new Map<string, number>();
  private windFilter!: BiquadFilterNode;
  private reverb!: ConvolverNode;
  private padFilter!: BiquadFilterNode;
  private timer: number | null = null;
  private cricketTimer: number | null = null;
  private nextChordAt = 0;
  private nextNoteAt = 0;
  private chordIndex = 0;
  private night = 0;
  private wind = 0.1;
  muted: boolean;
  private listeners = new Set<(state: AudioState) => void>();
  private lastState: AudioState | null = null;
  private lastTime = -1;
  private stallTicks = 0;
  private stalled = false;
  private unlockFailed = false;
  private welcomed = false;
  private whiteNoise: AudioBuffer | null = null;

  constructor() {
    this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    const gesture = (e: Event) => {
      if (this.muted) return;
      if ((e.target as Element | null)?.closest?.('[data-sound-toggle]')) return;
      this.start();
    };
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) addEventListener(ev, gesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend().catch(() => undefined);
      else this.resumeSilently();
    });
    addEventListener('pageshow', () => this.resumeSilently());
    addEventListener('focus', () => this.resumeSilently());
    try {
      (navigator as unknown as { audioSession?: { type: string } }).audioSession && ((navigator as unknown as { audioSession: { type: string } }).audioSession.type = 'playback');
    } catch {
      /* 不支持则忽略 */
    }
  }

  /** 音频当前的真实状态：on = 正在出声，muted = 用户关闭，blocked = 已开启但浏览器尚未放行 */
  get state(): AudioState {
    if (this.muted) return 'muted';
    return this.ctx && this.ctx.state === 'running' && !this.stalled ? 'on' : 'blocked';
  }

  onStateChange(fn: (state: AudioState) => void) {
    this.listeners.add(fn);
    fn(this.state);
  }

  private emit() {
    const s = this.state;
    if (s === this.lastState) return;
    this.lastState = s;
    this.listeners.forEach((l) => l(s));
  }

  private resumeSilently() {
    if (!this.ctx || this.muted || document.hidden) return;
    if (this.ctx.state !== 'running') void this.ctx.resume().then(() => this.emit(), () => undefined);
    this.emit();
  }

  /** 必须在用户手势内调用才能真正解锁（iOS Safari 需要 touchend/click 内 resume 并播放一段静音） */
  start() {
    if (this.muted) return;
    if (!this.ctx) this.init();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running' && !document.hidden) {
      this.unlockSilently(ctx);
      ctx
        .resume()
        .then(() => {
          this.unlockFailed = ctx.state !== 'running';
          this.afterRunning();
        })
        .catch(() => {
          this.unlockFailed = true;
          this.emit();
        });
    }
    this.afterRunning();
  }

  private unlockSilently(ctx: AudioContext) {
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
  }

  private afterRunning() {
    const ctx = this.ctx;
    if (ctx && ctx.state === 'running') {
      this.stalled = false;
      this.stallTicks = 0;
      this.lastTime = ctx.currentTime;
      if (!this.welcomed) {
        this.welcomed = true;
        const t = ctx.currentTime + 0.05;
        this.bell(t, NOTE('E6'), 0.05, 1.4, this.sfxBus);
        this.bell(t + 0.16, NOTE('A6'), 0.04, 1.6, this.sfxBus);
      }
    }
    this.emit();
  }

  private checkHealth() {
    const ctx = this.ctx;
    if (!ctx || this.muted || document.hidden) return;
    if (ctx.state !== 'running') {
      this.emit();
      return;
    }
    const t = ctx.currentTime;
    if (t === this.lastTime) {
      if (++this.stallTicks >= 3 && !this.stalled) {
        this.stalled = true;
        void ctx.resume().catch(() => undefined);
        this.emit();
      }
    } else {
      this.lastTime = t;
      this.stallTicks = 0;
      if (this.stalled) {
        this.stalled = false;
        this.emit();
      }
    }
  }

  toggleMute() {
    if (!this.muted && this.state !== 'on' && !this.unlockFailed) {
      this.start();
      return;
    }
    this.unlockFailed = false;
    this.muted = !this.muted;
    localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    if (!this.muted) this.start();
    this.applyMute();
    this.emit();
    if (!this.muted) this.click();
  }

  private applyMute() {
    if (!this.ctx) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.15);
  }

  private init() {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    ctx.onstatechange = () => this.afterRunning();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.4);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.55;
    this.reverb.connect(revGain).connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.7;
    this.sfxBus.connect(this.master);
    const sfxSend = ctx.createGain();
    sfxSend.gain.value = 0.35;
    this.sfxBus.connect(sfxSend).connect(this.reverb);

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1400;
    this.padFilter.connect(this.musicBus);

    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    delay.connect(dl).connect(fb).connect(delay);
    dl.connect(this.musicBus);
    this.echoIn = delay;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(4);
    noise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(this.windFilter).connect(this.windGain).connect(this.master);
    noise.start();

    const water = ctx.createBufferSource();
    water.buffer = this.noiseBuffer(5);
    water.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 1400;
    wf.Q.value = 0.9;
    const wf2 = ctx.createBiquadFilter();
    wf2.type = 'highpass';
    wf2.frequency.value = 500;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.25;
    lfo.connect(lfoGain).connect(this.waterGain.gain);
    lfo.start();
    water.connect(wf).connect(wf2).connect(this.waterGain).connect(this.master);
    water.start();

    this.applyMute();
    const now = ctx.currentTime;
    this.nextChordAt = now + 0.2;
    this.nextNoteAt = now + 3;
    this.timer = window.setInterval(() => {
      this.checkHealth();
      this.schedule();
    }, 400);
    this.cricketTimer = window.setInterval(() => this.cricket(), 900);
    this.natureTimer = window.setInterval(() => this.nature(), 1100);
    this.setTerrain(this.terrain);
  }

  private echoIn!: DelayNode;

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private noiseBuffer(seconds: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.04 * w) / 1.04;
      d[i] = last * 3.2;
    }
    return buf;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 1.5;
    while (this.nextChordAt < ahead) {
      this.playChord(this.nextChordAt, CHORDS[this.chordIndex % CHORDS.length]);
      this.chordIndex++;
      this.nextChordAt += 9;
    }
    while (this.nextNoteAt < ahead) {
      const pool = Math.random() < 0.7 ? SCALE : LOW_SCALE;
      const f = pool[Math.floor(Math.random() * pool.length)];
      this.pluck(this.nextNoteAt, f, 0.16 + Math.random() * 0.08);
      if (Math.random() < 0.3) this.pluck(this.nextNoteAt + 0.32, pool[Math.floor(Math.random() * pool.length)], 0.1);
      this.nextNoteAt += 1.6 + Math.random() * 3.2;
    }
  }

  private playChord(at: number, notes: string[]) {
    const ctx = this.ctx!;
    notes.forEach((n, i) => {
      const f = NOTE(n);
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.detune.value = detune;
        const g = ctx.createGain();
        const peak = i === 0 ? 0.11 : 0.05;
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(peak, at + 3);
        g.gain.setValueAtTime(peak, at + 6);
        g.gain.linearRampToValueAtTime(0, at + 10.5);
        o.connect(g).connect(this.padFilter);
        o.start(at);
        o.stop(at + 11);
      }
    });
  }

  private pluck(at: number, freq: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.4);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.musicBus);
    g.connect(this.echoIn);
    o.start(at);
    o2.start(at);
    o.stop(at + 2.6);
    o2.stop(at + 2.6);
  }

  private bell(at: number, freq: number, vol: number, dur: number, bus: AudioNode) {
    const ctx = this.ctx!;
    const partials: [number, number][] = [
      [1, 1],
      [2.01, 0.5],
      [2.76, 0.35],
      [5.4, 0.18],
      [8.9, 0.08],
    ];
    for (const [ratio, amp] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol * amp, at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur / Math.sqrt(ratio));
      o.connect(g).connect(bus);
      o.start(at);
      o.stop(at + dur + 0.1);
    }
  }

  private cricket() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    if (this.terrain === 'snow' || this.terrain === 'desert') return;
    if (Math.random() > this.night * 0.9) return;
    const base = ctx.currentTime + 0.02;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.master);
    const f = 4200 + Math.random() * 500;
    const pulses = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pulses; i++) {
      const t = base + i * 0.075;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.018 * this.night, t + 0.012);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.07);
    }
  }

  /** 每帧调用，让环境声跟随场景 */
  setEnvironment(wind: number, night: number) {
    this.wind = wind;
    this.night = night;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const boost = this.terrain === 'desert' ? 1.3 : this.terrain === 'snow' ? 1.5 : this.terrain === 'mountain' ? 1.2 : 1;
    this.windGain.gain.setTargetAtTime((0.015 + wind * 0.32) * boost, t, 0.3);
    const base = this.terrain === 'desert' ? 420 : this.terrain === 'snow' ? 240 : 280;
    this.windFilter.frequency.setTargetAtTime(base + wind * 900, t, 0.3);
    this.padFilter.frequency.setTargetAtTime(1500 - night * 700, t, 2);
  }

  setTerrain(id: TerrainId) {
    this.terrain = id;
    if (!this.ctx) return;
    const level = id === 'bamboo' ? 0.085 : id === 'jiangnan' ? 0.03 : 0;
    this.waterGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.6);
  }

  /** 白天鸟鸣、夜晚蛙鸣、风铃 */
  private nature() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    const day = 1 - this.night;
    const t = ctx.currentTime;
    const t0 = this.terrain;
    if (day > 0.4 && t0 !== 'desert' && t0 !== 'snow' && Math.random() < 0.28 * day) this.chirp(t + Math.random() * 0.4, 0.5 + Math.random() * 0.5);
    if (this.night > 0.5 && (t0 === 'bamboo' || t0 === 'jiangnan') && Math.random() < 0.3) this.frog(t + Math.random() * 0.5);
    if (t > this.chimeAt && (this.wind > 0.28 || Math.random() < 0.05)) {
      this.chimeAt = t + 14 + Math.random() * 20;
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this.bell(t + i * (0.12 + Math.random() * 0.25), NOTE(['G6', 'A6', 'C7', 'D7', 'E6'][Math.floor(Math.random() * 5)]), 0.03, 1.6, this.sfxBus);
    }
  }

  private chirp(at: number, vol: number) {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.master);
    const pulses = 2 + Math.floor(Math.random() * 4);
    const f0 = 2400 + Math.random() * 1600;
    for (let i = 0; i < pulses; i++) {
      const t = at + i * 0.11;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0 * (1 + Math.random() * 0.2), t);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.35 + Math.random() * 0.3), t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.028 * vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  private frog(at: number) {
    const ctx = this.ctx!;
    const n = 2 + Math.floor(Math.random() * 3);
    const f = 260 + Math.random() * 120;
    for (let i = 0; i < n; i++) {
      const t = at + i * 0.16;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.8, t + 0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 700;
      bp.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(bp).connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.15);
    }
  }

  /** 场景中动物发声：距离越远越轻 */
  animal(kind: 'bird' | 'crane' | 'deer' | 'crow' | 'bell' | 'rabbit', dist: number, dx: number) {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - (this.lastAnimal.get(kind) ?? -99) < 3) return;
    this.lastAnimal.set(kind, now);
    const vol = Math.max(0.12, 1 - dist / 90);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, dx / 30));
    pan.connect(this.master);
    const voice = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number, bpF = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, now);
      o.frequency.exponentialRampToValueAtTime(f1, now + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(peak * vol, now + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      let node: AudioNode = o;
      if (bpF) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = bpF;
        bp.Q.value = 2.5;
        o.connect(bp);
        node = bp;
      }
      node.connect(g).connect(pan);
      o.start(now);
      o.stop(now + dur + 0.05);
    };
    if (kind === 'bird') this.chirp(now, vol);
    else if (kind === 'crane') {
      voice('sawtooth', 900, 1500, 0.5, 0.05, 1300);
      setTimeout(() => this.ctx && this.ready() && voice('sawtooth', 1100, 1700, 0.6, 0.045, 1400), 520);
    } else if (kind === 'deer') voice('sawtooth', 260, 180, 0.22, 0.07, 500);
    else if (kind === 'crow') {
      for (let i = 0; i < 2; i++) setTimeout(() => this.ready() && voice('sawtooth', 520, 300, 0.22, 0.05, 900), i * 300);
    } else if (kind === 'bell') {
      this.bell(now, NOTE('E6'), 0.05 * vol, 1.1, pan);
      this.bell(now + 0.18, NOTE('D6'), 0.045 * vol, 1.1, pan);
    }
  }

  private ready() {
    return this.ctx && this.ctx.state === 'running' && !this.muted ? this.ctx : null;
  }

  click() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(760, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.15);
  }

  checkin() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    ['C5', 'E5', 'G5', 'A5', 'C6'].forEach((n, i) => this.bell(t + i * 0.11, NOTE(n), 0.14, 1.8, this.sfxBus));
  }

  pray(item?: ItemId) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.bell(t, NOTE('A3'), 0.34, 5, this.sfxBus);
    this.bell(t + 0.9, NOTE('E5'), 0.1, 3, this.sfxBus);
    this.bell(t + 1.15, NOTE('A5'), 0.08, 3, this.sfxBus);
    if (item) this.itemLayer(ctx, item, t);
  }

  private white() {
    if (!this.whiteNoise) {
      const ctx = this.ctx!;
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.whiteNoise = buf;
    }
    return this.whiteNoise;
  }

  private noiseHit(at: number, dur: number, vol: number, f0: number, f1: number, q: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.white();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.05);
  }

  private tone(at: number, freq: number, dur: number, vol: number, type: OscillatorType, cutoff = 0, glideTo = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.05, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let node: AudioNode = o;
    if (cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      o.connect(lp);
      node = lp;
    }
    node.connect(g).connect(this.sfxBus);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  private coinClink(at: number, vol: number) {
    const f = NOTE(['E7', 'G7', 'A6', 'C7'][Math.floor(Math.random() * 4)]);
    this.bell(at, f, vol, 0.55, this.sfxBus);
    this.noiseHit(at, 0.05, vol * 0.7, 7000, 5000, 4, 'highpass');
  }

  private itemLayer(ctx: AudioContext, item: ItemId, t: number) {
    void ctx;
    if (item === 'wood') {
      this.tone(t, 180, 0.16, 0.3, 'triangle', 600, 90);
      this.noiseHit(t, 0.07, 0.25, 900, 400, 1.2);
      this.tone(t + 0.2, 150, 0.14, 0.2, 'triangle', 500, 80);
    } else if (item === 'ribbon') {
      this.noiseHit(t, 0.7, 0.13, 600, 5200, 0.8);
      this.noiseHit(t + 0.5, 0.5, 0.08, 4200, 1500, 1.2);
      ['E5', 'G5', 'A5'].forEach((n, i) => this.bell(t + 0.7 + i * 0.1, NOTE(n), 0.07, 1.6, this.sfxBus));
    } else if (item === 'gold') {
      for (let i = 0; i < 5; i++) this.coinClink(t + i * 0.07, 0.07);
      ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => this.bell(t + 0.25 + i * 0.09, NOTE(n), 0.1, 2, this.sfxBus));
    } else if (item === 'lantern') {
      this.noiseHit(t, 0.9, 0.1, 300, 1800, 1, 'lowpass');
      this.tone(t, 220, 1.1, 0.12, 'sine', 0, 440);
      ['D5', 'A5', 'D6', 'F6'].forEach((n, i) => this.bell(t + 0.5 + i * 0.16, NOTE(n), 0.09, 2.6, this.sfxBus));
    } else {
      ['A4', 'C5', 'E5', 'A5', 'C6', 'E6', 'A6'].forEach((n, i) => this.pluckSfx(t + i * 0.09, NOTE(n), 0.11));
      [0, 4, 7].forEach((st) => this.tone(t + 0.6, NOTE('A3') * Math.pow(2, st / 12), 2.6, 0.07, 'sine'));
      this.bell(t + 0.7, NOTE('E7'), 0.05, 3, this.sfxBus);
    }
  }

  private pluckSfx(at: number, freq: number, vol: number) {
    this.tone(at, freq, 1.4, vol, 'triangle');
    this.tone(at, freq * 2, 0.8, vol * 0.3, 'sine');
  }

  /** 支付成功：金币叮当 + 上行钟琴 + 收尾和弦，金额越大越丰盛 */
  payment(coins = 60) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const n = Math.min(10, 3 + Math.floor(coins / 60));
    for (let i = 0; i < n; i++) this.coinClink(t + i * 0.055, 0.06 + Math.random() * 0.03);
    const notes = coins >= 1000 ? ['C5', 'E5', 'G5', 'C6', 'E6', 'G6', 'C7'] : coins >= 300 ? ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'] : ['E5', 'G5', 'C6', 'E6'];
    notes.forEach((nn, i) => this.bell(t + 0.2 + i * 0.085, NOTE(nn), 0.13, 1.8, this.sfxBus));
    const end = t + 0.25 + notes.length * 0.085;
    [NOTE('C6'), NOTE('E6'), NOTE('G6')].forEach((f) => this.bell(end, f, 0.07, 2.6, this.sfxBus));
    this.bell(t, NOTE('A4'), 0.12, 1.2, this.sfxBus);
  }

  /** 解锁地形：铜管式号角 + 钟琴闪烁 + 低沉锣声 */
  terrainUnlock() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    this.bell(t, NOTE('A2'), 0.3, 5, this.sfxBus);
    const brass = (at: number, notes: string[], dur: number, vol: number) =>
      notes.forEach((n) => {
        const f = NOTE(n);
        this.tone(at, f, dur, vol, 'sawtooth', 1700);
        this.tone(at, f * 1.004, dur, vol * 0.7, 'square', 1100);
      });
    brass(t, ['G3', 'D4'], 0.28, 0.05);
    brass(t + 0.2, ['C4', 'G4'], 0.28, 0.05);
    brass(t + 0.4, ['E4', 'C5'], 0.28, 0.055);
    brass(t + 0.62, ['C4', 'G4', 'C5', 'E5'], 1.8, 0.06);
    ['C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'E7'].forEach((n, i) => this.bell(t + 0.62 + i * 0.07, NOTE(n), 0.1, 2.4, this.sfxBus));
    this.noiseHit(t + 0.6, 1.2, 0.05, 3000, 9000, 0.6, 'highpass');
  }

  coin() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.bell(t, NOTE('E6'), 0.09, 0.9, this.sfxBus);
    this.bell(t + 0.09, NOTE('A6'), 0.09, 1.2, this.sfxBus);
  }

  error() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.3);
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    if (this.cricketTimer) clearInterval(this.cricketTimer);
    if (this.natureTimer) clearInterval(this.natureTimer);
    void this.wind;
  }
}

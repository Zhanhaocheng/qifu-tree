/**
 * 全部音频均由 WebAudio 实时合成（无第三方采样，无授权问题）。
 * - 背景音乐：五声音阶的生成式氛围乐（长音垫底 + 古筝式拨弦 + 回声/混响）
 * - 音效：点击、签到、祈福（铜钟）、福币、错误
 * - 环境声：风声（随风力变化）、夜间虫鸣
 */
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
  private windGain!: GainNode;
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
  private listeners = new Set<(muted: boolean) => void>();

  constructor() {
    this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    const kick = () => {
      this.start();
      if (this.ctx?.state === 'running') {
        removeEventListener('pointerdown', kick);
        removeEventListener('keydown', kick);
      }
    };
    addEventListener('pointerdown', kick);
    addEventListener('keydown', kick);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else if (!this.muted) this.ctx.resume();
    });
  }

  onMuteChange(fn: (muted: boolean) => void) {
    this.listeners.add(fn);
    fn(this.muted);
  }

  start() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    this.start();
    this.applyMute();
    this.listeners.forEach((l) => l(this.muted));
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

    this.applyMute();
    const now = ctx.currentTime;
    this.nextChordAt = now + 0.2;
    this.nextNoteAt = now + 3;
    this.timer = window.setInterval(() => this.schedule(), 400);
    this.cricketTimer = window.setInterval(() => this.cricket(), 900);
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
    this.windGain.gain.setTargetAtTime(0.015 + wind * 0.32, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(280 + wind * 900, t, 0.3);
    this.padFilter.frequency.setTargetAtTime(1500 - night * 700, t, 2);
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

  pray() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.bell(t, NOTE('A3'), 0.34, 5, this.sfxBus);
    this.bell(t + 0.9, NOTE('E5'), 0.1, 3, this.sfxBus);
    this.bell(t + 1.15, NOTE('A5'), 0.08, 3, this.sfxBus);
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
    void this.wind;
  }
}

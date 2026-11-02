// 音效全部以 Web Audio 即時合成：免授權、免下載、檔案體積為零。
// 若 public/audio/<name>.mp3 存在，會優先播放該檔案（可替換為 CC0 音效）。
import type { Category } from '../sim/types';

export type SfxName = Category | 'click' | 'major' | 'resolve' | 'divine' | 'warn' | 'ending' | 'news' | 'start' | 'tick';

const FILE_SFX: SfxName[] = ['click', 'major', 'resolve', 'divine', 'warn', 'ending', 'news', 'start', 'tick',
  'disaster', 'strait', 'politics', 'public', 'intl', 'economy'];

class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private files = new Map<string, AudioBuffer>();
  private noise!: AudioBuffer;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem('tgh-muted') === '1'; } catch { /* 無痕模式 */ }
  }

  /** 必須在使用者手勢中呼叫 */
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.7; this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0; this.ambBus.connect(this.master);
    // 棕噪音
    const len = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    this.startAmbient();
    for (const n of FILE_SFX) void this.tryLoad(n);
  }

  private async tryLoad(name: string) {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}audio/${name}.mp3`);
      if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('audio')) return;
      this.files.set(name, await this.ctx!.decodeAudioData(await r.arrayBuffer()));
    } catch { /* 沒有檔案就用合成音 */ }
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem('tgh-muted', m ? '1' : '0'); } catch { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  /** 環境音：海浪（濾波棕噪音＋慢速 LFO）與低沉和聲 */
  private startAmbient() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.35;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.2;
    lfo.connect(lfoG).connect(g.gain);
    src.connect(lp).connect(g).connect(this.ambBus);
    src.start(); lfo.start();
    for (const [f, det] of [[110, 0], [164.8, 4], [220, -3]] as const) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = 0.025;
      const ol = ctx.createOscillator(); ol.frequency.value = 0.05 + f / 5000;
      const olg = ctx.createGain(); olg.gain.value = 0.015;
      ol.connect(olg).connect(og.gain);
      o.connect(og).connect(this.ambBus);
      o.start(); ol.start();
    }
  }

  ambient(level: number) {
    if (this.ctx) this.ambBus.gain.setTargetAtTime(level, this.ctx.currentTime, 1.5);
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; glide?: number; attack?: number } = {}) {
    const ctx = this.ctx!, t = ctx.currentTime + (opts.at ?? 0);
    const o = ctx.createOscillator(); o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.glide) o.frequency.exponentialRampToValueAtTime(opts.glide, t + dur);
    const g = ctx.createGain();
    const a = opts.attack ?? 0.008;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.2, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private noiseBurst(dur: number, freq: number, opts: { gain?: number; at?: number; type?: BiquadFilterType; q?: number; attack?: number } = {}) {
    const ctx = this.ctx!, t = ctx.currentTime + (opts.at ?? 0);
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = opts.type ?? 'lowpass'; f.frequency.value = freq; f.Q.value = opts.q ?? 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.4, t + (opts.attack ?? 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }

  play(name: SfxName) {
    if (!this.ctx || this.muted) return;
    const file = this.files.get(name);
    if (file) {
      const s = this.ctx.createBufferSource(); s.buffer = file; s.connect(this.sfxBus); s.start();
      return;
    }
    switch (name) {
      case 'click': this.tone(880, 0.06, { gain: 0.08, type: 'triangle' }); break;
      case 'tick': // 時鐘滴答
        this.noiseBurst(0.035, 3200, { gain: 0.25, type: 'highpass', attack: 0.002 });
        this.tone(1900, 0.03, { gain: 0.05, type: 'triangle' });
        break;
      case 'news': this.tone(1320, 0.12, { gain: 0.03 }); this.tone(1760, 0.1, { gain: 0.02, at: 0.06 }); break;
      case 'start':
        [261.6, 329.6, 392, 523.3].forEach((f, i) => this.tone(f, 1.6, { gain: 0.08, at: i * 0.12, attack: 0.05 }));
        break;
      case 'disaster':
        this.noiseBurst(1.4, 160, { gain: 0.9, attack: 0.05 });
        this.tone(55, 1.2, { gain: 0.35, glide: 38 });
        break;
      case 'strait':
        for (let i = 0; i < 2; i++) { this.tone(740, 0.18, { type: 'square', gain: 0.05, at: i * 0.4 }); this.tone(587, 0.18, { type: 'square', gain: 0.05, at: i * 0.4 + 0.2 }); }
        break;
      case 'politics':
        this.tone(392, 1.2, { gain: 0.12, type: 'sine' }); this.tone(392 * 2.76, 0.6, { gain: 0.04 });
        break;
      case 'public':
        this.noiseBurst(1.2, 900, { gain: 0.35, type: 'bandpass', q: 0.8, attack: 0.4 });
        this.tone(330, 0.5, { gain: 0.05, type: 'triangle', at: 0.1 });
        break;
      case 'intl':
        [659.3, 880, 1174.7].forEach((f, i) => this.tone(f, 0.5, { gain: 0.07, at: i * 0.09 }));
        break;
      case 'economy':
        this.tone(1568, 0.25, { gain: 0.07, type: 'triangle' }); this.tone(2093, 0.35, { gain: 0.05, at: 0.08, type: 'triangle' });
        break;
      case 'major':
        this.tone(98, 3, { gain: 0.3, attack: 0.02 }); this.tone(146.8, 2.5, { gain: 0.12, attack: 0.05 });
        this.noiseBurst(1.5, 300, { gain: 0.25 });
        break;
      case 'resolve': this.tone(523.3, 0.3, { gain: 0.07 }); this.tone(784, 0.4, { gain: 0.06, at: 0.08 }); break;
      case 'divine': this.tone(1046.5, 0.5, { gain: 0.04 }); this.tone(1568, 0.6, { gain: 0.03, at: 0.07 }); break;
      case 'warn': this.tone(220, 0.35, { type: 'sawtooth', gain: 0.05 }); this.tone(207.7, 0.35, { type: 'sawtooth', gain: 0.05, at: 0.35 }); break;
      case 'ending':
        [196, 246.9, 293.7, 392].forEach((f, i) => this.tone(f, 4, { gain: 0.08, at: i * 0.25, attack: 0.3 }));
        break;
    }
  }
}

export const sfx = new Sfx();

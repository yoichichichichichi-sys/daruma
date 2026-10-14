// 再生エンジン: Web Audio の簡易シンセ＋先読みスケジューラ。
// Web MIDI 出力を選ぶと、Logic / Ableton / Cubase などの外部 DAW をこのアプリから鳴らせる。

import { BEATS_PER_BAR } from "./theory.js";
import { DRUM } from "./generate.js";

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12; // 秒

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Engine {
  constructor(getProject) {
    this.getProject = getProject;
    this.ctx = null;
    this.playing = false;
    this.timer = null;
    this.onPosition = null; // (beat) => void
    this.midiOut = null; // MIDIOutput
    this.useInternalSynth = true;
    this.metronome = false;
    this.trackBuses = new Map();
    this.noiseBuffer = null;
  }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    // 簡易リバーブ（ノイズのインパルス応答）
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.2);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0.25;
    this.reverbSend.connect(this.reverb).connect(this.master);
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  makeImpulse(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  bus(track) {
    let b = this.trackBuses.get(track.id);
    if (!b) {
      const gain = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (pan) gain.connect(pan).connect(this.master);
      else gain.connect(this.master);
      const send = this.ctx.createGain();
      gain.connect(send).connect(this.reverbSend);
      b = { gain, pan, send };
      this.trackBuses.set(track.id, b);
    }
    b.gain.gain.value = track.volume;
    if (b.pan) b.pan.pan.value = track.pan || 0;
    b.send.gain.value = { pad: 0.9, strings: 0.8, epiano: 0.5, piano: 0.4, lead: 0.4, pluck: 0.5, bass: 0.05, drums: 0.15 }[track.instrument] ?? 0.3;
    return b.gain;
  }

  isPlaying() {
    return this.playing;
  }

  secondsPerBeat() {
    return 60 / this.getProject().bpm;
  }

  /** 再生開始。fromBeat を省略するとループ開始位置（ループ無効なら曲頭）から */
  async play(fromBeat) {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") await ctx.resume();
    if (this.playing) this.stop();
    const p = this.getProject();
    const startBeat = fromBeat ?? (p.loop.enabled ? p.loop.startBar * BEATS_PER_BAR : 0);
    this.playing = true;
    this.anchorTime = ctx.currentTime + 0.05;
    this.anchorBeat = startBeat;
    this.anchorBpm = p.bpm;
    this.scheduledUntil = startBeat;
    this.tick();
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS);
    const loop = () => {
      if (!this.playing) return;
      this.onPosition?.(this.currentBeat());
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    if (this.midiOut) {
      // 全チャンネル All Notes Off
      for (let ch = 0; ch < 16; ch++) this.midiOut.send([0xb0 | ch, 123, 0]);
    }
    this.onPosition?.(null);
  }

  /** 再生中の現在位置（拍）。ループを考慮 */
  currentBeat() {
    const p = this.getProject();
    const raw = this.anchorBeat + (this.ctx.currentTime - this.anchorTime) / this.secondsPerBeat();
    return this.wrap(raw, p);
  }

  loopBounds(p) {
    if (p.loop.enabled) return [p.loop.startBar * BEATS_PER_BAR, p.loop.endBar * BEATS_PER_BAR];
    return [0, p.bars * BEATS_PER_BAR];
  }

  wrap(beat, p) {
    const [s, e] = this.loopBounds(p);
    if (!p.loop.enabled) return beat;
    if (beat < e) return beat;
    return s + ((beat - s) % (e - s));
  }

  tick() {
    const p = this.getProject();
    if (p.bpm !== this.anchorBpm) {
      // 再生中のテンポ変更: 今の位置を基準に時間軸を張り直す
      const now = this.ctx.currentTime;
      this.anchorBeat += (now - this.anchorTime) / (60 / this.anchorBpm);
      this.anchorTime = now;
      this.anchorBpm = p.bpm;
    }
    const spb = this.secondsPerBeat();
    const horizon = this.anchorBeat + (this.ctx.currentTime + SCHEDULE_AHEAD - this.anchorTime) / spb;
    const [loopStart, loopEnd] = this.loopBounds(p);
    while (this.scheduledUntil < horizon) {
      // 「仮想的な連続時間」上の窓 [from, to) を、ループで折り返した実位置に写す
      const from = this.scheduledUntil;
      const to = Math.min(horizon, from + 1);
      const wrappedFrom = this.wrap(from, p);
      const segEnd = Math.min(to, from + (loopEnd - wrappedFrom));
      if (!p.loop.enabled && wrappedFrom >= loopEnd) {
        // 曲の終わりで停止
        setTimeout(() => this.stop(), (from - this.anchorBeat) * spb * 1000 - (this.ctx.currentTime - this.anchorTime) * 1000);
        clearInterval(this.timer);
        return;
      }
      this.scheduleWindow(p, wrappedFrom, wrappedFrom + (segEnd - from), from - wrappedFrom);
      this.scheduledUntil = segEnd;
    }
  }

  /** 実位置 [from, to) のノートを、オフセット offset（仮想時間 - 実位置）付きで予約 */
  scheduleWindow(p, from, to, offset) {
    const spb = this.secondsPerBeat();
    const anySolo = p.tracks.some((t) => t.solo);
    const timeOf = (beat) => this.anchorTime + (beat + offset - this.anchorBeat) * spb;
    for (const t of p.tracks) {
      if (t.mute || (anySolo && !t.solo)) continue;
      for (const n of t.notes) {
        if (n.start >= from - 1e-9 && n.start < to - 1e-9) {
          const when = timeOf(n.start);
          const dur = n.duration * spb;
          if (this.useInternalSynth) this.playNote(t, n.pitch, n.velocity, when, dur);
          if (this.midiOut) this.sendMidi(p, t, n, when, dur);
        }
      }
    }
    if (this.metronome) {
      for (let b = Math.ceil(from - 1e-9); b < to - 1e-9; b++) this.click(timeOf(b), b % BEATS_PER_BAR === 0);
    }
  }

  sendMidi(p, track, n, when, dur) {
    const idx = p.tracks.filter((t) => t.instrument !== "drums").indexOf(track);
    const ch = track.instrument === "drums" ? 9 : [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15][Math.max(0, idx) % 15];
    const toPerf = (t) => performance.now() + (t - this.ctx.currentTime) * 1000;
    this.midiOut.send([0x90 | ch, n.pitch, n.velocity], toPerf(when));
    this.midiOut.send([0x80 | ch, n.pitch, 0], toPerf(when + dur * 0.98));
  }

  /** プレビュー用に単音を鳴らす（ピアノロールのクリック時など） */
  async preview(track, pitch, velocity = 90) {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") await ctx.resume();
    this.playNote(track, pitch, velocity, ctx.currentTime + 0.01, 0.4);
  }

  click(when, accent) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(0.3, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    o.connect(g).connect(this.master);
    o.start(when);
    o.stop(when + 0.06);
  }

  playNote(track, pitch, velocity, when, dur) {
    const out = this.bus(track);
    const v = (velocity / 127) * 0.5;
    if (track.instrument === "drums") return this.playDrum(out, pitch, v * 1.6, when);
    const voice = VOICES[track.instrument] || VOICES.piano;
    voice(this.ctx, out, mtof(pitch), v, when, dur);
  }

  playDrum(out, pitch, v, when) {
    const ctx = this.ctx;
    const noise = (filterType, freq, decay, gainVal) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gainVal, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + decay);
      src.connect(f).connect(g).connect(out);
      src.start(when);
      src.stop(when + decay + 0.02);
    };
    const tone = (f0, f1, decay, gainVal, type = "sine") => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      o.frequency.setValueAtTime(f0, when);
      o.frequency.exponentialRampToValueAtTime(f1, when + decay * 0.6);
      g.gain.setValueAtTime(gainVal, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + decay);
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + decay + 0.02);
    };
    switch (pitch) {
      case DRUM.kick:
      case 35:
        tone(150, 42, 0.45, v * 1.6);
        break;
      case DRUM.snare:
      case 40:
        tone(220, 160, 0.12, v * 0.6, "triangle");
        noise("highpass", 1500, 0.2, v * 0.8);
        break;
      case DRUM.clap:
        for (let i = 0; i < 3; i++) {
          const t = when + i * 0.012;
          const src = ctx.createBufferSource();
          src.buffer = this.noiseBuffer;
          const f = ctx.createBiquadFilter();
          f.type = "bandpass";
          f.frequency.value = 1200;
          const g = ctx.createGain();
          g.gain.setValueAtTime(v * 0.9, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + (i === 2 ? 0.18 : 0.02));
          src.connect(f).connect(g).connect(out);
          src.start(t);
          src.stop(t + 0.2);
        }
        break;
      case DRUM.hatClosed:
      case 44:
        noise("highpass", 7000, 0.05, v * 0.45);
        break;
      case DRUM.hatOpen:
        noise("highpass", 6500, 0.3, v * 0.4);
        break;
      case DRUM.crash:
      case DRUM.ride:
      case 57:
        noise("highpass", 5000, pitch === DRUM.ride ? 0.4 : 1.4, v * 0.45);
        break;
      default: {
        // タム
        const f = pitch >= 48 ? 200 : pitch >= 45 ? 140 : 100;
        tone(f, f * 0.6, 0.3, v * 1.1);
      }
    }
  }
}

// ---- 音色 ----
function env(g, when, dur, { a = 0.005, d = 0.2, s = 0.6, r = 0.15, peak = 1 } = {}) {
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + a);
  g.gain.setTargetAtTime(peak * s, when + a, d / 3);
  const end = when + Math.max(dur, a);
  g.gain.cancelScheduledValues(end);
  g.gain.setTargetAtTime(0.0001, end, r / 3);
  return end + r + 0.05;
}

function osc(ctx, type, freq, when, stopAt, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.start(when);
  o.stop(stopAt);
  return o;
}

const VOICES = {
  piano(ctx, out, f, v, when, dur) {
    const g = ctx.createGain();
    const stop = env(g, when, Math.min(dur, 2.5), { a: 0.003, d: 1.2, s: 0.25, r: 0.3, peak: v });
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(Math.min(9000, f * 8), when);
    lp.frequency.exponentialRampToValueAtTime(Math.max(400, f * 2), when + 1.2);
    osc(ctx, "triangle", f, when, stop).connect(lp);
    const h = ctx.createGain();
    h.gain.value = 0.25;
    osc(ctx, "sine", f * 2, when, stop).connect(h).connect(lp);
    lp.connect(g).connect(out);
  },
  epiano(ctx, out, f, v, when, dur) {
    // 簡易 FM（ベル的な倍音）
    const g = ctx.createGain();
    const stop = env(g, when, dur, { a: 0.004, d: 1.5, s: 0.35, r: 0.4, peak: v });
    const car = osc(ctx, "sine", f, when, stop);
    const mod = osc(ctx, "sine", f * 1, when, stop);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.2, when);
    mg.gain.exponentialRampToValueAtTime(f * 0.1, when + 0.8);
    mod.connect(mg).connect(car.frequency);
    car.connect(g).connect(out);
  },
  pad(ctx, out, f, v, when, dur) {
    const g = ctx.createGain();
    const stop = env(g, when, dur, { a: 0.4, d: 0.5, s: 0.8, r: 0.8, peak: v * 0.55 });
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(4000, f * 4);
    lp.Q.value = 0.7;
    for (const dt of [-8, 0, 8]) osc(ctx, "sawtooth", f, when, stop, dt).connect(lp);
    lp.connect(g).connect(out);
  },
  strings(ctx, out, f, v, when, dur) {
    const g = ctx.createGain();
    const stop = env(g, when, dur, { a: 0.18, d: 0.3, s: 0.85, r: 0.5, peak: v * 0.5 });
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(5000, f * 5);
    const vib = osc(ctx, "sine", 5.2, when, stop);
    const vg = ctx.createGain();
    vg.gain.value = 6;
    vib.connect(vg);
    for (const dt of [-5, 5]) {
      const o = osc(ctx, "sawtooth", f, when, stop, dt);
      vg.connect(o.detune);
      o.connect(lp);
    }
    lp.connect(g).connect(out);
  },
  pluck(ctx, out, f, v, when, dur) {
    const g = ctx.createGain();
    const stop = env(g, when, Math.min(dur, 0.8), { a: 0.002, d: 0.35, s: 0.1, r: 0.15, peak: v });
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(Math.min(8000, f * 10), when);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.5), when + 0.3);
    osc(ctx, "square", f, when, stop).connect(lp);
    lp.connect(g).connect(out);
  },
  lead(ctx, out, f, v, when, dur) {
    const g = ctx.createGain();
    const stop = env(g, when, dur, { a: 0.01, d: 0.2, s: 0.7, r: 0.12, peak: v * 0.6 });
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(6000, f * 6);
    lp.Q.value = 2;
    osc(ctx, "sawtooth", f, when, stop, -4).connect(lp);
    osc(ctx, "square", f, when, stop, 4).connect(lp);
    lp.connect(g).connect(out);
  },
  bass(ctx, out, f, v, when, dur) {
    const g = ctx.createGain();
    const stop = env(g, when, dur, { a: 0.004, d: 0.25, s: 0.7, r: 0.06, peak: v * 1.1 });
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(f * 8, when);
    lp.frequency.exponentialRampToValueAtTime(f * 2.5, when + 0.2);
    lp.Q.value = 3;
    osc(ctx, "sawtooth", f, when, stop).connect(lp);
    const sub = ctx.createGain();
    sub.gain.value = 0.6;
    osc(ctx, "sine", f, when, stop).connect(sub).connect(g);
    lp.connect(g).connect(out);
  },
};

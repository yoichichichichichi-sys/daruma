// 作曲アシスタントのフレーズ生成: コードのボイシング、メロディ、ベース、ドラム。
// すべて { pitch, start, duration, velocity } （時間は拍）の配列を返す純粋関数。

import { BEATS_PER_BAR, parseChord, chordPcs, scalePcs, mod, rng, pick } from "./theory.js";

export const DRUM = { kick: 36, snare: 38, clap: 39, hatClosed: 42, hatOpen: 46, crash: 49, ride: 51, tomLow: 45, tomHigh: 50 };

/**
 * 小節ごとのコード表 [{bar, symbol}] から、指定小節に鳴っているコードを返す
 * （同じ小節に複数ある場合は beat も見る）
 */
export function chordAt(chords, beat) {
  let current = null;
  for (const c of chords) {
    const start = c.bar * BEATS_PER_BAR + (c.beat || 0);
    if (start <= beat + 1e-6) current = c;
    else break;
  }
  return current;
}

export function sortChords(chords) {
  return [...chords].sort((a, b) => a.bar * BEATS_PER_BAR + (a.beat || 0) - (b.bar * BEATS_PER_BAR + (b.beat || 0)));
}

/** コード進行（記号の配列）を chords 表に展開 */
export function layoutChords(symbols, { startBar = 0, barsPerChord = 1 } = {}) {
  const out = [];
  symbols.forEach((symbol, i) => {
    const pos = startBar + i * barsPerChord;
    out.push({ bar: Math.floor(pos), beat: (pos % 1) * BEATS_PER_BAR, symbol, length: barsPerChord * BEATS_PER_BAR });
  });
  return out;
}

/**
 * ボイスリーディングを考えたクローズボイシング。
 * 前のボイシングとの移動量が最小になる転回形を選ぶ。
 */
export function voiceChord(symbol, prev = null, center = 64) {
  const c = parseChord(symbol);
  if (!c) return [];
  const pcs = c.intervals.slice(0, 4).map((i) => mod(c.root + i, 12));
  const candidates = [];
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let baseOct = 3; baseOct <= 5; baseOct++) {
      const notes = [];
      let last = -Infinity;
      for (const pc of order) {
        let n = (baseOct + 1) * 12 + pc;
        while (n <= last) n += 12;
        notes.push(n);
        last = n;
      }
      candidates.push(notes);
    }
  }
  const cost = (notes) => {
    const avg = notes.reduce((a, b) => a + b, 0) / notes.length;
    let k = Math.abs(avg - center) * 0.6;
    if (prev && prev.length) {
      for (const n of notes) k += Math.min(...prev.map((p) => Math.abs(p - n)));
    }
    return k;
  };
  candidates.sort((a, b) => cost(a) - cost(b));
  return candidates[0];
}

const CHORD_RHYTHMS = {
  // [開始拍, 長さ, ベロシティ係数] 1小節分
  block: [[0, 4, 1]],
  half: [[0, 2, 1], [2, 2, 0.85]],
  pop: [[0, 1.5, 1], [1.5, 1, 0.8], [3, 1, 0.85]],
  stabs: [[0, 0.5, 1], [1, 0.5, 0.7], [2, 0.5, 0.9], [3, 0.5, 0.7]],
  offbeat: [[0.5, 0.4, 0.85], [1.5, 0.4, 0.75], [2.5, 0.4, 0.85], [3.5, 0.4, 0.75]],
};

/**
 * コードトラック用ノートを生成
 * @param {{bar:number, beat?:number, symbol:string, length?:number}[]} chords
 * @param {"block"|"half"|"pop"|"stabs"|"offbeat"|"arpeggio"|"broken"} style
 */
export function generateChordNotes(chords, style = "block", { velocity = 80, center = 62 } = {}) {
  const sorted = sortChords(chords);
  const notes = [];
  let prev = null;
  sorted.forEach((c, i) => {
    const start = c.bar * BEATS_PER_BAR + (c.beat || 0);
    const next = sorted[i + 1];
    const end = c.length != null ? start + c.length : next ? next.bar * BEATS_PER_BAR + (next.beat || 0) : start + BEATS_PER_BAR;
    const len = end - start;
    const voicing = voiceChord(c.symbol, prev, center);
    if (!voicing.length) return;
    prev = voicing;
    if (style === "arpeggio" || style === "broken") {
      const seq = style === "arpeggio" ? [...voicing, voicing[0] + 12, ...voicing.slice(1).reverse()] : [voicing[0], voicing[2] ?? voicing[1], voicing[1], voicing[2] ?? voicing[1]];
      const step = 0.5;
      for (let t = 0, k = 0; t < len - 1e-6; t += step, k++) {
        notes.push({ pitch: seq[k % seq.length], start: start + t, duration: step * 0.95, velocity: Math.round(velocity * (k % 4 === 0 ? 1 : 0.8)) });
      }
      return;
    }
    const pattern = CHORD_RHYTHMS[style] || CHORD_RHYTHMS.block;
    for (let barOff = 0; barOff < len - 1e-6; barOff += BEATS_PER_BAR) {
      for (const [s, d, v] of pattern) {
        if (barOff + s >= len - 1e-6) continue;
        const dur = Math.min(d, len - barOff - s);
        for (const p of voicing) notes.push({ pitch: p, start: start + barOff + s, duration: dur, velocity: Math.round(velocity * v) });
      }
    }
  });
  return notes;
}

/**
 * ベースライン生成
 * @param {"root"|"eighth"|"octave"|"walking"|"synco"} style
 */
export function generateBass(chords, style = "eighth", { velocity = 95, seed = 1 } = {}) {
  const r = rng(seed);
  const sorted = sortChords(chords);
  const notes = [];
  const low = (pc) => 36 + mod(pc, 12) - (mod(pc, 12) > 7 ? 12 : 0); // G#1〜G2 (32〜43)
  sorted.forEach((c, i) => {
    const ch = parseChord(c.symbol);
    if (!ch) return;
    const start = c.bar * BEATS_PER_BAR + (c.beat || 0);
    const next = sorted[i + 1];
    const end = c.length != null ? start + c.length : next ? next.bar * BEATS_PER_BAR + (next.beat || 0) : start + BEATS_PER_BAR;
    const len = end - start;
    const root = low(ch.bass ?? ch.root);
    const fifth = root + 7;
    const third = root + ch.intervals[1];
    const nextChord = next ? parseChord(next.symbol) : null;
    const nextRoot = nextChord ? low(nextChord.bass ?? nextChord.root) : root;
    const push = (p, s, d, v = 1) => {
      if (s < len - 1e-6) notes.push({ pitch: p, start: start + s, duration: Math.min(d, len - s), velocity: Math.round(velocity * v) });
    };
    for (let b = 0; b < len - 1e-6; b += BEATS_PER_BAR) {
      const lastBar = b + BEATS_PER_BAR >= len - 1e-6;
      switch (style) {
        case "root":
          push(root, b, BEATS_PER_BAR * 0.95);
          break;
        case "octave":
          for (let k = 0; k < 8; k++) push(k % 2 ? root + 12 : root, b + k * 0.5, 0.45, k % 2 ? 0.8 : 1);
          break;
        case "walking": {
          const approach = nextRoot + (nextRoot > root ? -1 : 1);
          const line = [root, pick(r, [third, root + 2]), fifth > root + 7 ? fifth - 12 : fifth, lastBar ? approach : pick(r, [third, root + 12 - 2])];
          line.forEach((p, k) => push(p, b + k, 0.9, k === 0 ? 1 : 0.85));
          break;
        }
        case "synco":
          push(root, b, 1.4);
          push(root, b + 1.5, 0.45, 0.8);
          push(fifth, b + 2, 0.9, 0.9);
          push(lastBar ? nextRoot + (nextRoot > root ? -2 : 2) : root + 12, b + 3, 0.45, 0.75);
          push(root, b + 3.5, 0.45, 0.8);
          break;
        case "eighth":
        default:
          for (let k = 0; k < 8; k++) push(root, b + k * 0.5, 0.45, k % 2 ? 0.8 : 1);
      }
    }
  });
  return notes;
}

// 16ステップのパターン（文字列で x=強, o=弱, .=休み）
const DRUM_PATTERNS = {
  basic: { kick: "x.......x.x.....", snare: "....x.......x...", hatClosed: "x.o.x.o.x.o.x.o." },
  rock: { kick: "x.....x.x.......", snare: "....x.......x...", hatClosed: "x.x.x.x.x.x.x.x." },
  four: { kick: "x...x...x...x...", clap: "....x.......x...", hatClosed: "..x...x...x...x.", hatOpen: "......x.......x." },
  hiphop: { kick: "x......x..x.....", snare: "....x.......x...", hatClosed: "x.x.x.x.x.x.xox." },
  halftime: { kick: "x.........x.....", snare: "........x.......", hatClosed: "x.x.x.x.x.x.x.x." },
  ballad: { kick: "x.......x.......", snare: "....o.......x...", hatClosed: "x...x...x...x..." },
  shuffle: { kick: "x.....x.x.....x.", snare: "....x.......x...", hatClosed: "x..ox..ox..ox..o" },
  dnb: { kick: "x.........x.....", snare: "....x.......x..o", hatClosed: "x.x.x.x.x.x.x.x." },
};
export const DRUM_STYLES = Object.keys(DRUM_PATTERNS);

/** ドラムパターン生成。fill=true なら 4小節ごとに最後の拍をフィル */
export function generateDrums(style = "basic", { startBar = 0, bars = 4, velocity = 100, fill = true, crash = true } = {}) {
  const pat = DRUM_PATTERNS[style] || DRUM_PATTERNS.basic;
  const notes = [];
  for (let bar = startBar; bar < startBar + bars; bar++) {
    const isFillBar = fill && (bar - startBar) % 4 === 3;
    for (const [name, str] of Object.entries(pat)) {
      for (let step = 0; step < 16; step++) {
        if (isFillBar && step >= 12 && name !== "kick") continue;
        const ch = str[step];
        if (ch === ".") continue;
        notes.push({ pitch: DRUM[name], start: bar * BEATS_PER_BAR + step / 4, duration: 0.25, velocity: Math.round(velocity * (ch === "x" ? 1 : 0.6)) });
      }
    }
    if (isFillBar) {
      [DRUM.snare, DRUM.snare, DRUM.tomHigh, DRUM.tomLow].forEach((p, k) =>
        notes.push({ pitch: p, start: bar * BEATS_PER_BAR + 3 + k / 4, duration: 0.25, velocity: Math.round(velocity * (0.75 + k * 0.08)) }),
      );
    }
    if (crash && (bar - startBar) % 8 === 0) notes.push({ pitch: DRUM.crash, start: bar * BEATS_PER_BAR, duration: 1, velocity: Math.round(velocity * 0.9) });
  }
  return notes;
}

// メロディのリズムテンプレート（1小節, [開始, 長さ]）
const MELODY_RHYTHMS = {
  sparse: [
    [[0, 2], [2, 2]],
    [[0, 3], [3, 1]],
    [[0, 1.5], [1.5, 2.5]],
    [[0, 4]],
  ],
  normal: [
    [[0, 1], [1, 1], [2, 1.5], [3.5, 0.5]],
    [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1]],
    [[0, 0.5], [0.5, 1], [1.5, 1], [2.5, 1.5]],
    [[0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]],
    [[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]],
  ],
  busy: [
    [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1], [3, 0.5], [3.5, 0.5]],
    [[0, 0.75], [0.75, 0.75], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]],
    [[0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 1.5]],
  ],
};

/**
 * メロディ生成
 * - 強拍はコードトーン、弱拍はスケール内を順次進行
 * - 2小節モチーフを作り、繰り返し＋変形してフレーズに統一感を出す
 * - フレーズ末尾（4小節目）はコードのルートか3度で着地
 */
export function generateMelody(chords, key, { startBar = 0, bars = 4, density = "normal", seed = 1, low = 60, high = 81, velocity = 90 } = {}) {
  const r = rng(seed);
  const sorted = sortChords(chords);
  const scale = scalePcs(key);
  const inRange = [];
  for (let p = low; p <= high; p++) if (scale.includes(mod(p, 12))) inRange.push(p);
  const rhythms = MELODY_RHYTHMS[density] || MELODY_RHYTHMS.normal;

  const motif = [pick(r, rhythms), pick(r, rhythms)];
  // 音型（相対的な上下）もモチーフとして保存し、繰り返し時に再利用
  const contourBank = [];
  let current = inRange[Math.floor(inRange.length / 2)];
  const notes = [];

  for (let i = 0; i < bars; i++) {
    const bar = startBar + i;
    const phrasePos = i % 4;
    let rhythm;
    if (phrasePos < 2) rhythm = motif[phrasePos];
    else if (phrasePos === 2) rhythm = r() < 0.6 ? motif[0] : pick(r, rhythms);
    else rhythm = pick(r, MELODY_RHYTHMS.sparse); // フレーズ末は長めの音で着地

    rhythm.forEach(([s, d], k) => {
      const beat = bar * BEATS_PER_BAR + s;
      const c = chordAt(sorted, beat);
      const tones = c ? chordPcs(c.symbol) : [key.root];
      const strong = s % 1 === 0 && (s === 0 || s === 2);
      const isLast = phrasePos === 3 && k === rhythm.length - 1;
      let target;
      const reuse = phrasePos === 2 && contourBank[k] != null && r() < 0.5;
      if (isLast) {
        const landing = c ? [tones[0], tones[1]] : [key.root];
        target = nearest(inRange.filter((p) => landing.includes(mod(p, 12))), current);
      } else if (reuse) {
        target = nearestScale(inRange, current + contourBank[k]);
      } else if (strong) {
        const cands = inRange.filter((p) => tones.includes(mod(p, 12)) && Math.abs(p - current) <= 7);
        target = cands.length ? pick(r, cands) : nearest(inRange.filter((p) => tones.includes(mod(p, 12))), current);
      } else {
        const idx = inRange.indexOf(nearestScale(inRange, current));
        const dir = current > (low + high) / 2 + 4 ? -1 : current < (low + high) / 2 - 4 ? 1 : r() < 0.5 ? -1 : 1;
        const step = r() < 0.75 ? 1 : 2;
        target = inRange[Math.max(0, Math.min(inRange.length - 1, idx + dir * step))];
      }
      if (phrasePos < 2) contourBank[k] = target - current;
      current = target;
      notes.push({ pitch: target, start: beat, duration: d * 0.95, velocity: Math.round(velocity * (strong ? 1 : 0.82)) });
    });
  }
  return notes;
}

function nearest(list, p) {
  if (!list.length) return p;
  return list.reduce((best, x) => (Math.abs(x - p) < Math.abs(best - p) ? x : best), list[0]);
}

function nearestScale(scaleNotes, p) {
  return nearest(scaleNotes, p);
}

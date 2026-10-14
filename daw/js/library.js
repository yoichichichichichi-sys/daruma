// 参考曲ライブラリ: プロの曲などの MIDI を読み込み、アレンジの「型」を抽出して貯める。
// 抽出するのはキーに依存しない形（主音からの距離・コード上の音程・リズム）なので、
// 今の曲のキーやコードに当てはめ直して使える。メロディはリズムと輪郭だけを借り、
// 音そのものは今のコードに合わせて作り直す（元曲のメロディをそのまま複製しない）。

import { BEATS_PER_BAR, CHORD_QUALITIES, mod, detectKey, chordSymbol, scalePcs, rng, pick, parseChord, chordPcs } from "./theory.js";
import { sortChords, chordAt, voiceChord, DRUM } from "./generate.js";

// ---------------- パートの役割判定 ----------------

const NAME_HINTS = [
  [/bass|ベース|ba\b/i, "bass"],
  [/drum|ドラム|kit|perc|リズム|kick|snare|hat/i, "drums"],
  [/vocal|vox|melody|lead|メロ|歌|ボーカル|主旋律|sax|trumpet|flute|violin 1/i, "melody"],
  // ステム分離の「その他」（ギター・鍵盤などの伴奏）はコード扱い
  [/piano|key|pad|chord|organ|ep\b|rhodes|guitar|gtr|ピアノ|コード|ギター|ストリングス|strings|synth|other|その他|inst/i, "chords"],
];

// ---------------- ステム別 MIDI のまとめ・クリーンアップ ----------------

const STEM_WORD = /(drums?|bass|vocals?|vox|other|piano|guitars?|gtr|keys|synth|strings|ドラム|ベース|ボーカル|歌|ギター|ピアノ|その他)/i;

/** ファイル名からステムの種類（drums 等の語）を取り出す。無ければ null */
export function stemLabel(fileName) {
  return STEM_WORD.exec(fileName.replace(/\.midi?$/i, ""))?.[1] ?? null;
}

/**
 * ステム別に書き出した MIDI（例: 曲A_drums.mid, 曲A_bass.mid）を曲ごとにまとめる。
 * ステムの語を含まないファイルは 1 ファイル = 1 曲。
 * @param {string[]} fileNames
 * @returns {{name:string, indexes:number[]}[]}
 */
export function groupStemFiles(fileNames) {
  const groups = new Map();
  const out = [];
  fileNames.forEach((file, i) => {
    const base = file.replace(/\.midi?$/i, "");
    if (!stemLabel(base)) {
      out.push({ name: base, indexes: [i] });
      return;
    }
    const song = base
      .replace(STEM_WORD, "")
      .replace(/stems?|ステム|midi/gi, "")
      .replace(/[\s_\-.()[\]【】（）]+/g, " ")
      .trim();
    const k = song.toLowerCase() || "(stems)";
    if (!groups.has(k)) {
      const g = { name: song || "ステム", indexes: [] };
      groups.set(k, g);
      out.push(g);
    }
    groups.get(k).indexes.push(i);
  });
  return out;
}

/**
 * 複数の MIDI（ステム別ファイル）を 1 曲分にまとめる。トラック名にステム名を付けてパート判定に使う
 * @param {{fileName:string, midi:ReturnType<import('./midi.js').parseMidi>}[]} files
 */
export function mergeMidis(files, name = "") {
  const withTempo = files.find((f) => f.midi.tempoFound);
  const tracks = files.flatMap(({ fileName, midi }) => {
    const label = stemLabel(fileName) ?? fileName.replace(/\.midi?$/i, "");
    return midi.tracks.map((t) => ({ ...t, name: midi.tracks.length === 1 ? label : `${label} ${t.name}` }));
  });
  const first = (withTempo ?? files[0]).midi;
  return { ppq: first.ppq, bpm: first.bpm, tempoFound: !!withTempo, timeSig: first.timeSig, name, tracks };
}

/**
 * オーディオから変換した MIDI に多い「細切れ・ゴースト・重なり」を整える。
 * - ごく短い音・ごく弱い音を捨てる
 * - ベース・メロディは同じ音高の細切れをつなぎ、同時に鳴る音は 1 音に（ベースは最低音、メロディは最高音）
 * - ドラムの音高が GM 配置でなければ、低い音 = キック、高い音 = ハット…と推定して割り当て直す
 * @returns {{removed:number, merged:number, drumsRemapped:boolean}}
 */
export function cleanPart(part) {
  const before = part.notes.length;
  let notes = part.notes.filter((n) => n.velocity >= 12 && (part.role === "drums" || n.duration >= 1 / 24));
  let merged = 0;
  let drumsRemapped = false;
  if (part.role === "bass" || part.role === "melody") {
    notes = [...notes].sort((a, b) => a.start - b.start || (part.role === "bass" ? a.pitch - b.pitch : b.pitch - a.pitch));
    const mono = [];
    for (const n of notes) {
      const last = mono[mono.length - 1];
      if (last && Math.abs(n.start - last.start) < 0.08) continue; // 同時発音 → 先頭（最低音/最高音）だけ残す
      // 細切れをつなぐ。隙間がほぼ無いものだけ（8 分の連打などの意図的な同音連打は残す）
      if (last && last.pitch === n.pitch && n.start - (last.start + last.duration) < 0.03) {
        last.duration = n.start + n.duration - last.start;
        merged++;
        continue;
      }
      if (last && last.start + last.duration > n.start) last.duration = Math.max(0.05, n.start - last.start);
      mono.push({ ...n });
    }
    notes = mono;
  }
  if (part.role === "drums" && notes.length) {
    const known = notes.filter((n) => drumRole(n.pitch)).length;
    if (known / notes.length < 0.6) {
      const counts = new Map();
      for (const n of notes) counts.set(n.pitch, (counts.get(n.pitch) || 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p);
      const byPitch = [...top].sort((a, b) => a - b);
      const map = new Map();
      map.set(byPitch[0], DRUM.kick);
      if (byPitch.length > 1) map.set(byPitch[byPitch.length - 1], DRUM.hatClosed);
      const middle = top.filter((p) => !map.has(p));
      if (middle.length) map.set(middle[0], DRUM.snare); // 中音域で一番多いもの = スネア
      for (const p of middle.slice(1)) map.set(p, DRUM.tomLow);
      notes = notes.filter((n) => map.has(n.pitch)).map((n) => ({ ...n, pitch: map.get(n.pitch) }));
      drumsRemapped = true;
    }
  }
  part.notes = notes;
  return { removed: before - notes.length - merged, merged, drumsRemapped };
}

function stats(notes) {
  const avg = notes.reduce((a, n) => a + n.pitch, 0) / notes.length;
  // 同時に鳴っている音の割合（和音っぽさ）
  let overlapped = 0;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    for (let j = i + 1; j < notes.length && notes[j].start < n.start + n.duration - 0.05; j++) {
      if (Math.abs(notes[j].start - n.start) < 0.1) {
        overlapped++;
        break;
      }
    }
  }
  return { avg, poly: overlapped / notes.length, count: notes.length };
}

/** 各パートに role（drums / bass / melody / chords / other）を付ける */
export function classifyParts(tracks) {
  const parts = tracks.map((t) => ({ ...t, ...(t.notes.length ? stats(t.notes) : { avg: 0, poly: 0, count: 0 }), role: "other" }));
  for (const p of parts) {
    if (p.channel === 9) p.role = "drums";
    else {
      const hint = NAME_HINTS.find(([re]) => re.test(p.name || ""));
      if (hint) p.role = hint[1];
      else if (p.program != null && p.program >= 32 && p.program <= 39) p.role = "bass";
    }
  }
  const melodic = parts.filter((p) => p.role !== "drums" && p.count >= 4);
  if (!parts.some((p) => p.role === "bass")) {
    const low = melodic.filter((p) => p.avg < 55 && p.poly < 0.3).sort((a, b) => a.avg - b.avg)[0];
    if (low) low.role = "bass";
  }
  if (!parts.some((p) => p.role === "melody")) {
    const mel = melodic.filter((p) => p.role === "other" && p.poly < 0.25 && p.avg >= 57).sort((a, b) => b.count * b.avg - a.count * a.avg)[0];
    if (mel) mel.role = "melody";
  }
  for (const p of melodic) if (p.role === "other" && p.poly >= 0.3) p.role = "chords";
  return parts;
}

// ---------------- コード検出 ----------------

const DETECT_QUALITIES = ["", "m", "7", "maj7", "m7", "dim", "m7b5", "sus4"];

/**
 * 区間 [from, to) に鳴っている音からコードを推定
 * @returns {{root:number, quality:string, score:number} | null}
 */
export function detectChord(notes, from, to) {
  const w = new Array(12).fill(0);
  let lowest = null;
  let total = 0;
  for (const n of notes) {
    const s = Math.max(from, n.start);
    const e = Math.min(to, n.start + n.duration);
    if (e <= s) continue;
    // 区間の頭で鳴っている音・低い音を重視
    const weight = (e - s) * (n.start <= from + 0.05 ? 1.3 : 1) * (n.pitch < 55 ? 1.4 : 1);
    w[mod(n.pitch, 12)] += weight;
    total += weight;
    if (!lowest || n.pitch < lowest.pitch || (n.pitch === lowest.pitch && n.start < lowest.start)) lowest = n;
  }
  if (total < 0.5) return null;
  let best = null;
  for (let root = 0; root < 12; root++) {
    for (const q of DETECT_QUALITIES) {
      const tones = CHORD_QUALITIES[q].map((i) => mod(root + i, 12));
      let score = 0;
      for (let pc = 0; pc < 12; pc++) score += tones.includes(pc) ? w[pc] : -w[pc] * 0.8;
      score -= tones.length * total * 0.03; // 構成音が多いコードほど当たりやすいので少し罰する
      if (lowest && mod(lowest.pitch, 12) === root) score += total * 0.15;
      if (w[root] === 0) score -= total * 0.3;
      if (!best || score > best.score) best = { root, quality: q, score };
    }
  }
  return best && best.score > 0 ? best : null;
}

const ROMAN_BY_SEMI = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"];

/** 主音からの半音数とコード種 → 読みやすいディグリー表記（メジャースケール基準） */
export function intervalToRoman(interval, quality) {
  let r = ROMAN_BY_SEMI[mod(interval, 12)];
  const minorish = /^m(?!aj)|dim|m7b5/.test(quality);
  if (minorish) r = r.replace(/[IV]+/, (x) => x.toLowerCase());
  const suffix = { "": "", m: "", dim: "°", m7b5: "ø", m7: "7" }[quality] ?? quality;
  return r + suffix;
}

// ---------------- 解析 ----------------

const DRUM_ROLES = [
  ["kick", [35, 36]],
  ["snare", [37, 38, 40]],
  ["clap", [39]],
  ["hatClosed", [42, 44]],
  ["hatOpen", [46]],
  ["crash", [49, 52, 55, 57]],
  ["ride", [51, 53, 59]],
  ["tomHigh", [48, 50]],
  ["tomLow", [41, 43, 45, 47]],
];
const drumRole = (pitch) => DRUM_ROLES.find(([, ps]) => ps.includes(pitch))?.[0] ?? null;

function barSlices(notes, bars) {
  const out = Array.from({ length: bars }, () => []);
  for (const n of notes) {
    const bar = Math.floor(n.start / BEATS_PER_BAR + 1e-6);
    if (bar >= 0 && bar < bars) out[bar].push(n);
  }
  return out;
}

const r3 = (x) => Math.round(x * 1000) / 1000;
const q16 = (x) => Math.round(x * 4) / 4; // 16分に丸め

/** 同じ型を数えながらまとめる */
function tally(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    const cur = map.get(k);
    if (cur) cur.count++;
    else map.set(k, { ...it, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/**
 * MIDI の解析結果（parseMidi の戻り値）から、ライブラリの 1 曲分のデータを作る
 * @param {ReturnType<import('./midi.js').parseMidi>} midi
 */
export function analyzeSong(midi, name = "") {
  const parts = classifyParts(midi.tracks);
  const cleanup = { removed: 0, merged: 0, drumsRemapped: false };
  for (const p of parts) {
    const r = cleanPart(p);
    cleanup.removed += r.removed;
    cleanup.merged += r.merged;
    cleanup.drumsRemapped ||= r.drumsRemapped;
  }
  const end = Math.max(...midi.tracks.flatMap((t) => t.notes.map((n) => n.start + n.duration)), 0);
  const bars = Math.max(1, Math.ceil(end / BEATS_PER_BAR - 1e-6));
  const pitched = parts.filter((p) => p.role !== "drums");
  const pitchedNotes = pitched.flatMap((p) => p.notes);
  const key = detectKey(pitchedNotes) ?? { root: 0, mode: "major" };

  // コード（半小節ごとに推定し、同じなら 1 小節にまとめる）
  const harmonyNotes = pitched.filter((p) => p.role !== "melody").flatMap((p) => p.notes);
  const source = harmonyNotes.length >= 8 ? harmonyNotes : pitchedNotes;
  const chords = [];
  for (let bar = 0; bar < bars; bar++) {
    const s = bar * BEATS_PER_BAR;
    const whole = detectChord(source, s, s + BEATS_PER_BAR);
    const a = detectChord(source, s, s + 2);
    const b = detectChord(source, s + 2, s + 4);
    // 同じルートなら（C と Cmaj7 など）経過音による揺れとみなして分けない
    const same = (x, y) => x && y && x.root === y.root;
    const list = a && b && !same(a, b) && b.score > whole?.score * 0.35 ? [[0, a, 2], [2, b, 2]] : whole ? [[0, whole, 4]] : [];
    for (const [beat, c, len] of list) {
      const prev = chords[chords.length - 1];
      // 前と同じコードが続くなら伸ばす
      if (prev && prev.interval === mod(c.root - key.root, 12) && prev.quality === c.quality && prev.start + prev.length === s + beat) prev.length += len;
      else chords.push({ start: s + beat, length: len, interval: mod(c.root - key.root, 12), quality: c.quality });
    }
  }

  // 音の分布だけでは平行調（F メジャーと D マイナー等）を区別できないので、
  // フレーズ（4 小節）の終わり・曲の最後・フレーズの頭に来るコードで長調・短調を決め直す。
  // 終止のほうが調性をよく表すので重く数える
  const rel = key.mode === "major" ? { root: mod(key.root + 9, 12), mode: "minor" } : { root: mod(key.root + 3, 12), mode: "major" };
  const phrase = BEATS_PER_BAR * 4;
  const anchorScore = (k) =>
    chords.reduce((a, c, i) => {
      const root = mod(key.root + c.interval, 12);
      if (root !== k.root || (k.mode === "minor") !== /^m(?!aj)/.test(c.quality)) return a;
      const end = c.start + c.length;
      let w = 0;
      if (c.start % phrase === 0) w += 1;
      if (end % phrase === 0) w += 2;
      if (i === chords.length - 1) w += 3;
      return a + w;
    }, 0);
  if (anchorScore(rel) > anchorScore(key)) {
    const shift = mod(key.root - rel.root, 12);
    for (const c of chords) c.interval = mod(c.interval + shift, 12);
    key.root = rel.root;
    key.mode = rel.mode;
  }

  const chordAtBeat = (beat) => {
    let cur = null;
    for (const c of chords) if (c.start <= beat + 1e-6) cur = c;
    return cur;
  };

  // コード進行（4 小節単位のループ）
  const loops = [];
  for (let bar = 0; bar + 4 <= bars; bar += 4) {
    const seq = chords.filter((c) => c.start >= bar * BEATS_PER_BAR && c.start < (bar + 4) * BEATS_PER_BAR).map((c) => ({ beat: c.start - bar * BEATS_PER_BAR, length: Math.min(c.length, (bar + 4) * BEATS_PER_BAR - c.start), interval: c.interval, quality: c.quality }));
    if (seq.length >= 2) loops.push({ chords: seq });
  }
  const progressions = tally(loops, (l) => l.chords.map((c) => `${c.beat}:${c.interval}${c.quality}`).join(" ")).slice(0, 8);

  // ドラム（1 小節 16 ステップ）
  const drumNotes = parts.filter((p) => p.role === "drums").flatMap((p) => p.notes);
  const drumBars = barSlices(drumNotes, bars)
    .map((ns, bar) => {
      if (ns.length < 3) return null;
      const pat = {};
      for (const n of ns) {
        const role = drumRole(n.pitch);
        if (!role) continue;
        const step = Math.round((n.start - bar * BEATS_PER_BAR) * 4);
        if (step < 0 || step > 15) continue;
        pat[role] ??= "................".split("");
        pat[role][step] = n.velocity >= 90 || pat[role][step] === "x" ? "x" : "o";
      }
      const pattern = Object.fromEntries(Object.entries(pat).map(([k, v]) => [k, v.join("")]));
      const fill = !!(pattern.tomHigh || pattern.tomLow) || (pattern.snare && (pattern.snare.slice(12).match(/[xo]/g) || []).length >= 3);
      return { pattern, fill };
    })
    .filter(Boolean);
  const grooves = tally(drumBars.filter((d) => !d.fill), (d) => JSON.stringify(d.pattern)).slice(0, 6);
  const fills = tally(drumBars.filter((d) => d.fill), (d) => JSON.stringify(d.pattern)).slice(0, 4);

  // ベース: 各音を「その時のコードのルートからの音程」で記録
  const bassPart = parts.filter((p) => p.role === "bass").sort((a, b) => b.count - a.count)[0];
  const bassBars = bassPart
    ? barSlices(bassPart.notes, bars)
        .map((ns, bar) => {
          if (!ns.length) return null;
          // 小節内の最低音より下にある、その時のルートを基準オクターブにする
          const lowest = Math.min(...ns.map((n) => n.pitch));
          const notes = ns.map((n) => {
            const c = chordAtBeat(n.start);
            const root = c ? mod(key.root + c.interval, 12) : key.root;
            const iv = mod(n.pitch - root, 12);
            const base = lowest - mod(lowest - root, 12);
            return { s: q16(n.start - bar * BEATS_PER_BAR), d: Math.max(0.25, q16(n.duration)), iv, oct: Math.round((n.pitch - iv - base) / 12), v: n.velocity };
          });
          return { notes };
        })
        .filter(Boolean)
    : [];
  const bassPatterns = tally(bassBars, (b) => b.notes.map((n) => `${n.s}/${n.d}/${n.iv}/${n.oct}`).join(" ")).slice(0, 8);

  // バッキングのリズム（同時に鳴り始める音をひとかたまりとして）
  const chordPart = parts.filter((p) => p.role === "chords").sort((a, b) => b.count - a.count)[0];
  const compBars = chordPart
    ? barSlices(chordPart.notes, bars)
        .map((ns, bar) => {
          const hits = tally(ns.map((n) => ({ s: q16(n.start - bar * BEATS_PER_BAR), d: Math.max(0.25, q16(n.duration)), v: n.velocity })), (h) => h.s).sort((a, b) => a.s - b.s);
          return hits.length ? { hits: hits.map(({ s, d, v }) => ({ s, d, v })) } : null;
        })
        .filter(Boolean)
    : [];
  const compPatterns = tally(compBars, (c) => c.hits.map((h) => `${h.s}/${h.d}`).join(" ")).slice(0, 8);

  // メロディ: 2 小節ごとのリズムと輪郭（前の音からの音階上の動き）
  const melPart = parts.filter((p) => p.role === "melody").sort((a, b) => b.count - a.count)[0];
  const melodyPhrases = [];
  if (melPart) {
    const scale = scalePcs(key);
    const degreeOf = (pitch) => {
      // 音階上の通し番号（スケール外は近い方へ）
      const oct = Math.floor(pitch / 12);
      let best = 0;
      let bestDist = 99;
      scale.forEach((pc, i) => {
        const d = Math.abs(mod(pitch - pc + 6, 12) - 6);
        if (d < bestDist) (bestDist = d), (best = i);
      });
      return oct * 7 + best;
    };
    for (let bar = 0; bar + 2 <= bars; bar += 2) {
      const ns = melPart.notes.filter((n) => n.start >= bar * BEATS_PER_BAR && n.start < (bar + 2) * BEATS_PER_BAR);
      if (ns.length < 3) continue;
      // 和音は一番上の 1 音に
      const mono = [];
      for (const n of ns) {
        const last = mono[mono.length - 1];
        if (last && n.start - last.start <= 0.05) {
          if (n.pitch > last.pitch) mono[mono.length - 1] = n;
        } else mono.push(n);
      }
      const steps = mono.map((n, i) => (i === 0 ? 0 : degreeOf(n.pitch) - degreeOf(mono[i - 1].pitch)));
      melodyPhrases.push({ notes: mono.map((n, i) => ({ s: q16(n.start - bar * BEATS_PER_BAR), d: Math.max(0.25, q16(n.duration)), step: Math.max(-7, Math.min(7, steps[i])), v: n.velocity })) });
    }
  }
  const melodyPatterns = tally(melodyPhrases, (m) => m.notes.map((n) => `${n.s}/${n.d}/${n.step}`).join(" ")).slice(0, 12);

  return {
    id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: name || midi.name || "曲",
    tags: [],
    addedAt: new Date().toISOString(),
    tempoFound: midi.tempoFound !== false,
    cleanup,
    bpm: midi.bpm,
    timeSig: midi.timeSig,
    key,
    bars,
    parts: parts.map((p) => ({ name: p.name, role: p.role, notes: p.notes.length })),
    chords: chords.map((c) => ({ start: r3(c.start), length: r3(c.length), interval: c.interval, quality: c.quality })),
    progressions,
    grooves,
    fills,
    bassPatterns,
    compPatterns,
    melodyPatterns,
  };
}

/** 曲の概要（表示用） */
export function describeSong(song) {
  const loop = song.progressions[0];
  return {
    key: chordSymbol(song.key.root, song.key.mode === "minor" ? "m" : "", song.key),
    progression: loop ? loop.chords.map((c) => intervalToRoman(c.interval, c.quality)).join(" - ") : "（検出できず）",
    roles: song.parts.filter((p) => p.role !== "other").map((p) => `${roleJa(p.role)}:${p.name}`).join(", "),
    counts: `グルーヴ${song.grooves.length} / ベース${song.bassPatterns.length} / バッキング${song.compPatterns.length} / メロディ${song.melodyPatterns.length}`,
    notes: [
      song.tempoFound === false ? "テンポ情報なし（120BPM として解析）" : "",
      song.cleanup?.removed || song.cleanup?.merged ? `細切れ ${song.cleanup.merged}・ノイズ ${song.cleanup.removed} 音を整理` : "",
      song.cleanup?.drumsRemapped ? "ドラムの音高を推定して割り当て" : "",
    ]
      .filter(Boolean)
      .join(" / "),
  };
}

export function roleJa(role) {
  return { drums: "ドラム", bass: "ベース", melody: "メロディ", chords: "コード", other: "その他" }[role] ?? role;
}

// ---------------- 生成（ライブラリの型を今の曲に当てはめる） ----------------

/** 参考曲のモードと今の曲のキーから、主音の位置を決める（長調↔短調は平行調で読み替え） */
function tonicFor(songMode, key) {
  if (songMode === key.mode) return key.root;
  return songMode === "minor" ? mod(key.root + 9, 12) : mod(key.root + 3, 12);
}

/**
 * 参考曲のコード進行を今のキーに移して chords 表を作る
 * @param {"loop"|"markov"} method loop: よく出る 4 小節ループをそのまま / markov: 複数曲の流れを学習して新しい進行を作る
 */
export function learnedProgression(songs, key, { method = "loop", bars = 8, seed = 1, startBar = 0 } = {}) {
  const r = rng(seed);
  const out = [];
  if (method === "loop") {
    const candidates = songs.flatMap((s) => s.progressions.map((p) => ({ song: s, p })));
    if (!candidates.length) return null;
    // 出現回数で重み付けして選ぶ
    const total = candidates.reduce((a, c) => a + c.p.count, 0);
    let x = r() * total;
    const chosen = candidates.find((c) => (x -= c.p.count) <= 0) ?? candidates[0];
    const tonic = tonicFor(chosen.song.key.mode, key);
    for (let b = 0; b < bars; b += 4) {
      for (const c of chosen.p.chords) {
        const start = (startBar + b) * BEATS_PER_BAR + c.beat;
        if (start >= (startBar + bars) * BEATS_PER_BAR) continue;
        out.push({ bar: Math.floor(start / BEATS_PER_BAR), beat: start % BEATS_PER_BAR, length: c.length, symbol: chordSymbol(mod(tonic + c.interval, 12), c.quality, key) });
      }
    }
    return { chords: out, source: chosen.song.name, roman: chosen.p.chords.map((c) => intervalToRoman(c.interval, c.quality)) };
  }

  // 1 次マルコフ連鎖（小節単位）。モードの違う曲は平行調に揃えて学習
  const trans = new Map();
  const starts = [];
  for (const s of songs) {
    const shift = s.key.mode === key.mode ? 0 : s.key.mode === "minor" ? 9 : 3; // 今のキーの主音から見た相対位置へ
    const seq = s.chords.map((c) => `${mod(c.interval + shift, 12)}:${c.quality}`);
    if (seq.length) starts.push(seq[0]);
    for (let i = 0; i + 1 < seq.length; i++) {
      if (seq[i] === seq[i + 1]) continue;
      if (!trans.has(seq[i])) trans.set(seq[i], []);
      trans.get(seq[i]).push(seq[i + 1]);
    }
  }
  if (!starts.length) return null;
  let cur = pick(r, starts);
  const roman = [];
  for (let b = 0; b < bars; b++) {
    const [iv, q] = cur.split(":");
    out.push({ bar: startBar + b, beat: 0, length: BEATS_PER_BAR, symbol: chordSymbol(mod(key.root + Number(iv), 12), q, key) });
    roman.push(intervalToRoman(Number(iv), q));
    const nexts = trans.get(cur);
    // 最後の小節の前はトニックに戻りやすい候補を優先
    cur = nexts?.length ? pick(r, nexts) : pick(r, starts);
  }
  return { chords: out, source: songs.map((s) => s.name).join("・"), roman };
}

function weightedPick(r, list) {
  const total = list.reduce((a, x) => a + (x.count || 1), 0);
  let x = r() * total;
  return list.find((it) => (x -= it.count || 1) <= 0) ?? list[0];
}

const lowRoot = (pc) => 36 + mod(pc, 12) - (mod(pc, 12) > 7 ? 12 : 0);

/** ルートからの音程を、今のコードで意味が合う音程に寄せる（3度・7度・5度の種類を合わせる） */
function adaptInterval(iv, chord) {
  const tones = chord.intervals.map((i) => mod(i, 12));
  const has = (x) => tones.includes(x);
  if ((iv === 3 || iv === 4) && !has(iv)) return has(3) ? 3 : has(4) ? 4 : has(5) ? 5 : 2;
  if ((iv === 10 || iv === 11) && !has(iv)) return has(10) ? 10 : has(11) ? 11 : 12;
  if ((iv === 6 || iv === 7 || iv === 8) && !has(iv)) return has(7) ? 7 : has(6) ? 6 : has(8) ? 8 : 7;
  return iv;
}

/** ベース: 参考曲のフレーズ（リズム＋コード上の音程）を今のコードで弾き直す */
export function learnedBass(songs, chords, { startBar = 0, bars = 8, seed = 1 } = {}) {
  const r = rng(seed);
  const pool = songs.flatMap((s) => s.bassPatterns);
  if (!pool.length || !chords.length) return null;
  const sorted = sortChords(chords);
  // 曲の統一感のため 2 種類のパターンを交互に使う
  const a = weightedPick(r, pool);
  const b = weightedPick(r, pool);
  const notes = [];
  for (let i = 0; i < bars; i++) {
    const bar = startBar + i;
    const pat = i % 4 === 3 ? b : a;
    for (const n of pat.notes) {
      const beat = bar * BEATS_PER_BAR + n.s;
      const c = chordAt(sorted, beat);
      const ch = c && parseChord(c.symbol);
      if (!ch) continue;
      const root = lowRoot(ch.bass ?? ch.root);
      const pitch = root + adaptInterval(n.iv, ch) + 12 * Math.max(0, Math.min(1, n.oct));
      notes.push({ pitch: Math.max(28, Math.min(55, pitch)), start: beat, duration: Math.min(n.d, (bar + 1) * BEATS_PER_BAR - beat), velocity: n.v });
    }
  }
  return { notes, pattern: a };
}

/** ドラム: 参考曲のグルーヴを使い、4 小節目にフィル */
export function learnedDrums(songs, { startBar = 0, bars = 8, seed = 1 } = {}) {
  const r = rng(seed);
  const grooves = songs.flatMap((s) => s.grooves);
  if (!grooves.length) return null;
  const fills = songs.flatMap((s) => s.fills);
  const groove = weightedPick(r, grooves);
  const fill = fills.length ? weightedPick(r, fills) : null;
  const notes = [];
  for (let i = 0; i < bars; i++) {
    const bar = startBar + i;
    const pat = i % 4 === 3 && fill ? fill.pattern : groove.pattern;
    for (const [role, str] of Object.entries(pat)) {
      const pitch = DRUM[role];
      if (pitch == null) continue;
      for (let step = 0; step < 16; step++) {
        const ch = str[step];
        if (ch === ".") continue;
        notes.push({ pitch, start: bar * BEATS_PER_BAR + step / 4, duration: 0.25, velocity: ch === "x" ? 105 : 70 });
      }
    }
    if (i % 8 === 0 && !pat.crash) notes.push({ pitch: DRUM.crash, start: bar * BEATS_PER_BAR, duration: 1, velocity: 95 });
  }
  return { notes, groove };
}

/** バッキング: 参考曲のリズムで、今のコードをボイシングして弾く */
export function learnedComping(songs, chords, { startBar = 0, bars = 8, seed = 1 } = {}) {
  const r = rng(seed);
  const pool = songs.flatMap((s) => s.compPatterns);
  if (!pool.length || !chords.length) return null;
  const sorted = sortChords(chords);
  const pat = weightedPick(r, pool);
  const notes = [];
  let prev = null;
  for (let i = 0; i < bars; i++) {
    const bar = startBar + i;
    for (const h of pat.hits) {
      const beat = bar * BEATS_PER_BAR + h.s;
      const c = chordAt(sorted, beat);
      if (!c) continue;
      const v = voiceChord(c.symbol, prev, 62);
      prev = v;
      // 次のコードの頭を越えないように
      const nextChange = sorted.find((x) => x.bar * BEATS_PER_BAR + (x.beat || 0) > beat + 1e-6);
      const limit = nextChange ? nextChange.bar * BEATS_PER_BAR + (nextChange.beat || 0) - beat : h.d;
      for (const p of v) notes.push({ pitch: p, start: beat, duration: Math.max(0.2, Math.min(h.d, limit)), velocity: h.v });
    }
  }
  return { notes, pattern: pat };
}

/**
 * メロディ: 参考曲のフレーズのリズムと輪郭（上がる・下がる・跳ぶ）を借り、
 * 音は今のキーのスケールとコードに合わせて作り直す
 */
export function learnedMelody(songs, chords, key, { startBar = 0, bars = 8, seed = 1, low = 60, high = 81 } = {}) {
  const r = rng(seed);
  const pool = songs.flatMap((s) => s.melodyPatterns);
  if (!pool.length) return null;
  const sorted = sortChords(chords);
  const scale = scalePcs(key);
  const inRange = [];
  for (let p = low; p <= high; p++) if (scale.includes(mod(p, 12))) inRange.push(p);
  const phraseA = weightedPick(r, pool);
  const phraseB = weightedPick(r, pool);
  let idx = Math.floor(inRange.length / 2);
  const notes = [];
  for (let i = 0; i < bars; i += 2) {
    const phrase = (i / 2) % 2 === 1 ? phraseB : phraseA; // A B A B
    phrase.notes.forEach((n, k) => {
      const beat = (startBar + i) * BEATS_PER_BAR + n.s;
      if (beat >= (startBar + bars) * BEATS_PER_BAR) return;
      if (k > 0) idx += n.step;
      // 音域からはみ出したらオクターブで折り返す
      while (idx >= inRange.length) idx -= 7;
      while (idx < 0) idx += 7;
      let pitch = inRange[Math.max(0, Math.min(inRange.length - 1, idx))];
      const c = chordAt(sorted, beat);
      const strong = n.s % 2 === 0 || n.d >= 1;
      if (c && strong) {
        // 強拍・長い音はコードトーンへ寄せる
        const tones = chordPcs(c.symbol);
        if (!tones.includes(mod(pitch, 12))) {
          const cands = inRange.filter((p) => tones.includes(mod(p, 12)));
          if (cands.length) {
            pitch = cands.reduce((best, p) => (Math.abs(p - pitch) < Math.abs(best - pitch) ? p : best), cands[0]);
            idx = inRange.indexOf(pitch);
          }
        }
      }
      notes.push({ pitch, start: beat, duration: n.d * 0.95, velocity: n.v });
    });
  }
  return { notes };
}

// ---------------- 保存 ----------------

const LIB_KEY = "daruma-daw-library";

export class Library {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.songs = [];
    this.load();
  }

  load() {
    try {
      const s = this.storage?.getItem(LIB_KEY);
      const data = s ? JSON.parse(s) : null;
      if (Array.isArray(data?.songs)) this.songs = data.songs;
    } catch {
      this.songs = [];
    }
  }

  save() {
    try {
      this.storage?.setItem(LIB_KEY, JSON.stringify({ version: 1, songs: this.songs }));
      return true;
    } catch {
      return false; // 容量オーバー等。JSON 書き出しで退避してもらう
    }
  }

  add(song) {
    this.songs.push(song);
    return this.save();
  }

  remove(id) {
    this.songs = this.songs.filter((s) => s.id !== id);
    this.save();
  }

  setTags(id, tags) {
    const s = this.songs.find((x) => x.id === id);
    if (s) s.tags = tags;
    this.save();
  }

  /** 曲名・タグの部分一致で絞り込み。空なら全曲 */
  find(query) {
    if (!query) return this.songs;
    const qs = String(query).toLowerCase().split(/[\s,、]+/).filter(Boolean);
    const hit = this.songs.filter((s) => qs.some((q) => s.name.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q))));
    return hit;
  }

  exportJSON() {
    return JSON.stringify({ version: 1, songs: this.songs }, null, 1);
  }

  importJSON(text) {
    const data = JSON.parse(text);
    if (!Array.isArray(data?.songs)) throw new Error("ライブラリの形式ではありません。");
    const ids = new Set(this.songs.map((s) => s.id));
    let added = 0;
    for (const s of data.songs) {
      if (!ids.has(s.id) && Array.isArray(s.progressions)) {
        this.songs.push(s);
        added++;
      }
    }
    this.save();
    return added;
  }
}

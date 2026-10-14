// 音楽理論ユーティリティ: 音名・スケール・コード・ディグリー・定番進行。
// 時間の単位はすべて「拍」（4分音符 = 1）。拍子は 4/4 固定。

export const BEATS_PER_BAR = 4;

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// 日本式音名（ハ長調・イ短調など）
const JP_PC = { ハ: 0, ニ: 2, ホ: 4, ヘ: 5, ト: 7, イ: 9, ロ: 11 };
// カタカナのドレミ
const SOLFEGE_PC = { ド: 0, レ: 2, ミ: 4, ファ: 5, ソ: 7, ラ: 9, シ: 11 };

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
};

export const CHORD_QUALITIES = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mmaj7: [0, 3, 7, 11],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  "9": [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14],
  "7sus4": [0, 5, 7, 10],
};

// 表記ゆれを正規化（長い表記から順にマッチさせる）
const QUALITY_ALIASES = [
  ["maj9", "maj9"], ["M9", "maj9"],
  ["maj7", "maj7"], ["M7", "maj7"], ["△7", "maj7"], ["Δ7", "maj7"], ["△", "maj7"],
  ["mM7", "mmaj7"], ["mmaj7", "mmaj7"],
  ["m7b5", "m7b5"], ["m7-5", "m7b5"], ["ø", "m7b5"],
  ["dim7", "dim7"], ["°7", "dim7"],
  ["7sus4", "7sus4"],
  ["madd9", "add9"], ["add9", "add9"],
  ["sus2", "sus2"], ["sus4", "sus4"], ["sus", "sus4"],
  ["min7", "m7"], ["m7", "m7"], ["-7", "m7"],
  ["m9", "m9"], ["m6", "m6"],
  ["dim", "dim"], ["°", "dim"], ["aug", "aug"], ["+", "aug"],
  ["min", "m"], ["m", "m"], ["-", "m"],
  ["maj", ""], ["M", ""],
  ["9", "9"], ["7", "7"], ["6", "6"],
];

export function mod(n, m) {
  return ((n % m) + m) % m;
}

/** "C", "F#", "Bb", "ハ", "ド" → ピッチクラス(0-11)。解釈できなければ null */
export function parsePitchClass(name) {
  if (name == null) return null;
  const s = String(name).trim();
  if (s in JP_PC) return JP_PC[s];
  if (s in SOLFEGE_PC) return SOLFEGE_PC[s];
  const m = /^([A-Ga-g])([#♯b♭]*)$/.exec(s);
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === "#" || ch === "♯" ? 1 : -1;
  return mod(pc, 12);
}

/** 調の主音に合わせて #/♭ どちらで表記するか決める */
function prefersFlat(keyRoot, mode) {
  const majorRoot = mode === "minor" ? mod(keyRoot + 3, 12) : keyRoot;
  return [5, 10, 3, 8, 1, 6].includes(majorRoot); // F Bb Eb Ab Db Gb
}

export function pcName(pc, key) {
  const flat = key ? prefersFlat(key.root, key.mode) : false;
  return (flat ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[mod(pc, 12)];
}

/** MIDIノート番号 → "C4"（中央ド = C4 = 60） */
export function midiToName(midi, key) {
  return pcName(midi, key) + (Math.floor(midi / 12) - 1);
}

/** "C4" / "F#3" / "Bb5" / 60 → MIDIノート番号 */
export function parseNote(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^([A-Ga-g][#♯b♭]*)(-?\d)$/.exec(s);
  if (!m) return null;
  const pc = parsePitchClass(m[1]);
  if (pc == null) return null;
  // Cb4 / B#3 のようにオクターブをまたぐ表記はレター基準で計算
  const letterPc = LETTER_PC[m[1][0].toUpperCase()];
  const accidental = pc - letterPc > 6 ? pc - letterPc - 12 : pc - letterPc < -6 ? pc - letterPc + 12 : pc - letterPc;
  return (Number(m[2]) + 1) * 12 + letterPc + accidental;
}

/**
 * キー表記の解析: "C", "Am", "C minor", "F# major", "ハ長調", "イ短調", "Dm" など。
 * @returns {{root:number, mode:"major"|"minor"} | null}
 */
export function parseKey(text) {
  if (!text) return null;
  let s = String(text).trim().replace(/\s+/g, " ");
  const jp = /^([嬰変]?)([ハニホヘトイロ])(長調|短調)$/.exec(s.replace(/\s/g, ""));
  if (jp) {
    let root = JP_PC[jp[2]];
    if (jp[1] === "嬰") root += 1;
    if (jp[1] === "変") root -= 1;
    return { root: mod(root, 12), mode: jp[3] === "短調" ? "minor" : "major" };
  }
  const m = /^([A-Ga-g][#♯b♭]?)\s*(major|minor|maj|min|m|メジャー|マイナー|長調|短調)?$/i.exec(s);
  if (!m) return null;
  const root = parsePitchClass(m[1]);
  if (root == null) return null;
  const q = (m[2] || "").toLowerCase();
  const minor = q === "m" || q === "min" || q === "minor" || q === "マイナー" || q === "短調";
  // 小文字 m だけが minor。"M" は major 扱い
  if (m[2] === "M") return { root, mode: "major" };
  return { root, mode: minor ? "minor" : "major" };
}

export function keyName(key) {
  return pcName(key.root, key) + (key.mode === "minor" ? "m" : "");
}

export function keyNameJa(key) {
  return `${pcName(key.root, key)} ${key.mode === "minor" ? "マイナー" : "メジャー"}`;
}

export function scalePcs(key) {
  const intervals = SCALES[key.mode] || SCALES.major;
  return intervals.map((i) => mod(key.root + i, 12));
}

/**
 * コード名を解析: "C", "Am7", "F#m7b5", "Bb/D", "Gsus4"
 * @returns {{root:number, quality:string, bass:number|null, intervals:number[], symbol:string} | null}
 */
export function parseChord(symbol) {
  if (!symbol) return null;
  const s = String(symbol).trim();
  const m = /^([A-G][#♯b♭]?)([^/]*)(?:\/([A-G][#♯b♭]?))?$/.exec(s);
  if (!m) return null;
  const root = parsePitchClass(m[1]);
  if (root == null) return null;
  let rest = m[2].replace(/[()]/g, "");
  let quality = null;
  if (rest === "") quality = "";
  else {
    for (const [alias, q] of QUALITY_ALIASES) {
      if (rest === alias) {
        quality = q;
        break;
      }
    }
  }
  if (quality == null) return null;
  const bass = m[3] ? parsePitchClass(m[3]) : null;
  return { root, quality, bass, intervals: CHORD_QUALITIES[quality], symbol: s };
}

export function chordSymbol(root, quality, key, bass = null) {
  return pcName(root, key) + quality + (bass != null && bass !== root ? "/" + pcName(bass, key) : "");
}

export function chordPcs(chord) {
  const c = typeof chord === "string" ? parseChord(chord) : chord;
  if (!c) return [];
  return c.intervals.map((i) => mod(c.root + i, 12));
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/**
 * ディグリー表記をコード名に変換。例: キー C で "vi" → "Am", "V7" → "G7",
 * "bVII" → "Bb", "ii7" → "Dm7", "IVmaj7" → "Fmaj7", "vii°" → "Bdim"
 */
export function romanToChord(roman, key) {
  const m = /^([b#♭♯]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/.exec(String(roman).trim());
  if (!m) return null;
  const degree = ROMAN.indexOf(m[2].toUpperCase());
  const lower = m[2] === m[2].toLowerCase();
  // ディグリーはメジャースケール基準（ナチュラルマイナーで i を基準にする場合も bIII などで表す）
  const base = key.mode === "minor" ? SCALES.minor : SCALES.major;
  let root = key.root + base[degree];
  if (m[1] === "b" || m[1] === "♭") root -= 1;
  if (m[1] === "#" || m[1] === "♯") root += 1;
  let suffix = m[3];
  let quality;
  if (/^(°|dim|o)/.test(suffix)) {
    quality = /7/.test(suffix) ? "dim7" : "dim";
  } else if (/^(ø|m7b5)/.test(suffix)) {
    quality = "m7b5";
  } else if (lower) {
    if (/^7/.test(suffix)) quality = "m7";
    else if (/^9/.test(suffix)) quality = "m9";
    else if (/^6/.test(suffix)) quality = "m6";
    else quality = "m";
  } else {
    const map = { "": "", "7": "7", maj7: "maj7", M7: "maj7", "9": "9", maj9: "maj9", "6": "6", sus4: "sus4", sus2: "sus2", add9: "add9", aug: "aug", "+": "aug", "7sus4": "7sus4" };
    quality = map[suffix] ?? "";
  }
  // bVII のような借用和音は ♭ 表記にする（F メジャーは ♭ 表記の調なので、それを借りて名前を付ける）
  const naming = m[1] === "b" || m[1] === "♭" ? { root: 5, mode: "major" } : key;
  return chordSymbol(mod(root, 12), quality, naming);
}

/** コード（記号）をキー内のディグリーに変換。ダイアトニックでなければ null */
export function chordToDegree(symbol, key) {
  const c = parseChord(symbol);
  if (!c) return null;
  const pcs = scalePcs(key);
  const idx = pcs.indexOf(c.root);
  if (idx < 0) return null;
  return idx; // 0 = I(i)
}

/** キーのダイアトニック三和音（コード名の配列, I〜VII） */
export function diatonicTriads(key, sevenths = false) {
  const pcs = scalePcs(key);
  return pcs.map((root, i) => {
    const third = mod(pcs[(i + 2) % 7] - root, 12);
    const fifth = mod(pcs[(i + 4) % 7] - root, 12);
    const seventh = mod(pcs[(i + 6) % 7] - root, 12);
    let q;
    if (third === 4 && fifth === 7) q = sevenths ? (seventh === 11 ? "maj7" : "7") : "";
    else if (third === 3 && fifth === 7) q = sevenths ? "m7" : "m";
    else if (third === 3 && fifth === 6) q = sevenths ? "m7b5" : "dim";
    else q = "aug";
    return chordSymbol(root, q, key);
  });
}

// ---- 定番進行（ディグリー表記）。mode: 推奨される調性 ----
export const PROGRESSIONS = [
  { id: "royal", name: "王道進行", mood: ["切ない", "エモい", "J-POP"], mode: "major", roman: ["IVmaj7", "V7", "iii7", "vi"] },
  { id: "komuro", name: "小室進行", mood: ["切ない", "疾走感", "J-POP"], mode: "major", roman: ["vi", "IV", "V", "I"] },
  { id: "axis", name: "ポップ進行（I-V-vi-IV）", mood: ["明るい", "ポップ", "爽やか"], mode: "major", roman: ["I", "V", "vi", "IV"] },
  { id: "canon", name: "カノン進行", mood: ["感動", "壮大", "優しい"], mode: "major", roman: ["I", "V", "vi", "iii", "IV", "I", "IV", "V"] },
  { id: "basic", name: "スリーコード", mood: ["明るい", "シンプル", "ロック"], mode: "major", roman: ["I", "IV", "V", "I"] },
  { id: "twofive", name: "ツーファイブ・ワン", mood: ["ジャズ", "おしゃれ"], mode: "major", roman: ["ii7", "V7", "Imaj7", "vi7"] },
  { id: "citypop", name: "Just The Two Of Us 進行", mood: ["シティポップ", "おしゃれ", "都会的"], mode: "major", roman: ["IVmaj7", "III7", "vi7", "I7"] },
  { id: "doowop", name: "50年代進行", mood: ["レトロ", "優しい", "バラード"], mode: "major", roman: ["I", "vi", "IV", "V"] },
  { id: "epic", name: "エピック進行", mood: ["壮大", "暗い", "かっこいい"], mode: "minor", roman: ["i", "VI", "III", "VII"] },
  { id: "andalusian", name: "アンダルシア進行", mood: ["情熱的", "暗い", "スパニッシュ"], mode: "minor", roman: ["i", "VII", "VI", "V"] },
  { id: "minorsad", name: "マイナーバラード", mood: ["悲しい", "暗い", "バラード"], mode: "minor", roman: ["i", "iv", "VII", "III"] },
  { id: "lofi", name: "Lo-Fi 進行", mood: ["チル", "おしゃれ", "ローファイ"], mode: "major", roman: ["IVmaj7", "iii7", "ii7", "Imaj7"] },
  { id: "blues", name: "12小節ブルース", mood: ["ブルース", "ロック"], mode: "major", roman: ["I7", "I7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"] },
];

/** ムード語から進行を探す（部分一致）。見つからなければ全件 */
export function findProgressions(mood) {
  if (!mood) return PROGRESSIONS;
  const q = String(mood).trim();
  const hits = PROGRESSIONS.filter((p) => p.name.includes(q) || p.id === q || p.mood.some((m) => m.includes(q) || q.includes(m)));
  return hits.length ? hits : PROGRESSIONS;
}

export function progressionToChords(prog, key) {
  return prog.roman.map((r) => romanToChord(r, key));
}

// 機能和声に基づく「次に来やすいコード」（ディグリー index → 候補 index と理由）
const NEXT_MAJOR = {
  0: [[3, "サブドミナントへ広がる"], [4, "ドミナントで緊張"], [5, "平行調へ（切なさ）"], [1, "ツーファイブの入口"]],
  1: [[4, "ツーファイブ（定番）"], [3, "サブドミナント内の移動"], [6, "ドミナント代理"]],
  2: [[5, "王道進行の流れ"], [3, "サブドミナントへ"], [1, "下降ライン"]],
  3: [[4, "ドミナントへ（王道）"], [0, "アーメン終止"], [2, "王道進行（IV→iii）"], [1, "ii へ下降"]],
  4: [[0, "完全終止（解決）"], [5, "偽終止（意外性）"], [3, "ロック的な後退"]],
  5: [[3, "小室進行の流れ"], [1, "ツーファイブへ"], [4, "ドミナントへ"], [2, "下降ライン"]],
  6: [[0, "導音の解決"], [2, "iii へ"]],
};
const NEXT_MINOR = {
  0: [[5, "VI へ（エピック）"], [3, "サブドミナント iv"], [6, "VII（ロック的）"], [4, "ドミナント"]],
  1: [[4, "ツーファイブ（マイナー）"], [6, "VII へ"]],
  2: [[6, "VII へ"], [5, "VI へ"], [3, "iv へ"]],
  3: [[4, "ドミナントへ"], [6, "VII へ"], [0, "トニックへ戻る"]],
  4: [[0, "トニックへ解決"], [5, "偽終止"]],
  5: [[2, "III へ（エピック）"], [6, "VII へ"], [3, "iv へ"], [4, "V へ"]],
  6: [[2, "III（平行長調）へ"], [0, "トニックへ"], [5, "VI へ下降"]],
};

/**
 * 直前のコードから次のコード候補を提案
 * @returns {{chord:string, reason:string}[]}
 */
export function suggestNextChords(prevSymbol, key) {
  const triads = diatonicTriads(key);
  const table = key.mode === "minor" ? NEXT_MINOR : NEXT_MAJOR;
  let deg = prevSymbol ? chordToDegree(prevSymbol, key) : null;
  if (deg == null) {
    // 進行の最初、またはノンダイアトニック → トニック/サブドミナントから
    return [
      { chord: triads[0], reason: "トニックで安定させる" },
      { chord: triads[3], reason: "サブドミナントから始める" },
      { chord: triads[5], reason: key.mode === "minor" ? "VI から（エピック）" : "vi から（小室進行風）" },
    ];
  }
  // V の場合、マイナーキーでは和声的短音階のドミナント（V7）を提案
  const out = (table[deg] || []).map(([i, reason]) => ({ chord: triads[i], reason }));
  if (key.mode === "minor" && deg !== 4) {
    const v7 = chordSymbol(mod(key.root + 7, 12), "7", key);
    if (!out.some((o) => o.chord === v7)) out.push({ chord: v7, reason: "和声的短音階の V7 で強く解決へ" });
  }
  return out;
}

// ---- 乱数（シード付き） ----
export function rng(seed = Date.now()) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(r, arr) {
  return arr[Math.floor(r() * arr.length)];
}

/** 簡易キー推定（ピッチクラスの出現量とスケールの一致度） */
export function detectKey(notes) {
  if (!notes.length) return null;
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[mod(n.pitch, 12)] += n.duration || 1;
  let best = null;
  for (let root = 0; root < 12; root++) {
    for (const mode of ["major", "minor"]) {
      const key = { root, mode };
      const pcs = scalePcs(key);
      let score = 0;
      for (let pc = 0; pc < 12; pc++) score += pcs.includes(pc) ? hist[pc] : -hist[pc];
      score += hist[root] * 0.5; // 主音を少し優遇
      if (!best || score > best.score) best = { key, score };
    }
  }
  return best.key;
}

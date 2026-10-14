// DAW を操作する「アクション」の定義。
// 日本語コマンドのオペレーター（operator.js）と Claude のツール呼び出し（claude.js）の両方が
// ここを経由してプロジェクトを変更する。

import { BEATS_PER_BAR, parseKey, keyNameJa, keyName, parseChord, parseNote, romanToChord, suggestNextChords, midiToName, chordSymbol, PROGRESSIONS } from "./theory.js";
import { generateChordNotes, generateBass, generateMelody, generateDrums, layoutChords, sortChords, DRUM_STYLES } from "./generate.js";
import { createTrack, findTrack, normalizeNotes, clearRange, INSTRUMENTS, INSTRUMENT_ALIASES } from "./project.js";
import { analyzeProject, suggestProgressions } from "./assistant.js";
import { learnedProgression, learnedBass, learnedDrums, learnedComping, learnedMelody, describeSong } from "./library.js";
import { MCU_BUTTONS, dbToFader } from "./studiopro.js";

const CHORD_STYLES = ["block", "half", "pop", "stabs", "offbeat", "arpeggio", "broken"];
const BASS_STYLES = ["root", "eighth", "octave", "walking", "synco"];

class ActionError extends Error {}

function requireTrack(p, ref, fallbackInstrument) {
  let t = findTrack(p, ref);
  if (!t && fallbackInstrument) t = p.tracks.find((x) => x.instrument === fallbackInstrument);
  if (!t) throw new ActionError(ref == null && !fallbackInstrument ? "どのトラックか指定してください（例: 「メロディを〜」）。" : `トラック「${ref ?? fallbackInstrument}」が見つかりません。`);
  return t;
}

/** トラックが無ければ作る */
function ensureTrack(p, ref, instrument, defaultName) {
  const t = (ref != null && findTrack(p, ref)) || (ref == null && p.tracks.find((x) => x.instrument === instrument));
  if (t) return t;
  const nt = createTrack({ name: ref ?? defaultName, instrument });
  p.tracks.push(nt);
  return nt;
}

function resolveChordSymbols(list, key) {
  return list.map((s) => {
    const sym = String(s).trim();
    if (parseChord(sym)) return sym;
    const fromRoman = romanToChord(sym, key);
    if (fromRoman && parseChord(fromRoman)) return fromRoman;
    throw new ActionError(`コード「${sym}」を解釈できません。`);
  });
}

function barRange(p, startBar, bars) {
  const s = Math.max(0, Math.floor(startBar ?? 0));
  const n = Math.max(1, Math.floor(bars ?? p.bars - s));
  return [s, n];
}

function ensureLength(p, endBar) {
  if (endBar > p.bars) {
    // ループが曲全体を指していたら一緒に伸ばす
    if (p.loop.endBar === p.bars) p.loop.endBar = Math.min(256, endBar);
    p.bars = Math.min(256, endBar);
  }
}

const trackProp = { type: "string", description: "トラック名または番号（1始まり）" };

/**
 * @typedef {{store: import('./project.js').Store, transport?: {play():void, stop():void, isPlaying():boolean}, exportMidi?: (trackIds?: string[]) => string, library?: import('./library.js').Library, studio?: import('./studiopro.js').StudioProRemote}} Ctx
 * @typedef {{name:string, title:string, description:string, input_schema:object, run:(ctx:Ctx, input:any)=>{message:string, data?:any}}} Action
 */

/** @type {Action[]} */
export const ACTIONS = [
  {
    name: "get_project",
    title: "曲の状態を見る",
    description: "現在のプロジェクト（テンポ・キー・小節数・コード・各トラックのノート数と音域）を取得する。ノートの詳細が必要なら include_notes を true に。",
    input_schema: { type: "object", properties: { include_notes: { type: "boolean" } }, additionalProperties: false },
    run(ctx, { include_notes = false } = {}) {
      const p = ctx.store.project;
      const data = {
        title: p.title,
        bpm: p.bpm,
        key: keyName(p.key),
        bars: p.bars,
        loop: p.loop,
        chords: sortChords(p.chords).map((c) => ({ bar: c.bar + 1, beat: c.beat || 0, symbol: c.symbol })),
        tracks: p.tracks.map((t, i) => ({
          number: i + 1,
          name: t.name,
          instrument: t.instrument,
          volume: t.volume,
          mute: t.mute,
          solo: t.solo,
          noteCount: t.notes.length,
          notes: include_notes ? t.notes.map((n) => ({ pitch: midiToName(n.pitch, p.key), start: n.start, duration: n.duration, velocity: n.velocity })) : undefined,
        })),
      };
      return { message: `${p.tracks.length} トラック, ${p.bars} 小節, ${keyNameJa(p.key)}, ${p.bpm} BPM`, data };
    },
  },
  {
    name: "set_tempo",
    title: "テンポ変更",
    description: "テンポ（BPM）を設定する。",
    input_schema: { type: "object", properties: { bpm: { type: "number", minimum: 30, maximum: 300 } }, required: ["bpm"], additionalProperties: false },
    run(ctx, { bpm }) {
      // "+10" / "-10" のような相対指定も受け付ける（オペレーター用）
      const v = Math.round(typeof bpm === "string" && /^[+-]/.test(bpm) ? ctx.store.project.bpm + Number(bpm) : Number(bpm));
      if (!(v >= 30 && v <= 300)) throw new ActionError("BPM は 30〜300 で指定してください。");
      ctx.store.commit("テンポ変更", (p) => (p.bpm = v));
      return { message: `テンポを ${v} BPM にしました。` };
    },
  },
  {
    name: "set_key",
    title: "キー変更",
    description: "曲のキーを設定する。例: 'C', 'Am', 'F# minor', 'Eb major'。transpose_notes が true なら既存ノートとコードも移調する。",
    input_schema: { type: "object", properties: { key: { type: "string" }, transpose_notes: { type: "boolean" } }, required: ["key"], additionalProperties: false },
    run(ctx, { key, transpose_notes = false }) {
      const k = parseKey(key);
      if (!k) throw new ActionError(`キー「${key}」を解釈できません。`);
      ctx.store.commit("キー変更", (p) => {
        if (transpose_notes) {
          let d = ((k.root - p.key.root) % 12 + 12) % 12;
          if (d > 6) d -= 12;
          transposeAll(p, d);
        }
        p.key = k;
      });
      return { message: `キーを ${keyNameJa(k)} にしました${transpose_notes ? "（ノートも移調）" : ""}。` };
    },
  },
  {
    name: "set_length",
    title: "小節数変更",
    description: "曲の長さ（小節数）を設定する。ループ範囲も曲全体に合わせる。",
    input_schema: { type: "object", properties: { bars: { type: "integer", minimum: 1, maximum: 256 } }, required: ["bars"], additionalProperties: false },
    run(ctx, { bars }) {
      const n = Math.max(1, Math.min(256, Math.floor(bars)));
      ctx.store.commit("小節数変更", (p) => {
        p.bars = n;
        p.loop = { ...p.loop, startBar: Math.min(p.loop.startBar, n - 1), endBar: n };
      });
      return { message: `${n} 小節にしました。` };
    },
  },
  {
    name: "set_loop",
    title: "ループ範囲",
    description: "ループ再生の範囲を小節番号（1始まり、end_bar を含む）で設定、または enabled でオン/オフ。",
    input_schema: { type: "object", properties: { start_bar: { type: "integer", minimum: 1 }, end_bar: { type: "integer", minimum: 1 }, enabled: { type: "boolean" } }, additionalProperties: false },
    run(ctx, { start_bar, end_bar, enabled }) {
      ctx.store.commit("ループ範囲", (p) => {
        const s = start_bar != null ? start_bar - 1 : p.loop.startBar;
        const e = end_bar != null ? end_bar : p.loop.endBar;
        p.loop = { enabled: enabled ?? true, startBar: Math.max(0, s), endBar: Math.max(s + 1, e) };
        ensureLength(p, p.loop.endBar);
      });
      const l = ctx.store.project.loop;
      return { message: l.enabled ? `${l.startBar + 1}〜${l.endBar} 小節をループします。` : "ループをオフにしました。" };
    },
  },
  {
    name: "add_track",
    title: "トラック追加",
    description: `トラックを追加する。instrument は ${Object.keys(INSTRUMENTS).join(", ")} のいずれか。`,
    input_schema: { type: "object", properties: { name: { type: "string" }, instrument: { type: "string", enum: Object.keys(INSTRUMENTS) } }, required: ["instrument"], additionalProperties: false },
    run(ctx, { name, instrument }) {
      const inst = INSTRUMENT_ALIASES[instrument] || instrument;
      if (!INSTRUMENTS[inst]) throw new ActionError(`楽器「${instrument}」はありません（${Object.values(INSTRUMENTS).join("・")}）。`);
      const t = createTrack({ name, instrument: inst });
      ctx.store.commit("トラック追加", (p) => p.tracks.push(t));
      return { message: `トラック「${t.name}」（${INSTRUMENTS[inst]}）を追加しました。` };
    },
  },
  {
    name: "remove_track",
    title: "トラック削除",
    description: "トラックを削除する。",
    input_schema: { type: "object", properties: { track: trackProp }, required: ["track"], additionalProperties: false },
    run(ctx, { track }) {
      const t = requireTrack(ctx.store.project, track);
      ctx.store.commit("トラック削除", (p) => (p.tracks = p.tracks.filter((x) => x.id !== t.id)));
      return { message: `トラック「${t.name}」を削除しました。` };
    },
  },
  {
    name: "set_track",
    title: "トラック設定",
    description: "トラックの音量（0〜1）・ミュート・ソロ・楽器・名前を変更する。",
    input_schema: {
      type: "object",
      properties: { track: trackProp, volume: { type: "number", minimum: 0, maximum: 1 }, mute: { type: "boolean" }, solo: { type: "boolean" }, instrument: { type: "string", enum: Object.keys(INSTRUMENTS) }, name: { type: "string" } },
      required: ["track"],
      additionalProperties: false,
    },
    run(ctx, { track, volume, mute, solo, instrument, name }) {
      const t = requireTrack(ctx.store.project, track);
      const inst = instrument != null ? INSTRUMENT_ALIASES[instrument] || instrument : null;
      if (inst && !INSTRUMENTS[inst]) throw new ActionError(`楽器「${instrument}」はありません。`);
      const changes = [];
      ctx.store.commit("トラック設定", (p) => {
        const x = p.tracks.find((y) => y.id === t.id);
        if (volume != null) (x.volume = Math.max(0, Math.min(1, Number(volume)))), changes.push(`音量 ${Math.round(x.volume * 100)}%`);
        if (mute != null) (x.mute = !!mute), changes.push(mute ? "ミュート" : "ミュート解除");
        if (solo != null) (x.solo = !!solo), changes.push(solo ? "ソロ" : "ソロ解除");
        if (inst) (x.instrument = inst), changes.push(`楽器 ${INSTRUMENTS[inst]}`);
        if (name) (x.name = name), changes.push(`名前「${name}」`);
      });
      return { message: `「${t.name}」: ${changes.join("、") || "変更なし"}` };
    },
  },
  {
    name: "clear_track",
    title: "トラックを空に",
    description: "トラックのノートを消す。start_bar/bars を指定するとその範囲だけ。",
    input_schema: { type: "object", properties: { track: trackProp, start_bar: { type: "integer", minimum: 1 }, bars: { type: "integer", minimum: 1 } }, required: ["track"], additionalProperties: false },
    run(ctx, { track, start_bar, bars }) {
      const t = requireTrack(ctx.store.project, track);
      ctx.store.commit("ノート削除", (p) => {
        const x = p.tracks.find((y) => y.id === t.id);
        if (start_bar == null) x.notes = [];
        else clearRange(x, (start_bar - 1) * BEATS_PER_BAR, (start_bar - 1 + (bars ?? 1)) * BEATS_PER_BAR);
      });
      return { message: `「${t.name}」のノートを消しました。` };
    },
  },
  {
    name: "add_notes",
    title: "ノート入力",
    description: "トラックにノートを直接書き込む。pitch は 'C4'（中央ド）形式か MIDI 番号。start は曲頭からの拍（4分音符=1, 1小節=4拍, 0始まり）、duration は拍。replace=true なら書き込む範囲の既存ノートを消してから。",
    input_schema: {
      type: "object",
      properties: {
        track: trackProp,
        notes: {
          type: "array",
          items: {
            type: "object",
            properties: { pitch: { type: ["string", "integer"] }, start: { type: "number", minimum: 0 }, duration: { type: "number", exclusiveMinimum: 0 }, velocity: { type: "integer", minimum: 1, maximum: 127 } },
            required: ["pitch", "start", "duration"],
            additionalProperties: false,
          },
        },
        replace: { type: "boolean" },
      },
      required: ["track", "notes"],
      additionalProperties: false,
    },
    run(ctx, { track, notes, replace = false }) {
      const t = requireTrack(ctx.store.project, track);
      const parsed = notes.map((n) => {
        const pitch = parseNote(n.pitch);
        if (pitch == null) throw new ActionError(`音高「${n.pitch}」を解釈できません。`);
        return { pitch, start: Number(n.start), duration: Number(n.duration), velocity: n.velocity ?? 90 };
      });
      const clean = normalizeNotes(parsed);
      ctx.store.commit("ノート入力", (p) => {
        const x = p.tracks.find((y) => y.id === t.id);
        if (replace && clean.length) clearRange(x, Math.min(...clean.map((n) => n.start)), Math.max(...clean.map((n) => n.start + n.duration)));
        x.notes = normalizeNotes([...x.notes, ...clean]);
        ensureLength(p, Math.ceil(Math.max(...clean.map((n) => n.start + n.duration)) / BEATS_PER_BAR));
      });
      return { message: `「${t.name}」に ${clean.length} ノート書き込みました。` };
    },
  },
  {
    name: "write_chords",
    title: "コード進行を書く",
    description:
      "コード進行を設定し、コードトラックにボイシングして書き込む。chords はコード名（'Am7','F/A'）かディグリー（'vi','IVmaj7'）の配列。bars_per_chord は1コードの長さ（小節, 0.5なら2拍）。repeat で繰り返し回数。style はコードの弾き方。",
    input_schema: {
      type: "object",
      properties: {
        chords: { type: "array", items: { type: "string" }, minItems: 1 },
        start_bar: { type: "integer", minimum: 1 },
        bars_per_chord: { type: "number", enum: [0.5, 1, 2, 4] },
        repeat: { type: "integer", minimum: 1, maximum: 16 },
        style: { type: "string", enum: CHORD_STYLES },
        track: trackProp,
      },
      required: ["chords"],
      additionalProperties: false,
    },
    run(ctx, { chords, start_bar = 1, bars_per_chord = 1, repeat = 1, style = "block", track }) {
      const p0 = ctx.store.project;
      const symbols = resolveChordSymbols(chords, p0.key);
      const all = Array.from({ length: repeat }, () => symbols).flat();
      const startBar = start_bar - 1;
      const layout = layoutChords(all, { startBar, barsPerChord: bars_per_chord });
      const endBar = Math.ceil(startBar + all.length * bars_per_chord);
      let name;
      ctx.store.commit("コード進行", (p) => {
        ensureLength(p, endBar);
        const s = startBar * BEATS_PER_BAR;
        const e = endBar * BEATS_PER_BAR;
        p.chords = sortChords([...p.chords.filter((c) => c.bar * BEATS_PER_BAR + (c.beat || 0) < s || c.bar * BEATS_PER_BAR + (c.beat || 0) >= e), ...layout]);
        const t = ensureTrack(p, track, track ? "piano" : "piano", "コード");
        name = t.name;
        clearRange(t, s, e);
        t.notes = normalizeNotes([...t.notes, ...generateChordNotes(layout, style)]);
      });
      return { message: `${start_bar} 小節目から ${all.join(" → ")} を「${name}」に書きました（${style}）。` };
    },
  },
  {
    name: "apply_progression",
    title: "定番進行を使う",
    description: `定番のコード進行を現在のキーで書き込む。progression_id（${PROGRESSIONS.map((p) => `${p.id}=${p.name}`).join(", ")}）か mood（切ない, 明るい, 壮大, おしゃれ 等）で指定。`,
    input_schema: {
      type: "object",
      properties: {
        progression_id: { type: "string", enum: PROGRESSIONS.map((p) => p.id) },
        mood: { type: "string" },
        style: { type: "string", enum: CHORD_STYLES },
        bars_per_chord: { type: "number", enum: [0.5, 1, 2, 4] },
        start_bar: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    run(ctx, { progression_id, mood, style, bars_per_chord = 1, start_bar = 1 } = {}) {
      const list = suggestProgressions(mood, ctx.store.project.key);
      const prog = (progression_id && suggestProgressions(undefined, ctx.store.project.key).find((x) => x.id === progression_id)) || list[0];
      // 曲の長さに合わせて繰り返す
      const span = prog.chords.length * bars_per_chord;
      const repeat = Math.max(1, Math.floor((ctx.store.project.bars - (start_bar - 1)) / span));
      const r = findAction("write_chords").run(ctx, { chords: prog.chords, start_bar, bars_per_chord, repeat, style });
      return { message: `「${prog.name}」（${prog.roman.join("-")}）\n${r.message}` };
    },
  },
  {
    name: "append_chord",
    title: "コードを1つ追加",
    description: "既存のコード進行の最後に1小節分のコードを追加する。",
    input_schema: { type: "object", properties: { chord: { type: "string" }, style: { type: "string", enum: CHORD_STYLES } }, required: ["chord"], additionalProperties: false },
    run(ctx, { chord, style = "block" }) {
      const p = ctx.store.project;
      const chords = sortChords(p.chords);
      const last = chords[chords.length - 1];
      const nextBar = last ? Math.ceil((last.bar * BEATS_PER_BAR + (last.beat || 0) + (last.length ?? BEATS_PER_BAR)) / BEATS_PER_BAR) : 0;
      return findAction("write_chords").run(ctx, { chords: [chord], start_bar: nextBar + 1, style });
    },
  },
  {
    name: "generate_melody",
    title: "メロディ生成",
    description: "コード進行に合ったメロディを自動生成してトラックに書く。density は sparse/normal/busy。register は音域（low/mid/high）。seed を変えると別案。",
    input_schema: {
      type: "object",
      properties: {
        track: trackProp,
        start_bar: { type: "integer", minimum: 1 },
        bars: { type: "integer", minimum: 1 },
        density: { type: "string", enum: ["sparse", "normal", "busy"] },
        register: { type: "string", enum: ["low", "mid", "high"] },
        seed: { type: "integer" },
      },
      additionalProperties: false,
    },
    run(ctx, { track, start_bar = 1, bars, density = "normal", register = "mid", seed }) {
      const p0 = ctx.store.project;
      if (!p0.chords.length) throw new ActionError("先にコード進行を作ってください（例: 「王道進行で」）。");
      const [s, n] = barRange(p0, start_bar - 1, bars);
      const range = { low: [53, 72], mid: [60, 79], high: [67, 86] }[register] || [60, 79];
      const sd = seed ?? Math.floor(Math.random() * 1e9);
      let name;
      ctx.store.commit("メロディ生成", (p) => {
        const t = ensureTrack(p, track, "lead", "メロディ");
        name = t.name;
        clearRange(t, s * BEATS_PER_BAR, (s + n) * BEATS_PER_BAR);
        t.notes = normalizeNotes([...t.notes, ...generateMelody(p.chords, p.key, { startBar: s, bars: n, density, seed: sd, low: range[0], high: range[1] })]);
      });
      return { message: `「${name}」に ${s + 1}〜${s + n} 小節のメロディを生成しました（seed ${sd}）。` };
    },
  },
  {
    name: "generate_bass",
    title: "ベース生成",
    description: `コード進行からベースラインを生成する。style: ${BASS_STYLES.join(", ")}。`,
    input_schema: { type: "object", properties: { track: trackProp, style: { type: "string", enum: BASS_STYLES } }, additionalProperties: false },
    run(ctx, { track, style = "eighth" }) {
      if (!ctx.store.project.chords.length) throw new ActionError("先にコード進行を作ってください。");
      let name;
      ctx.store.commit("ベース生成", (p) => {
        const t = ensureTrack(p, track, "bass", "ベース");
        name = t.name;
        t.notes = normalizeNotes(generateBass(p.chords, style, { seed: Date.now() % 100000 }));
      });
      return { message: `「${name}」にベース（${style}）を生成しました。` };
    },
  },
  {
    name: "generate_drums",
    title: "ドラム生成",
    description: `ドラムパターンを生成する。style: ${DRUM_STYLES.join(", ")}（four=4つ打ち）。4小節ごとにフィルを入れる。`,
    input_schema: {
      type: "object",
      properties: { track: trackProp, style: { type: "string", enum: DRUM_STYLES }, start_bar: { type: "integer", minimum: 1 }, bars: { type: "integer", minimum: 1 }, fill: { type: "boolean" } },
      additionalProperties: false,
    },
    run(ctx, { track, style = "basic", start_bar = 1, bars, fill = true }) {
      const [s, n] = barRange(ctx.store.project, start_bar - 1, bars);
      let name;
      ctx.store.commit("ドラム生成", (p) => {
        const t = ensureTrack(p, track, "drums", "ドラム");
        name = t.name;
        clearRange(t, s * BEATS_PER_BAR, (s + n) * BEATS_PER_BAR);
        t.notes = normalizeNotes([...t.notes, ...generateDrums(style, { startBar: s, bars: n, fill })]);
      });
      return { message: `「${name}」に ${style} のドラムを ${n} 小節入れました。` };
    },
  },
  {
    name: "transpose",
    title: "移調",
    description: "トラック（省略時はドラム以外の全トラックとコード）を半音単位で移調する。",
    input_schema: { type: "object", properties: { semitones: { type: "integer", minimum: -24, maximum: 24 }, track: trackProp }, required: ["semitones"], additionalProperties: false },
    run(ctx, { semitones, track }) {
      const d = Math.round(semitones);
      if (track != null) {
        const t = requireTrack(ctx.store.project, track);
        ctx.store.commit("移調", (p) => {
          const x = p.tracks.find((y) => y.id === t.id);
          x.notes = normalizeNotes(x.notes.map((n) => ({ ...n, pitch: n.pitch + d })));
        });
        return { message: `「${t.name}」を ${d > 0 ? "+" : ""}${d} 半音移調しました。` };
      }
      ctx.store.commit("全体移調", (p) => {
        transposeAll(p, d);
        p.key = { ...p.key, root: (((p.key.root + d) % 12) + 12) % 12 };
      });
      return { message: `曲全体を ${d > 0 ? "+" : ""}${d} 半音移調しました（キー: ${keyNameJa(ctx.store.project.key)}）。` };
    },
  },
  {
    name: "quantize",
    title: "クオンタイズ",
    description: "ノートの開始位置をグリッドに揃える。grid は拍単位（0.25=16分, 0.5=8分, 1=4分）。strength 0〜1。",
    input_schema: { type: "object", properties: { track: trackProp, grid: { type: "number", enum: [0.125, 0.25, 0.5, 1] }, strength: { type: "number", minimum: 0, maximum: 1 } }, required: ["track"], additionalProperties: false },
    run(ctx, { track, grid = 0.25, strength = 1 }) {
      const t = requireTrack(ctx.store.project, track);
      ctx.store.commit("クオンタイズ", (p) => {
        const x = p.tracks.find((y) => y.id === t.id);
        x.notes = normalizeNotes(x.notes.map((n) => ({ ...n, start: n.start + (Math.round(n.start / grid) * grid - n.start) * strength })));
      });
      return { message: `「${t.name}」を ${grid} 拍グリッドでクオンタイズしました。` };
    },
  },
  {
    name: "humanize",
    title: "ヒューマナイズ",
    description: "ベロシティとタイミングをわずかに揺らして人間らしくする。amount 0〜1。",
    input_schema: { type: "object", properties: { track: trackProp, amount: { type: "number", minimum: 0, maximum: 1 } }, required: ["track"], additionalProperties: false },
    run(ctx, { track, amount = 0.5 }) {
      const t = requireTrack(ctx.store.project, track);
      ctx.store.commit("ヒューマナイズ", (p) => {
        const x = p.tracks.find((y) => y.id === t.id);
        x.notes = normalizeNotes(x.notes.map((n) => ({ ...n, start: n.start + (Math.random() - 0.5) * 0.04 * amount, velocity: n.velocity + Math.round((Math.random() - 0.5) * 24 * amount) })));
      });
      return { message: `「${t.name}」をヒューマナイズしました。` };
    },
  },
  {
    name: "suggest_progressions",
    title: "進行を提案",
    description: "ムード（例: 切ない, 明るい, 壮大, おしゃれ, ジャズ）に合うコード進行の候補を現在のキーで返す。曲は変更しない。",
    input_schema: { type: "object", properties: { mood: { type: "string" } }, additionalProperties: false },
    run(ctx, { mood } = {}) {
      const list = suggestProgressions(mood, ctx.store.project.key);
      return { message: list.map((s) => `${s.name}: ${s.chords.join(" → ")}`).join("\n"), data: list };
    },
  },
  {
    name: "suggest_next_chord",
    title: "次のコードを提案",
    description: "現在のコード進行の最後（または指定コード）の次に来やすいコードを理由付きで返す。曲は変更しない。",
    input_schema: { type: "object", properties: { after: { type: "string" } }, additionalProperties: false },
    run(ctx, { after } = {}) {
      const p = ctx.store.project;
      const chords = sortChords(p.chords);
      const prev = after ?? chords[chords.length - 1]?.symbol ?? null;
      const list = suggestNextChords(prev, p.key);
      return { message: `${prev ?? "（最初）"} の次の候補:\n` + list.map((s) => `・${s.chord} — ${s.reason}`).join("\n"), data: list };
    },
  },
  {
    name: "analyze",
    title: "曲を分析",
    description: "曲を分析し、所見・問題点・次にやるとよいことを返す。曲は変更しない。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run(ctx) {
      const a = analyzeProject(ctx.store.project);
      const lines = [...a.summary];
      if (a.issues.length) lines.push("", "気になる点:", ...a.issues.map((x) => "・" + x));
      if (a.ideas.length) lines.push("", "次の一手:", ...a.ideas.map((x) => "・" + x.label));
      return { message: lines.join("\n"), data: a };
    },
  },
  {
    name: "sketch",
    title: "おまかせスケッチ",
    description: "ムードとスタイルから、コード・メロディ・ベース・ドラムまで一気に作る（既存の内容は置き換え）。",
    input_schema: {
      type: "object",
      properties: { mood: { type: "string" }, bars: { type: "integer", enum: [4, 8, 16] }, drum_style: { type: "string", enum: DRUM_STYLES }, bpm: { type: "number" } },
      additionalProperties: false,
    },
    run(ctx, { mood, bars = 8, drum_style, bpm } = {}) {
      const p = ctx.store.project;
      const prog = suggestProgressions(mood, p.key)[0];
      const per = Math.max(1, Math.floor(bars / prog.chords.length));
      const repeat = Math.max(1, Math.round(bars / (prog.chords.length * per)));
      const drums = drum_style || guessDrumStyle(mood);
      const msgs = [];
      if (bpm) msgs.push(findAction("set_tempo").run(ctx, { bpm }).message);
      ctx.store.commit("スケッチ準備", (pp) => {
        pp.bars = bars;
        pp.loop = { enabled: true, startBar: 0, endBar: bars };
        pp.chords = [];
        for (const t of pp.tracks) t.notes = [];
      });
      msgs.push(findAction("write_chords").run(ctx, { chords: prog.chords, bars_per_chord: per, repeat, style: drums === "ballad" ? "arpeggio" : "pop" }).message);
      msgs.push(findAction("generate_melody").run(ctx, {}).message);
      msgs.push(findAction("generate_bass").run(ctx, { style: drums === "four" ? "octave" : drums === "ballad" ? "root" : "eighth" }).message);
      msgs.push(findAction("generate_drums").run(ctx, { style: drums }).message);
      return { message: `「${prog.name}」でスケッチを作りました。\n` + msgs.join("\n") };
    },
  },
  {
    name: "transport",
    title: "再生/停止",
    description: "再生・停止を操作する。",
    input_schema: { type: "object", properties: { command: { type: "string", enum: ["play", "stop", "toggle"] } }, required: ["command"], additionalProperties: false },
    run(ctx, { command }) {
      if (!ctx.transport) return { message: "（この環境では再生できません）" };
      const playing = ctx.transport.isPlaying();
      if (command === "play" || (command === "toggle" && !playing)) {
        ctx.transport.play();
        return { message: "再生します。" };
      }
      ctx.transport.stop();
      return { message: "停止しました。" };
    },
  },
  {
    name: "undo",
    title: "元に戻す",
    description: "直前の変更を取り消す。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run(ctx) {
      const label = ctx.store.undo();
      return { message: label ? `「${label}」を取り消しました。` : "取り消せる操作がありません。" };
    },
  },
  {
    name: "redo",
    title: "やり直し",
    description: "取り消した変更をやり直す。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run(ctx) {
      const label = ctx.store.redo();
      return { message: label ? `「${label}」をやり直しました。` : "やり直せる操作がありません。" };
    },
  },
  {
    name: "export_midi",
    title: "MIDI 書き出し",
    description: "曲を Standard MIDI File として書き出す（ダウンロード）。track を指定するとそのパートだけ書き出す（Studio Pro にパート単位でドラッグする用）。",
    input_schema: { type: "object", properties: { track: trackProp }, additionalProperties: false },
    run(ctx, { track } = {}) {
      if (!ctx.exportMidi) return { message: "（この環境では書き出せません）" };
      const t = track != null ? requireTrack(ctx.store.project, track) : null;
      const file = ctx.exportMidi(t ? [t.id] : undefined);
      return { message: `MIDI ファイル「${file}」を書き出しました。Studio Pro のアレンジビューにドラッグすると読み込めます。` };
    },
  },

  // ---------- 参考曲ライブラリ ----------
  {
    name: "library_list",
    title: "参考曲ライブラリを見る",
    description: "読み込んだ参考曲（MIDI）の一覧と、検出したキー・代表的なコード進行・抽出できた型の数を返す。query で曲名・タグを絞り込み。",
    input_schema: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false },
    run(ctx, { query } = {}) {
      const songs = requireLibrary(ctx, query, false);
      if (!songs.length) return { message: "参考曲ライブラリは空です。「⋯ → 参考曲ライブラリ」から MIDI ファイルを読み込んでください。" };
      const lines = songs.map((s) => {
        const d = describeSong(s);
        return `・${s.name}${s.tags.length ? ` [${s.tags.join(", ")}]` : ""}: ${d.key}, ${s.bpm}BPM, ${s.bars}小節, 進行 ${d.progression}（${d.counts}）`;
      });
      return { message: `参考曲 ${songs.length} 曲\n${lines.join("\n")}` };
    },
  },
  {
    name: "library_progression",
    title: "参考曲からコード進行",
    description:
      "参考曲ライブラリから学んだコード進行を、今のキーに移して書き込む。method=loop は参考曲によく出る 4 小節ループを使う、markov は複数曲のコードの流れを学習して新しい進行を作る。source で曲名・タグを絞り込み（省略時は全曲）。",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string" },
        method: { type: "string", enum: ["loop", "markov"] },
        bars: { type: "integer", minimum: 1, maximum: 64 },
        start_bar: { type: "integer", minimum: 1 },
        style: { type: "string", enum: CHORD_STYLES },
        seed: { type: "integer" },
      },
      additionalProperties: false,
    },
    run(ctx, { source, method = "loop", bars, start_bar = 1, style = "block", seed } = {}) {
      const songs = requireLibrary(ctx, source);
      const p0 = ctx.store.project;
      const n = bars ?? Math.max(4, p0.bars - (start_bar - 1));
      const sd = seed ?? Math.floor(Math.random() * 1e9);
      const res = learnedProgression(songs, p0.key, { method, bars: n, seed: sd, startBar: start_bar - 1 });
      if (!res || !res.chords.length) throw new ActionError("参考曲からコード進行を取り出せませんでした（コードが検出できる曲を入れてください）。");
      let name;
      ctx.store.commit("参考曲から進行", (p) => {
        const s = (start_bar - 1) * BEATS_PER_BAR;
        const e = (start_bar - 1 + n) * BEATS_PER_BAR;
        ensureLength(p, start_bar - 1 + n);
        p.chords = sortChords([...p.chords.filter((c) => c.bar * BEATS_PER_BAR + (c.beat || 0) < s || c.bar * BEATS_PER_BAR + (c.beat || 0) >= e), ...res.chords]);
        const t = ensureTrack(p, undefined, "piano", "コード");
        name = t.name;
        clearRange(t, s, e);
        t.notes = normalizeNotes([...t.notes, ...generateChordNotes(res.chords, style)]);
      });
      return { message: `参考曲（${res.source}）の${method === "markov" ? "流れから作った" : ""}進行 ${res.roman.slice(0, 8).join(" - ")} を「${name}」に書きました: ${res.chords.map((c) => c.symbol).join(" → ")}（seed ${sd}）` };
    },
  },
  {
    name: "library_arrange",
    title: "参考曲の型でアレンジ",
    description:
      "参考曲ライブラリから学んだ型で、今のコード進行に合わせてパートを作る。parts: drums=グルーヴとフィル, bass=ベースのリズムとコード上の動き, comping=バッキングのリズム, melody=メロディのリズムと輪郭（音は今のコードに合わせて作り直す）。source で曲名・タグを絞り込み。seed を変えると別案。",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string" },
        parts: { type: "array", items: { type: "string", enum: ["drums", "bass", "comping", "melody"] }, minItems: 1 },
        start_bar: { type: "integer", minimum: 1 },
        bars: { type: "integer", minimum: 1 },
        seed: { type: "integer" },
      },
      additionalProperties: false,
    },
    run(ctx, { source, parts = ["drums", "bass", "comping"], start_bar = 1, bars, seed } = {}) {
      const songs = requireLibrary(ctx, source);
      const p0 = ctx.store.project;
      const [s, n] = barRange(p0, start_bar - 1, bars);
      const needsChords = parts.some((x) => x !== "drums");
      if (needsChords && !p0.chords.length) throw new ActionError("先にコード進行を作ってください（「参考曲から進行」も使えます）。");
      const sd = seed ?? Math.floor(Math.random() * 1e9);
      const opts = { startBar: s, bars: n, seed: sd };
      const results = {
        drums: parts.includes("drums") ? learnedDrums(songs, opts) : undefined,
        bass: parts.includes("bass") ? learnedBass(songs, p0.chords, opts) : undefined,
        comping: parts.includes("comping") ? learnedComping(songs, p0.chords, opts) : undefined,
        melody: parts.includes("melody") ? learnedMelody(songs, p0.chords, p0.key, opts) : undefined,
      };
      const target = { drums: ["drums", "ドラム"], bass: ["bass", "ベース"], comping: ["piano", "コード"], melody: ["lead", "メロディ"] };
      const done = [];
      const missing = [];
      ctx.store.commit("参考曲でアレンジ", (p) => {
        for (const part of parts) {
          const r = results[part];
          if (!r || !r.notes.length) {
            missing.push(part);
            continue;
          }
          const [inst, defName] = target[part];
          const t = ensureTrack(p, undefined, inst, defName);
          clearRange(t, s * BEATS_PER_BAR, (s + n) * BEATS_PER_BAR);
          t.notes = normalizeNotes([...t.notes, ...r.notes]);
          done.push(`${PART_JA[part]}→「${t.name}」`);
        }
      });
      if (!done.length) throw new ActionError(`参考曲に使える ${missing.map((x) => PART_JA[x]).join("・")} の型がありませんでした。`);
      return {
        message: `参考曲（${songs.map((x) => x.name).slice(0, 3).join("・")}${songs.length > 3 ? " ほか" : ""}）の型で ${s + 1}〜${s + n} 小節を作りました: ${done.join("、")}${missing.length ? `（${missing.map((x) => PART_JA[x]).join("・")}は型が無く省略）` : ""}。seed ${sd}`,
      };
    },
  },

  // ---------- Fender Studio Pro のリモート操作 ----------
  {
    name: "studio_pro",
    title: "Studio Pro を操作",
    description:
      `Fender Studio Pro を Mackie Control 経由で操作する。command: ${Object.keys(MCU_BUTTONS).join(", ")}（トランスポートや画面操作のボタン）, ` +
      `track_select / track_mute / track_solo / track_arm（track 番号が必要）, fader（track 番号か 0=マスター と value 0〜1 または db）, bank_reset（バンク位置の推定をトラック 1〜8 に戻す）。` +
      "トラック番号は Studio Pro のミキサーでの並び順（1 始まり）で、このアプリのトラック番号とは別。",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", enum: [...Object.keys(MCU_BUTTONS), "track_select", "track_mute", "track_solo", "track_arm", "fader", "bank_reset"] },
        track: { type: "integer", minimum: 0 },
        value: { type: "number", minimum: 0, maximum: 1 },
        db: { type: "number", minimum: -60, maximum: 6 },
      },
      required: ["command"],
      additionalProperties: false,
    },
    run(ctx, { command, track, value, db }) {
      const sp = ctx.studio;
      if (!sp) throw new ActionError("この環境では Studio Pro を操作できません。");
      if (!sp.connected) throw new ActionError("Studio Pro 操作用の MIDI ポートが未設定です。「⋯ → 設定」で選び、Studio Pro 側でそのポートを Mackie Control として追加してください。");
      try {
        if (command === "bank_reset") {
          sp.resetBank();
          return { message: "Studio Pro: バンク位置をトラック 1〜8 に戻しました。" };
        }
        if (command.startsWith("track_")) {
          if (!(track >= 1)) throw new ActionError("トラック番号（1 以上）を指定してください。");
          const label = sp.strip(command.slice(6), track);
          return { message: `Studio Pro: トラック ${track} を${label}。` };
        }
        if (command === "fader") {
          if (track == null) throw new ActionError("フェーダーを動かすトラック番号（0=マスター）を指定してください。");
          const v = db != null ? dbToFader(db) : value;
          if (v == null) throw new ActionError("value（0〜1）か db を指定してください。");
          sp.fader(track === 0 ? "master" : track, v);
          return { message: `Studio Pro: ${track === 0 ? "マスター" : `トラック ${track}`} のフェーダーを ${db != null ? `${db}dB 付近` : `${Math.round(v * 100)}%`} にしました。` };
        }
        const label = sp.press(command);
        return { message: `Studio Pro: ${label}` };
      } catch (e) {
        if (e instanceof ActionError) throw e;
        throw new ActionError(e.message);
      }
    },
  },
];

function transposeAll(p, d) {
  for (const t of p.tracks) {
    if (t.instrument === "drums") continue;
    t.notes = normalizeNotes(t.notes.map((n) => ({ ...n, pitch: n.pitch + d })));
  }
  p.chords = p.chords.map((c) => {
    const ch = parseChord(c.symbol);
    if (!ch) return c;
    const key = { root: (((p.key.root + d) % 12) + 12) % 12, mode: p.key.mode };
    const root = (((ch.root + d) % 12) + 12) % 12;
    const bass = ch.bass != null ? (((ch.bass + d) % 12) + 12) % 12 : null;
    return { ...c, symbol: chordSymbol(root, ch.quality, key, bass) };
  });
}

function guessDrumStyle(mood = "") {
  if (/バラード|悲し|優し|ballad/i.test(mood)) return "ballad";
  if (/ダンス|EDM|ハウス|4つ打ち|シティ/i.test(mood)) return "four";
  if (/ロック|疾走|rock/i.test(mood)) return "rock";
  if (/チル|ローファイ|lo-?fi|ヒップホップ|hip/i.test(mood)) return "hiphop";
  if (/ジャズ|ブルース/.test(mood)) return "shuffle";
  if (/壮大|エピック/.test(mood)) return "halftime";
  return "basic";
}

const PART_JA = { drums: "ドラム", bass: "ベース", comping: "バッキング", melody: "メロディ" };

function requireLibrary(ctx, query, mustHave = true) {
  if (!ctx.library) throw new ActionError("この環境では参考曲ライブラリを使えません。");
  const all = ctx.library.songs;
  if (mustHave && !all.length) throw new ActionError("参考曲ライブラリが空です。「⋯ → 参考曲ライブラリ」からプロの曲などの MIDI ファイルを読み込んでください。");
  const hit = ctx.library.find(query);
  if (mustHave && query && !hit.length) throw new ActionError(`「${query}」に当てはまる参考曲がありません（${all.map((x) => x.name).slice(0, 5).join("、")} など）。`);
  return hit;
}

export function findAction(name) {
  return ACTIONS.find((a) => a.name === name);
}

/** アクションを実行。失敗してもエラーメッセージを返す */
export function runAction(ctx, name, input = {}) {
  const action = findAction(name);
  if (!action) return { ok: false, message: `不明な操作: ${name}` };
  try {
    const r = action.run(ctx, input || {});
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: `エラー: ${e.message}` };
  }
}

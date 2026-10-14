// daw/ で `npm test`（node --test）で実行。依存パッケージ不要
import test from "node:test";
import assert from "node:assert/strict";

import { parseKey, parseChord, parseNote, romanToChord, diatonicTriads, chordPcs, suggestNextChords, detectKey, scalePcs, keyName } from "../js/theory.js";
import { generateChordNotes, generateBass, generateMelody, generateDrums, layoutChords, voiceChord } from "../js/generate.js";
import { Store, createDefaultProject, findTrack } from "../js/project.js";
import { runAction, ACTIONS } from "../js/actions.js";
import { parseCommand, extractChordList } from "../js/operator.js";
import { projectToMidi } from "../js/midi.js";
import { toolDefinitions } from "../js/claude.js";

const newCtx = () => ({ store: new Store(createDefaultProject()) });

test("キーの解析", () => {
  assert.deepEqual(parseKey("Am"), { root: 9, mode: "minor" });
  assert.deepEqual(parseKey("C"), { root: 0, mode: "major" });
  assert.deepEqual(parseKey("F# minor"), { root: 6, mode: "minor" });
  assert.deepEqual(parseKey("Eb major"), { root: 3, mode: "major" });
  assert.deepEqual(parseKey("ハ長調"), { root: 0, mode: "major" });
  assert.deepEqual(parseKey("イ短調"), { root: 9, mode: "minor" });
  assert.deepEqual(parseKey("変ロ長調"), { root: 10, mode: "major" });
  assert.equal(parseKey("H"), null);
});

test("コードの解析", () => {
  assert.deepEqual(chordPcs("Am7"), [9, 0, 4, 7]);
  assert.deepEqual(chordPcs("Fmaj7"), [5, 9, 0, 4]);
  assert.deepEqual(chordPcs("Bm7b5"), [11, 2, 5, 9]);
  assert.equal(parseChord("C/E").bass, 4);
  assert.equal(parseChord("Gsus4").quality, "sus4");
  assert.equal(parseChord("Xyz"), null);
  assert.equal(parseNote("C4"), 60);
  assert.equal(parseNote("A4"), 69);
  assert.equal(parseNote("Bb3"), 58);
  assert.equal(parseNote("Cb4"), 59);
});

test("ディグリー → コード", () => {
  const C = { root: 0, mode: "major" };
  assert.equal(romanToChord("vi", C), "Am");
  assert.equal(romanToChord("IVmaj7", C), "Fmaj7");
  assert.equal(romanToChord("V7", C), "G7");
  assert.equal(romanToChord("bVII", C), "Bb");
  assert.equal(romanToChord("vii°", C), "Bdim");
  assert.equal(romanToChord("III7", C), "E7");
  const Am = { root: 9, mode: "minor" };
  assert.equal(romanToChord("i", Am), "Am");
  assert.equal(romanToChord("VI", Am), "F");
  assert.equal(romanToChord("VII", Am), "G");
  assert.deepEqual(diatonicTriads(C), ["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
  assert.deepEqual(diatonicTriads({ root: 5, mode: "major" }), ["F", "Gm", "Am", "Bb", "C", "Dm", "Edim"]);
});

test("次のコード提案は機能和声に沿う", () => {
  const C = { root: 0, mode: "major" };
  const afterG = suggestNextChords("G", C).map((s) => s.chord);
  assert.equal(afterG[0], "C");
  assert.ok(afterG.includes("Am"));
  const afterDm = suggestNextChords("Dm", C).map((s) => s.chord);
  assert.equal(afterDm[0], "G");
});

test("キー推定", () => {
  const notes = [57, 60, 64, 57, 59, 60, 62, 64, 65, 64, 62, 60, 59, 57, 57, 57].map((pitch) => ({ pitch, duration: 1 }));
  assert.equal(keyName(detectKey(notes)), "Am");
});

test("ボイシングは前のコードとの移動が小さい", () => {
  const c = voiceChord("C");
  const f = voiceChord("F", c);
  const move = f.reduce((a, n) => a + Math.min(...c.map((p) => Math.abs(p - n))), 0);
  assert.ok(move <= 5, `移動量 ${move}`);
});

test("生成されたフレーズはキー／コードに沿う", () => {
  const key = { root: 0, mode: "major" };
  const chords = layoutChords(["C", "G", "Am", "F"]);
  const scale = scalePcs(key);
  const melody = generateMelody(chords, key, { bars: 4, seed: 42 });
  assert.ok(melody.length >= 8);
  assert.ok(melody.every((n) => scale.includes(n.pitch % 12)), "メロディはスケール内");
  assert.ok(melody.every((n) => n.start >= 0 && n.start < 16));
  // 再現性
  assert.deepEqual(generateMelody(chords, key, { bars: 4, seed: 42 }), melody);
  // 最後の音はコードのルートか3度
  const last = melody[melody.length - 1];
  assert.ok([5, 9].includes(last.pitch % 12), `最後の音 ${last.pitch}`);

  const bass = generateBass(chords, "root");
  assert.deepEqual(bass.map((n) => n.pitch % 12), [0, 7, 9, 5]);
  assert.ok(bass.every((n) => n.pitch >= 28 && n.pitch <= 48));
  for (const style of ["eighth", "octave", "walking", "synco"]) assert.ok(generateBass(chords, style).length > 4, style);

  const pad = generateChordNotes(chords, "block");
  assert.equal(pad.length, 12);
  assert.ok(generateChordNotes(chords, "arpeggio").length > 12);

  const drums = generateDrums("four", { bars: 4 });
  assert.ok(drums.some((n) => n.pitch === 36 && n.start === 1));
});

test("アクション: コード→メロディ→ベース→ドラム", () => {
  const ctx = newCtx();
  let r = runAction(ctx, "write_chords", { chords: ["vi", "IV", "V", "I"], repeat: 2 });
  assert.ok(r.ok, r.message);
  const p = ctx.store.project;
  assert.deepEqual(p.chords.map((c) => c.symbol), ["Am", "F", "G", "C", "Am", "F", "G", "C"]);
  assert.ok(findTrack(p, "コード").notes.length > 0);
  for (const [name, input] of [["generate_melody", { seed: 3 }], ["generate_bass", { style: "walking" }], ["generate_drums", { style: "rock" }]]) {
    r = runAction(ctx, name, input);
    assert.ok(r.ok, `${name}: ${r.message}`);
  }
  assert.ok(findTrack(p, "メロディ").notes.length > 0);
  assert.ok(findTrack(p, "ベース").notes.length > 0);
  assert.ok(findTrack(p, "ドラム").notes.length > 0);
  r = runAction(ctx, "analyze");
  assert.ok(r.ok && r.message.includes("キー"));
});

test("アクション: Undo / 移調 / エラー", () => {
  const ctx = newCtx();
  runAction(ctx, "set_tempo", { bpm: 140 });
  assert.equal(ctx.store.project.bpm, 140);
  runAction(ctx, "set_tempo", { bpm: "+10" });
  assert.equal(ctx.store.project.bpm, 150);
  runAction(ctx, "undo");
  runAction(ctx, "undo");
  assert.equal(ctx.store.project.bpm, 110);
  runAction(ctx, "redo");
  assert.equal(ctx.store.project.bpm, 140);

  runAction(ctx, "write_chords", { chords: ["C", "G"] });
  runAction(ctx, "transpose", { semitones: 2 });
  assert.deepEqual(ctx.store.project.chords.map((c) => c.symbol), ["D", "A"]);
  assert.equal(ctx.store.project.key.root, 2);

  assert.equal(runAction(ctx, "set_tempo", { bpm: 5 }).ok, false);
  assert.equal(runAction(ctx, "write_chords", { chords: ["Hm"] }).ok, false);
  assert.equal(runAction(ctx, "remove_track", { track: "存在しない" }).ok, false);
  assert.equal(runAction(ctx, "nope").ok, false);
});

test("アクション: ノート直接入力とスケッチ", () => {
  const ctx = newCtx();
  const r = runAction(ctx, "add_notes", { track: "メロディ", notes: [{ pitch: "E5", start: 0, duration: 1 }, { pitch: 74, start: 1, duration: 0.5, velocity: 70 }] });
  assert.ok(r.ok, r.message);
  assert.deepEqual(findTrack(ctx.store.project, "メロディ").notes.map((n) => n.pitch), [76, 74]);
  const s = runAction(ctx, "sketch", { mood: "切ない", bars: 8 });
  assert.ok(s.ok, s.message);
  assert.equal(ctx.store.project.bars, 8);
  assert.ok(ctx.store.project.tracks.every((t) => t.notes.length > 0));
  // 8小節を超えるノートが無い
  assert.ok(ctx.store.project.tracks.every((t) => t.notes.every((n) => n.start < 32)));
});

test("日本語コマンドの解析", () => {
  const steps = (text) => parseCommand(text).steps.map((s) => [s.action, s.input]);
  assert.deepEqual(steps("テンポ120"), [["set_tempo", { bpm: 120 }]]);
  assert.equal(steps("キーをAmに")[0][1].key, "Am");
  assert.equal(steps("ハ短調にして")[0][0], "set_key");
  assert.deepEqual(steps("コード Am F C G")[0][1].chords, ["Am", "F", "C", "G"]);
  assert.deepEqual(steps("進行 I V vi IV アルペジオで")[0][1], { chords: ["I", "V", "vi", "IV"], start_bar: undefined, bars_per_chord: undefined, style: "arpeggio" });
  assert.equal(steps("王道進行で")[0][1].progression_id, "royal");
  assert.equal(steps("切ない進行にして")[0][0], "apply_progression");
  assert.equal(steps("メロディを作って")[0][0], "generate_melody");
  assert.equal(steps("メロディを高めで細かく作って")[0][1].register, "high");
  assert.equal(steps("ベースをウォーキングで")[0][1].style, "walking");
  assert.equal(steps("ドラムを4つ打ちで")[0][1].style, "four");
  assert.deepEqual(steps("メロディを+2移調")[0], ["transpose", { semitones: 2, track: "メロディ" }]);
  assert.deepEqual(steps("ベースを1オクターブ下げて")[0], ["transpose", { semitones: -12, track: "ベース" }]);
  assert.deepEqual(steps("ドラムをミュート")[0], ["set_track", { track: "ドラム", mute: true }]);
  assert.deepEqual(steps("3〜4小節をループ")[0], ["set_loop", { start_bar: 3, end_bar: 4 }]);
  assert.deepEqual(steps("16小節にして")[0], ["set_length", { bars: 16 }]);
  assert.equal(steps("おまかせで切ない曲を16小節")[0][1].bars, 16);
  assert.equal(steps("再生")[0][1].command, "play");
  assert.equal(steps("元に戻す")[0][0], "undo");
  assert.equal(steps("ＭＩＤＩ書き出し")[0][0], "export_midi");
  // 複数文
  const multi = parseCommand("テンポ90。王道進行で。メロディ作って");
  assert.deepEqual(multi.steps.map((s) => s.action), ["set_tempo", "apply_progression", "generate_melody"]);
  assert.deepEqual(parseCommand("ぴよぴよ").unknown, ["ぴよぴよ"]);
  assert.equal(parseCommand("ヘルプ").help, true);
  assert.equal(extractChordList("メロディを作って"), null);
});

test("オペレーター経由で実行できる", () => {
  const ctx = newCtx();
  for (const s of parseCommand("キーをDに。王道進行で。ベースを8分で。ドラムをロックで").steps) {
    const r = runAction(ctx, s.action, s.input);
    assert.ok(r.ok, `${s.action}: ${r.message}`);
  }
  assert.equal(ctx.store.project.chords[0].symbol, "Gmaj7");
});

test("MIDI 書き出し", () => {
  const ctx = newCtx();
  runAction(ctx, "sketch", { mood: "明るい", bars: 4 });
  const bytes = projectToMidi(ctx.store.project);
  const text = String.fromCharCode(...bytes.slice(0, 4));
  assert.equal(text, "MThd");
  assert.equal((bytes[8] << 8) | bytes[9], 1, "SMF format 1");
  assert.equal((bytes[10] << 8) | bytes[11], ctx.store.project.tracks.length + 1);
  // 各トラックが End of Track で終わる
  let count = 0;
  for (let i = 14; i < bytes.length; ) {
    assert.equal(String.fromCharCode(...bytes.slice(i, i + 4)), "MTrk");
    const len = (bytes[i + 4] << 24) | (bytes[i + 5] << 16) | (bytes[i + 6] << 8) | bytes[i + 7];
    const end = i + 8 + len;
    assert.deepEqual([...bytes.slice(end - 3, end)], [0xff, 0x2f, 0x00]);
    i = end;
    count++;
  }
  assert.equal(count, ctx.store.project.tracks.length + 1);
});

test("Claude ツール定義はアクションと一致", () => {
  const defs = toolDefinitions();
  assert.equal(defs.length, ACTIONS.length);
  for (const d of defs) {
    assert.match(d.name, /^[a-z_]+$/);
    assert.equal(d.input_schema.type, "object");
    assert.ok(d.description.length > 5);
  }
});

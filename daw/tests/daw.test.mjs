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

// ---------------- 参考曲ライブラリ ----------------
import { parseMidi } from "../js/midi.js";
import { analyzeSong, detectChord, intervalToRoman, Library, learnedProgression } from "../js/library.js";
import { StudioProRemote, buttonMessages, faderMessages, MCU_BUTTONS } from "../js/studiopro.js";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

/** 参考曲の代わりに、このアプリで作った曲を MIDI 経由で解析する */
function referenceSong() {
  const ctx = newCtx();
  runAction(ctx, "set_key", { key: "Eb" });
  runAction(ctx, "set_tempo", { bpm: 96 });
  runAction(ctx, "write_chords", { chords: ["vi7", "IVmaj7", "V", "I"], repeat: 2, style: "pop" });
  runAction(ctx, "generate_melody", { seed: 5 });
  runAction(ctx, "generate_bass", { style: "synco" });
  runAction(ctx, "generate_drums", { style: "hiphop" });
  return analyzeSong(parseMidi(projectToMidi(ctx.store.project)), "参考A");
}

test("MIDI の読み書きが往復する", () => {
  const ctx = newCtx();
  runAction(ctx, "sketch", { mood: "明るい", bars: 4, bpm: 128 });
  const p = ctx.store.project;
  const midi = parseMidi(projectToMidi(p));
  assert.equal(midi.bpm, 128);
  assert.equal(midi.tracks.length, p.tracks.length);
  for (const t of p.tracks) {
    const back = midi.tracks.find((x) => x.name === t.name);
    assert.ok(back, t.name);
    assert.equal(back.notes.length, t.notes.length);
    assert.equal(back.channel === 9, t.instrument === "drums");
  }
  // パート単位の書き出し
  const one = parseMidi(projectToMidi(p, { trackIds: [p.tracks[2].id] }));
  assert.equal(one.tracks.length, 1);
  assert.equal(one.tracks[0].name, p.tracks[2].name);
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3, 4])));
});

test("コード検出とディグリー表記", () => {
  const notes = [48, 64, 67, 72].map((pitch) => ({ pitch, start: 0, duration: 4 })); // C E G C
  assert.deepEqual(detectChord(notes, 0, 4) && [detectChord(notes, 0, 4).root, detectChord(notes, 0, 4).quality], [0, ""]);
  const am7 = [45, 60, 64, 67].map((pitch) => ({ pitch, start: 0, duration: 4 }));
  const d = detectChord(am7, 0, 4);
  assert.deepEqual([d.root, d.quality], [9, "m7"]);
  assert.equal(intervalToRoman(9, "m7"), "vi7");
  assert.equal(intervalToRoman(10, ""), "bVII");
  assert.equal(intervalToRoman(5, "maj7"), "IVmaj7");
});

test("参考曲の解析", () => {
  const song = referenceSong();
  assert.deepEqual(song.key, { root: 3, mode: "major" });
  assert.equal(song.bpm, 96);
  const roles = Object.fromEntries(song.parts.map((p) => [p.role, p.name]));
  assert.equal(roles.drums, "ドラム");
  assert.equal(roles.bass, "ベース");
  assert.equal(roles.melody, "メロディ");
  assert.equal(roles.chords, "コード");
  assert.deepEqual(song.progressions[0].chords.map((c) => c.interval), [9, 5, 7, 0]);
  assert.ok(song.grooves.length >= 1 && song.bassPatterns.length >= 1 && song.compPatterns.length >= 1 && song.melodyPatterns.length >= 1);
});

test("参考曲の型を別のキーに当てはめる", () => {
  const song = referenceSong();
  // 長調の曲 → 短調のプロジェクトでは平行調で読み替える（vi7 → Am のキーでは i7 = Am7）
  const res = learnedProgression([song], { root: 9, mode: "minor" }, { bars: 4 });
  assert.deepEqual(res.chords.map((c) => c.symbol), ["Am7", "Fmaj7", "G", "C"]);

  const ctx = { ...newCtx(), library: new Library(memoryStorage()) };
  assert.equal(runAction(ctx, "library_arrange", {}).ok, false, "空のライブラリ");
  ctx.library.add(song);
  ctx.library.setTags(song.id, ["ローファイ"]);
  runAction(ctx, "set_key", { key: "G" });
  let r = runAction(ctx, "library_progression", { source: "ローファイ", seed: 1 });
  assert.ok(r.ok, r.message);
  assert.deepEqual(ctx.store.project.chords.slice(0, 4).map((c) => c.symbol), ["Em7", "Cmaj7", "D", "G"]);
  r = runAction(ctx, "library_arrange", { parts: ["drums", "bass", "comping", "melody"], seed: 2 });
  assert.ok(r.ok, r.message);
  const p = ctx.store.project;
  const scale = [7, 9, 11, 0, 2, 4, 6];
  const mel = findTrack(p, "メロディ").notes;
  assert.ok(mel.length > 8);
  assert.ok(mel.every((n) => scale.includes(n.pitch % 12)), "メロディは G メジャーのスケール内");
  const bass = findTrack(p, "ベース").notes;
  assert.ok(bass.length > 8 && bass.every((n) => n.pitch >= 28 && n.pitch <= 55));
  assert.ok(findTrack(p, "ドラム").notes.length > 16);
  assert.equal(runAction(ctx, "library_arrange", { source: "存在しない" }).ok, false);
  assert.ok(runAction(ctx, "library_list", {}).message.includes("参考A"));

  // 保存と復元
  const json = ctx.library.exportJSON();
  const lib2 = new Library(memoryStorage());
  assert.equal(lib2.importJSON(json), 1);
  assert.equal(lib2.importJSON(json), 0, "重複は追加しない");
});

test("Studio Pro リモート（Mackie Control）", () => {
  const sent = [];
  const sp = new StudioProRemote();
  const ctx = { ...newCtx(), studio: sp };
  assert.equal(runAction(ctx, "studio_pro", { command: "play" }).ok, false, "ポート未設定");
  sp.setOutput({ name: "IAC", send: (m) => sent.push(m) });
  assert.ok(runAction(ctx, "studio_pro", { command: "play" }).ok);
  assert.deepEqual(sent.splice(0), buttonMessages(MCU_BUTTONS.play.note));
  assert.deepEqual(buttonMessages(0x5e), [[0x90, 0x5e, 127], [0x90, 0x5e, 0]]);
  // トラック 3 のミュート = ストリップ 3（0x10 + 2）
  runAction(ctx, "studio_pro", { command: "track_mute", track: 3 });
  assert.deepEqual(sent.splice(0), [[0x90, 0x12, 127], [0x90, 0x12, 0]]);
  // トラック 10 → バンクを 1 つ右に送ってからストリップ 2
  runAction(ctx, "studio_pro", { command: "track_solo", track: 10 });
  assert.deepEqual(sent.splice(0), [[0x90, 0x2f, 127], [0x90, 0x2f, 0], [0x90, 0x09, 127], [0x90, 0x09, 0]]);
  // トラック 1 に戻る → バンク左
  runAction(ctx, "studio_pro", { command: "track_select", track: 1 });
  assert.deepEqual(sent.splice(0), [[0x90, 0x2e, 127], [0x90, 0x2e, 0], [0x90, 0x18, 127], [0x90, 0x18, 0]]);
  // フェーダー: タッチ → ピッチベンド → リリース
  assert.deepEqual(faderMessages(0, 1), [[0x90, 0x68, 127], [0xe0, 0x7f, 0x7f], [0x90, 0x68, 0]]);
  runAction(ctx, "studio_pro", { command: "fader", track: 0, value: 0.5 });
  assert.deepEqual(sent.splice(0)[1], [0xe8, 0x00, 0x40]);
  assert.equal(runAction(ctx, "studio_pro", { command: "track_mute" }).ok, false);
});

test("参考曲・Studio Pro の日本語コマンド", () => {
  const steps = (text) => parseCommand(text).steps.map((s) => [s.action, s.input]);
  assert.deepEqual(steps("スタジオプロで再生")[0], ["studio_pro", { command: "play" }]);
  assert.deepEqual(steps("Studio Proで録音して")[0], ["studio_pro", { command: "record" }]);
  assert.deepEqual(steps("スタジオプロのトラック3をミュート")[0], ["studio_pro", { command: "track_mute", track: 3 }]);
  assert.deepEqual(steps("スタジオプロのトラック2を録音待機")[0], ["studio_pro", { command: "track_arm", track: 2 }]);
  assert.deepEqual(steps("スタジオプロのトラック2の音量を-6dB")[0], ["studio_pro", { command: "fader", track: 2, db: -6 }]);
  assert.deepEqual(steps("スタジオプロのマスターの音量を80%")[0], ["studio_pro", { command: "fader", track: 0, value: 0.8 }]);
  assert.deepEqual(steps("参考曲の一覧")[0], ["library_list", { query: undefined }]);
  assert.equal(steps("参考曲から進行")[0][1].method, "loop");
  assert.equal(steps("参考曲を組み合わせて新しい進行")[0][1].method, "markov");
  assert.deepEqual(steps("参考曲「ファンク」のドラムとベースで")[0], ["library_arrange", { source: "ファンク", parts: ["drums", "bass"] }]);
  assert.deepEqual(steps("参考曲の型でアレンジ")[0][1].parts, ["drums", "bass", "comping"]);
  assert.deepEqual(steps("ベースだけMIDI書き出し")[0], ["export_midi", { track: "ベース" }]);
});

// ---------------- ステム分離 → MIDI 化したデータ ----------------
import { groupStemFiles, mergeMidis, cleanPart, stemLabel } from "../js/library.js";

test("ステム別ファイルを曲ごとにまとめる", () => {
  const names = ["SongA_drums.mid", "SongA_bass.mid", "SongA (Vocals).mid", "SongA_other.mid", "SongB-ドラム.mid", "SongB-ベース.mid", "ballad.mid"];
  const groups = groupStemFiles(names);
  assert.deepEqual(groups.map((g) => [g.name, g.indexes]), [
    ["SongA", [0, 1, 2, 3]],
    ["SongB", [4, 5]],
    ["ballad", [6]],
  ]);
  assert.equal(stemLabel("SongA_vocals.mid"), "vocals");
  assert.equal(stemLabel("ballad.mid"), null);
});

test("オーディオから変換した MIDI（ノイズ入り）から型を学べる", () => {
  // 元になる演奏（Eb メジャー、vi7-IVmaj7-V-I）
  const ctx = newCtx();
  runAction(ctx, "set_key", { key: "Eb" });
  runAction(ctx, "write_chords", { chords: ["vi7", "IVmaj7", "V", "I"], repeat: 2, style: "pop" });
  runAction(ctx, "generate_melody", { seed: 5 });
  runAction(ctx, "generate_bass", { style: "eighth" });
  runAction(ctx, "generate_drums", { style: "rock" });
  const p = ctx.store.project;
  const notesOf = (name) => findTrack(p, name).notes.map((n) => ({ ...n }));

  // 変換で起きがちな崩れを再現する
  const fragment = (notes) => notes.flatMap((n) => (n.duration >= 0.5 ? [{ ...n, duration: n.duration / 2 - 0.02 }, { ...n, start: n.start + n.duration / 2, duration: n.duration / 2 }] : [n]));
  const ghosts = (notes) => [...notes, ...notes.slice(0, 10).map((n) => ({ ...n, start: n.start + 0.13, duration: 0.02, velocity: 8 }))];
  const odd = { 36: 24, 38: 26, 42: 30, 49: 30, 45: 28, 50: 28 }; // GM ではない音高のドラム
  const stems = [
    ["Song_drums.mid", notesOf("ドラム").map((n) => ({ ...n, pitch: odd[n.pitch] ?? 30 }))],
    ["Song_bass.mid", ghosts(fragment(notesOf("ベース")))],
    ["Song_vocals.mid", ghosts(fragment(notesOf("メロディ")))],
    ["Song_other.mid", notesOf("コード")],
  ].map(([fileName, notes]) => ({ fileName, midi: { ppq: 480, bpm: 120, tempoFound: false, timeSig: [4, 4], name: "", tracks: [{ name: "", channel: 0, program: null, notes: notes.sort((a, b) => a.start - b.start) }] } }));

  const song = analyzeSong(mergeMidis(stems, "Song"), "Song");
  const roles = Object.fromEntries(song.parts.map((x) => [x.name, x.role]));
  assert.deepEqual(roles, { drums: "drums", bass: "bass", vocals: "melody", other: "chords" });
  assert.deepEqual(song.key, { root: 3, mode: "major" });
  assert.deepEqual(song.progressions[0].chords.map((c) => c.interval), [9, 5, 7, 0]);
  assert.ok(song.cleanup.drumsRemapped);
  assert.ok(song.cleanup.merged > 10 && song.cleanup.removed >= 10, JSON.stringify(song.cleanup));
  assert.equal(song.tempoFound, false);
  // ドラムはキック・スネア・ハットとして復元される
  const groove = song.grooves[0].pattern;
  assert.equal(groove.kick, "x.....x.x.......");
  assert.equal(groove.snare, "....x.......x...");
  assert.ok(groove.hatClosed);
  // ベースはルート 8 分の型として学べる（細切れがつながっている）
  assert.ok(song.bassPatterns[0].notes.every((n) => n.iv === 0));
  assert.equal(song.bassPatterns[0].notes.length, 8);
});

test("cleanPart はメロディを最高音、ベースを最低音で 1 音にする", () => {
  const chordy = [60, 64, 67].map((pitch) => ({ pitch, start: 0, duration: 1, velocity: 90 }));
  const mel = { role: "melody", notes: chordy.map((n) => ({ ...n })) };
  cleanPart(mel);
  assert.deepEqual(mel.notes.map((n) => n.pitch), [67]);
  const bass = { role: "bass", notes: chordy.map((n) => ({ ...n })) };
  cleanPart(bass);
  assert.deepEqual(bass.notes.map((n) => n.pitch), [60]);
});

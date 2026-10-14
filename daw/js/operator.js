// ルールベースの日本語（＋簡単な英語）コマンド解析。
// API キー無しでも「テンポ120」「王道進行で」「メロディ作って」のような指示で DAW を操作できる。

import { parseKey, PROGRESSIONS } from "./theory.js";
import { DRUM_STYLES } from "./generate.js";
import { INSTRUMENT_ALIASES } from "./project.js";

const DRUM_WORDS = [
  [/4つ打ち|四つ打ち|four|ハウス|EDM|ダンス/i, "four"],
  [/ロック|rock|8ビート|エイトビート/i, "rock"],
  [/ヒップホップ|hip ?hop|ローファイ|lo-?fi/i, "hiphop"],
  [/ハーフ|half/i, "halftime"],
  [/バラード|ballad/i, "ballad"],
  [/シャッフル|shuffle|ハネ/i, "shuffle"],
  [/ドラムンベース|dnb|drum ?n ?bass/i, "dnb"],
];

const BASS_WORDS = [
  [/ウォーキング|walking/i, "walking"],
  [/オクターブ|octave/i, "octave"],
  [/シンコペ|synco|跳ね/i, "synco"],
  [/全音符|ルート|伸ばし|root/i, "root"],
  [/8分|八分|eighth/i, "eighth"],
];

const CHORD_STYLE_WORDS = [
  [/アルペジオ|arpeggio|分散/i, "arpeggio"],
  [/ブロークン|broken/i, "broken"],
  [/刻み|stabs|カッティング/i, "stabs"],
  [/裏拍|オフビート|offbeat|レゲエ|スカ/i, "offbeat"],
  [/2分|二分|half/i, "half"],
  [/ポップ|pop|リズム/i, "pop"],
  [/白玉|全音符|伸ばし|block/i, "block"],
];

const MOODS = ["切ない", "エモい", "明るい", "爽やか", "壮大", "感動", "優しい", "暗い", "悲しい", "かっこいい", "おしゃれ", "都会的", "ジャズ", "シティポップ", "チル", "ローファイ", "ブルース", "ロック", "レトロ", "バラード", "情熱的", "スパニッシュ", "疾走感", "シンプル", "ポップ"];

function findWord(table, text) {
  for (const [re, v] of table) if (re.test(text)) return v;
  return null;
}

function zenkakuToHankaku(s) {
  return s
    .replace(/[０-９Ａ-Ｚａ-ｚ＃＋－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/　/g, " ");
}

/** 「〜小節目から」「〜小節」 */
function barsFrom(text) {
  const m = /(\d+)\s*小節目/.exec(text);
  return m ? Number(m[1]) : undefined;
}

function trackRef(text) {
  const m = /(?:トラック|track)\s*(\d+)/i.exec(text) || /「([^」]+)」/.exec(text);
  if (m) return m[1];
  for (const w of ["メロディ", "コード", "ベース", "ドラム", "ピアノ", "パッド", "ストリングス", "リード", "エレピ"]) if (text.includes(w)) return w;
  return undefined;
}

/**
 * 1つの文を解析
 * @returns {{action:string, input:object}[] | {help:true} | null}
 */
export function parseSentence(raw) {
  const text = zenkakuToHankaku(raw).trim();
  if (!text) return null;
  const t = text.toLowerCase();

  if (/^(help|ヘルプ|使い方|何ができる|なにができる)/i.test(t)) return { help: true };
  if (/元に戻|取り消|アンドゥ|^undo$/i.test(t)) return [{ action: "undo", input: {} }];
  if (/やり直|リドゥ|^redo$/i.test(t)) return [{ action: "redo", input: {} }];
  if (/(停止|ストップ|止め|^stop$)/i.test(t)) return [{ action: "transport", input: { command: "stop" } }];
  if (/(再生|プレイ|聴かせ|聞かせ|鳴らして|^play$)/i.test(t) && !/(作|生成)/.test(t)) return [{ action: "transport", input: { command: "play" } }];
  if (/(midi|ミディ).*(書き出|エクスポート|保存|出力|export)|export/i.test(t)) return [{ action: "export_midi", input: {} }];
  if (/(分析|アドバイス|チェック|診断|どう(思う|かな)|analy[sz]e)/i.test(t)) return [{ action: "analyze", input: {} }];

  // テンポ
  let m = /(?:テンポ|bpm|tempo)\s*(?:を|は|=|:)?\s*(\d{2,3})/i.exec(text) || /(\d{2,3})\s*bpm/i.exec(text);
  if (m) return [{ action: "set_tempo", input: { bpm: Number(m[1]) } }];
  if (/(テンポ|bpm).*(上げ|速く|早く)/i.test(t)) return [{ action: "set_tempo", input: { bpm: "+10" } }];
  if (/(テンポ|bpm).*(下げ|遅く|ゆっくり)/i.test(t)) return [{ action: "set_tempo", input: { bpm: "-10" } }];

  // キー
  m = /(?:キー|key)\s*(?:を|は|=|:)?\s*([A-Ga-g][#b]?\s*(?:major|minor|maj|min|m|メジャー|マイナー)?)/i.exec(text) || /([ハニホヘトイロ][嬰変]?(?:長調|短調))/.exec(text);
  if (m) {
    const key = m[1].trim();
    if (parseKey(key)) return [{ action: "set_key", input: { key, transpose_notes: /移調|ごと|も/.test(text) } }];
  }

  // 移調
  m = /(\d*)\s*オクターブ\s*(上|下)/.exec(text);
  if (m) return [{ action: "transpose", input: { semitones: 12 * Number(m[1] || 1) * (m[2] === "下" ? -1 : 1), track: trackRef(text) } }];
  m = /(?:移調|トランスポーズ|transpose)\s*([+-]?\d+)/i.exec(text) || /([+-]?\d+)\s*(?:半音)?\s*(?:移調|上げ|下げ)/.exec(text) || /([+-]?\d+)\s*半音/.exec(text);
  if (m) {
    let n = Number(m[1]);
    if (/下げ|下に/.test(text) && n > 0) n = -n;
    return [{ action: "transpose", input: { semitones: n, track: /全体|全部/.test(text) ? undefined : trackRef(text) } }];
  }

  // 小節数
  m = /(\d+)\s*小節(?:に|まで|の長さ)/.exec(text) || /(?:長さ|小節数)\s*(?:を|は)?\s*(\d+)/.exec(text);
  if (m && !/ループ/.test(text)) return [{ action: "set_length", input: { bars: Number(m[1]) } }];

  // ループ
  m = /(\d+)\s*(?:小節目)?\s*(?:から|〜|~|～|-)\s*(\d+)\s*小節.*ループ|ループ.*?(\d+)\s*(?:小節目)?\s*(?:から|〜|~|～|-)\s*(\d+)/.exec(text);
  if (m) return [{ action: "set_loop", input: { start_bar: Number(m[1] ?? m[3]), end_bar: Number(m[2] ?? m[4]) } }];
  if (/ループ.*(オフ|解除|やめ|off)/i.test(t)) return [{ action: "set_loop", input: { enabled: false } }];
  if (/ループ.*(オン|on)/i.test(t)) return [{ action: "set_loop", input: { enabled: true } }];

  // ミュート・ソロ・音量
  if (/ミュート解除|ミュートを?(外|解除)|unmute/i.test(t)) return [{ action: "set_track", input: { track: trackRef(text), mute: false } }];
  if (/ミュート|mute/i.test(t)) return [{ action: "set_track", input: { track: trackRef(text), mute: true } }];
  if (/ソロ.*(解除|外)/.test(t)) return [{ action: "set_track", input: { track: trackRef(text), solo: false } }];
  if (/ソロ|solo/i.test(t)) return [{ action: "set_track", input: { track: trackRef(text), solo: true } }];
  m = /(?:音量|ボリューム|volume)\s*(?:を)?\s*(\d+)/i.exec(text);
  if (m) return [{ action: "set_track", input: { track: trackRef(text), volume: Math.min(100, Number(m[1])) / 100 } }];

  // トラック追加・削除
  if (/(トラック|track).*(追加|足して|作って|add)|(追加|add).*(トラック|track)/i.test(t)) {
    const inst = Object.keys(INSTRUMENT_ALIASES).find((k) => text.includes(k)) || "piano";
    const name = /「([^」]+)」/.exec(text)?.[1];
    return [{ action: "add_track", input: { instrument: INSTRUMENT_ALIASES[inst], name } }];
  }
  if (/(トラック|track).*(削除|消して|delete|remove)/i.test(t)) return [{ action: "remove_track", input: { track: trackRef(text) } }];
  if (/(消して|クリア|空に|clear)/i.test(t)) return [{ action: "clear_track", input: { track: trackRef(text) } }];

  // クオンタイズ・ヒューマナイズ
  if (/クオンタイズ|quantize/i.test(t)) {
    const g = /32分/.test(text) ? 0.125 : /8分|八分/.test(text) ? 0.5 : /4分|四分/.test(text) ? 1 : 0.25;
    return [{ action: "quantize", input: { track: trackRef(text) ?? "メロディ", grid: g } }];
  }
  if (/ヒューマナイズ|人間らしく|humanize/i.test(t)) return [{ action: "humanize", input: { track: trackRef(text) ?? "メロディ" } }];

  // 次のコード提案
  if (/次.*コード|コード.*次|続き.*コード|next chord/i.test(t)) return [{ action: "suggest_next_chord", input: {} }];

  // コード1つ追加
  m = /コード(?:を)?追加\s*([A-G][^\s、。]*)/.exec(text);
  if (m) return [{ action: "append_chord", input: { chord: m[1] } }];

  // 具体的なコード進行: "コード C G Am F" / "進行 I V vi IV" / "Am-F-C-G"
  const chordList = extractChordList(text);
  if (chordList) {
    return [{ action: "write_chords", input: { chords: chordList, start_bar: barsFrom(text), bars_per_chord: perChord(text), style: findWord(CHORD_STYLE_WORDS, text) ?? undefined } }];
  }

  // 名前付きの進行 / ムードの進行
  const named = PROGRESSIONS.find((p) => {
    const base = p.name.replace(/（.*）/, "");
    return text.includes(base) || (/進行/.test(text) && text.includes(base.replace(/進行$/, "")));
  });
  const mood = MOODS.find((w) => text.includes(w));
  const wantsAll = /(おまかせ|全部|まるごと|一曲|1曲|ワンコーラス|スケッチ|デモ|sketch)/i.test(t);
  if (wantsAll) {
    const drum = findWord(DRUM_WORDS, text);
    const bars = /16\s*小節/.test(text) ? 16 : /4\s*小節/.test(text) ? 4 : 8;
    return [{ action: "sketch", input: { mood: named?.mood[0] ?? mood, bars, drum_style: drum ?? undefined } }];
  }
  if (/(提案|候補|おすすめ|オススメ|教えて|アイデア|アイディア)/.test(text) && /(進行|コード)/.test(text)) {
    return [{ action: "suggest_progressions", input: { mood } }];
  }
  if (named || (mood && /(進行|コード)/.test(text))) {
    const prog = named ?? null;
    return [{ action: "apply_progression", input: { progression_id: prog?.id, mood, style: findWord(CHORD_STYLE_WORDS, text) ?? undefined, bars_per_chord: perChord(text), start_bar: barsFrom(text) } }];
  }

  // メロディ
  if (/メロ|melody|旋律/i.test(t) && /(作|生成|つけ|付け|書|別|変え|もう一|new|make|gen)/i.test(t)) {
    const density = /(少な|ゆったり|シンプル|まばら|sparse)/i.test(t) ? "sparse" : /(細か|速い|多め|忙し|busy)/i.test(t) ? "busy" : "normal";
    const register = /(高め|高い|high)/i.test(t) ? "high" : /(低め|低い|low)/i.test(t) ? "low" : "mid";
    return [{ action: "generate_melody", input: { density, register, start_bar: barsFrom(text) } }];
  }
  // ベース
  if (/ベース|bass/i.test(t)) return [{ action: "generate_bass", input: { style: findWord(BASS_WORDS, text) ?? "eighth" } }];
  // ドラム
  if (/ドラム|リズム|ビート|drum|beat/i.test(t) || findWord(DRUM_WORDS, text)) {
    const style = findWord(DRUM_WORDS, text) ?? "basic";
    return [{ action: "generate_drums", input: { style: DRUM_STYLES.includes(style) ? style : "basic" } }];
  }
  if (/(状態|今どう|情報|status)/i.test(t)) return [{ action: "get_project", input: {} }];
  return null;
}

function perChord(text) {
  if (/2拍|二拍|半小節/.test(text)) return 0.5;
  if (/2小節ずつ|2小節ごと/.test(text)) return 2;
  if (/4小節ずつ|4小節ごと/.test(text)) return 4;
  return undefined;
}

const CHORD_TOKEN = /^(?:[A-G][#b]?(?:maj9|maj7|M7|M9|mM7|m7b5|m7-5|dim7|dim|aug|sus2|sus4|7sus4|add9|madd9|m9|m7|m6|m|6|7|9|\+|°|ø)?(?:\/[A-G][#b]?)?|[b#]?(?:VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(?:maj7|M7|7|9|6|°|dim|sus4|add9)?)$/;

/** "C G Am F" / "Am-F-C-G" / "I→V→vi→IV" のようなコード列を取り出す */
export function extractChordList(text) {
  const body = text.replace(/^.*?(?:コード進行|コード|進行|chords?)\s*(?:は|を|:|：)?\s*/i, "");
  const tokens = body
    .split(/[\s,、→\->|]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const chords = [];
  for (const tok of tokens) {
    if (CHORD_TOKEN.test(tok)) chords.push(tok);
    else if (chords.length) break; // コード列の後ろの「で」「にして」等で終わる
  }
  return chords.length >= 2 ? chords : null;
}

/** 入力全体を文に分割して解析 */
export function parseCommand(input) {
  const sentences = zenkakuToHankaku(input)
    .split(/[。\n;！!？?]|、(?:それから|あと|そして)|(?:して|て)、/)
    .map((s) => s.trim())
    .filter(Boolean);
  const steps = [];
  const unknown = [];
  let help = false;
  for (const s of sentences) {
    const r = parseSentence(s);
    if (!r) unknown.push(s);
    else if (r.help) help = true;
    else steps.push(...r);
  }
  return { steps, unknown, help };
}

export const HELP_TEXT = `話しかけるように指示してください。複数の指示は「。」や改行で区切れます。

■ 曲の設定
・テンポ120 ／ テンポを上げて ／ キーをAmに ／ 16小節にして
■ コード
・王道進行で ／ 切ない進行にして ／ おしゃれなコード進行の提案
・コード Am F C G ／ 進行 I V vi IV アルペジオで ／ コード追加 Em ／ 次のコードは？
■ 生成
・メロディを作って（高め／細かく／シンプルに）／ ベースをウォーキングで ／ ドラムを4つ打ちで
・おまかせで切ない曲を16小節 ← コード〜ドラムまで一気に作ります
■ 編集
・メロディを+2移調 ／ ベースを1オクターブ下げて ／ メロディをクオンタイズ ／ ドラムをミュート ／ ベースの音量70
・メロディを消して ／ 元に戻す ／ やり直し
■ その他
・再生 ／ 停止 ／ 3〜4小節をループ ／ 分析して ／ MIDI書き出し

Claude API キーを設定すると、もっと自由な言い方や細かい作曲の相談もできます。`;

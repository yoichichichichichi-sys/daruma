// Fender Studio Pro（旧 Studio One 系）をリモート操作する: Mackie Control (MCU) プロトコルを送る。
//
// 仕組み: このアプリ → 仮想 MIDI ポート（Mac: IAC ドライバ / Windows: loopMIDI）→ Studio Pro。
// Studio Pro 側でその仮想ポートを「Mackie Control」として外部デバイスに追加すると、
// 再生・録音・ループ・トラックの選択/ミュート/ソロ/録音待機・フェーダーなどを操作できる。
// MCU は 8 チャンネル単位（バンク）でトラックを扱うため、9 トラック目以降はバンクを切り替えて送る。

// MCU のボタン（ノート番号）。値はオン 127 → オフ 0 で「押して離す」
export const MCU_BUTTONS = {
  play: { note: 0x5e, label: "再生" },
  stop: { note: 0x5d, label: "停止" },
  record: { note: 0x5f, label: "録音" },
  rewind: { note: 0x5b, label: "巻き戻し" },
  forward: { note: 0x5c, label: "早送り" },
  cycle: { note: 0x56, label: "ループ（サイクル）切替" },
  click: { note: 0x59, label: "メトロノーム切替" },
  marker: { note: 0x54, label: "マーカー" },
  nudge: { note: 0x55, label: "ナッジ" },
  drop: { note: 0x57, label: "パンチイン（Drop）" },
  replace: { note: 0x58, label: "置き換え録音（Replace）" },
  solo_clear: { note: 0x5a, label: "ソロ解除" },
  undo: { note: 0x51, label: "元に戻す" },
  save: { note: 0x50, label: "保存" },
  enter: { note: 0x53, label: "決定（Enter）" },
  cancel: { note: 0x52, label: "キャンセル" },
  up: { note: 0x60, label: "カーソル上" },
  down: { note: 0x61, label: "カーソル下" },
  left: { note: 0x62, label: "カーソル左" },
  right: { note: 0x63, label: "カーソル右" },
  zoom: { note: 0x64, label: "ズーム" },
  scrub: { note: 0x65, label: "スクラブ" },
  bank_left: { note: 0x2e, label: "バンク←（8トラック戻る）" },
  bank_right: { note: 0x2f, label: "バンク→（8トラック進む）" },
  channel_left: { note: 0x30, label: "チャンネル←" },
  channel_right: { note: 0x31, label: "チャンネル→" },
  flip: { note: 0x32, label: "フリップ" },
  global_view: { note: 0x33, label: "グローバルビュー" },
  automation_read: { note: 0x4a, label: "オートメーション Read" },
  automation_write: { note: 0x4b, label: "オートメーション Write" },
  automation_touch: { note: 0x4d, label: "オートメーション Touch" },
  automation_latch: { note: 0x4e, label: "オートメーション Latch" },
  f1: { note: 0x36, label: "F1" },
  f2: { note: 0x37, label: "F2" },
  f3: { note: 0x38, label: "F3" },
  f4: { note: 0x39, label: "F4" },
  f5: { note: 0x3a, label: "F5" },
  f6: { note: 0x3b, label: "F6" },
  f7: { note: 0x3c, label: "F7" },
  f8: { note: 0x3d, label: "F8" },
};

// チャンネルストリップのボタン（+0〜7 でストリップ 1〜8）
export const MCU_STRIP = {
  arm: { base: 0x00, label: "録音待機" },
  solo: { base: 0x08, label: "ソロ" },
  mute: { base: 0x10, label: "ミュート" },
  select: { base: 0x18, label: "選択" },
};

const FADER_TOUCH = 0x68; // +0〜7、マスターは +8

/** ボタンを押して離す MIDI メッセージ */
export function buttonMessages(note) {
  return [
    [0x90, note, 0x7f],
    [0x90, note, 0x00],
  ];
}

/** フェーダー（ピッチベンド 14bit）。strip は 0〜7、8 でマスター。value は 0〜1 */
export function faderMessages(strip, value) {
  const v = Math.round(Math.max(0, Math.min(1, value)) * 16383);
  return [
    [0x90, FADER_TOUCH + strip, 0x7f], // タッチしてから動かす（DAW によってはこれが必要）
    [0xe0 | strip, v & 0x7f, (v >> 7) & 0x7f],
    [0x90, FADER_TOUCH + strip, 0x00],
  ];
}

export class StudioProRemote {
  constructor() {
    this.output = null; // MIDIOutput
    this.bank = 0; // 今どのバンク（0 = トラック 1〜8）を見ているか（アプリ側の推定）
    this.log = [];
  }

  get connected() {
    return !!this.output;
  }

  setOutput(output) {
    this.output = output;
  }

  send(messages) {
    if (!this.output) throw new Error("Studio Pro 操作用の MIDI ポートが設定されていません。メニュー「⋯ → 設定」で選んでください。");
    for (const m of messages) this.output.send(m);
    this.log.push(...messages);
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  press(name) {
    const b = MCU_BUTTONS[name];
    if (!b) throw new Error(`不明なボタン: ${name}`);
    this.send(buttonMessages(b.note));
    if (name === "bank_left") this.bank = Math.max(0, this.bank - 1);
    if (name === "bank_right") this.bank++;
    return b.label;
  }

  /** バンクの位置を先頭に戻す（推定がずれたとき用） */
  resetBank() {
    const msgs = [];
    for (let i = 0; i < 16; i++) msgs.push(...buttonMessages(MCU_BUTTONS.bank_left.note));
    this.send(msgs);
    this.bank = 0;
  }

  /** 1 始まりのトラック番号を「バンク + ストリップ」にして、必要ならバンクを移動 */
  focusTrack(track) {
    const n = Math.floor(track);
    if (!(n >= 1)) throw new Error("トラック番号は 1 以上で指定してください。");
    const bank = Math.floor((n - 1) / 8);
    const msgs = [];
    const move = bank - this.bank;
    const note = move > 0 ? MCU_BUTTONS.bank_right.note : MCU_BUTTONS.bank_left.note;
    for (let i = 0; i < Math.abs(move); i++) msgs.push(...buttonMessages(note));
    if (msgs.length) this.send(msgs);
    this.bank = bank;
    return (n - 1) % 8;
  }

  strip(kind, track) {
    const s = MCU_STRIP[kind];
    if (!s) throw new Error(`不明な操作: ${kind}`);
    const idx = this.focusTrack(track);
    this.send(buttonMessages(s.base + idx));
    return s.label;
  }

  fader(track, value) {
    if (track === "master" || track === 0) {
      this.send(faderMessages(8, value));
      return;
    }
    const idx = this.focusTrack(track);
    this.send(faderMessages(idx, value));
  }
}

/**
 * 0〜1 のフェーダー値 ↔ dB のおおよその換算（MCU の一般的なカーブ: 0.75 ≒ 0dB）。
 * Studio Pro の実際のカーブとは多少ずれる。
 */
export function dbToFader(db) {
  if (db <= -60) return 0;
  if (db >= 6) return 1;
  return db >= 0 ? 0.75 + (db / 6) * 0.25 : 0.75 * Math.pow(10, db / 40);
}

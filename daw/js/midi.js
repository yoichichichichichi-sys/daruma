// Standard MIDI File (SMF) の書き出しと読み込み。
// 書き出したファイルは Studio Pro などの DAW にドラッグ＆ドロップで読み込める。

import { BEATS_PER_BAR } from "./theory.js";

const PPQ = 480;

// 内蔵音色 → General MIDI プログラム番号
const GM_PROGRAM = { piano: 0, epiano: 4, pad: 89, strings: 48, pluck: 25, lead: 81, bass: 38, drums: 0 };

function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

function str(s) {
  return [...new TextEncoder().encode(s)];
}

function chunk(type, data) {
  const len = data.length;
  return [...str(type), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...data];
}

function trackChunk(events) {
  // events: [{tick, data:number[]}]（同時刻は note off を先に）
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out = [];
  let last = 0;
  for (const e of events) {
    out.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  out.push(0, 0xff, 0x2f, 0x00);
  return chunk("MTrk", out);
}

/**
 * プロジェクトを SMF のバイト列に変換
 * @param {{trackIds?: string[]}} [opts] trackIds を渡すとそのトラックだけ書き出す（パート単位で DAW に持ち込む用）
 */
export function projectToMidi(p, { trackIds } = {}) {
  const tracks = [];
  // 0トラック目: テンポ・拍子・曲名・コード（マーカー）
  const mpqn = Math.round(60000000 / p.bpm);
  const conductor = [
    { tick: 0, order: 0, data: [0xff, 0x03, ...vlq(str(p.title).length), ...str(p.title)] },
    { tick: 0, order: 0, data: [0xff, 0x51, 0x03, (mpqn >> 16) & 255, (mpqn >> 8) & 255, mpqn & 255] },
    { tick: 0, order: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
  ];
  for (const c of p.chords) {
    const tick = Math.round((c.bar * BEATS_PER_BAR + (c.beat || 0)) * PPQ);
    const text = str(c.symbol);
    conductor.push({ tick, order: 1, data: [0xff, 0x06, ...vlq(text.length), ...text] });
  }
  tracks.push(trackChunk(conductor));

  // チャンネル10（index 9）はドラム専用なので飛ばす
  const melodic = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  let next = 0;
  for (const t of p.tracks) {
    if (trackIds && !trackIds.includes(t.id)) {
      if (t.instrument !== "drums") next++; // チャンネル割り当てを全体書き出しと揃える
      continue;
    }
    const ch = t.instrument === "drums" ? 9 : melodic[next++ % melodic.length];
    const name = str(t.name);
    const events = [
      { tick: 0, order: 0, data: [0xff, 0x03, ...vlq(name.length), ...name] },
      { tick: 0, order: 0, data: [0xb0 | ch, 7, Math.round(t.volume * 127)] },
    ];
    if (t.instrument !== "drums") events.push({ tick: 0, order: 0, data: [0xc0 | ch, GM_PROGRAM[t.instrument] ?? 0] });
    for (const n of t.notes) {
      const on = Math.round(n.start * PPQ);
      const off = Math.max(on + 1, Math.round((n.start + n.duration) * PPQ));
      events.push({ tick: on, order: 2, data: [0x90 | ch, n.pitch, n.velocity] });
      events.push({ tick: off, order: 1, data: [0x80 | ch, n.pitch, 0] });
    }
    tracks.push(trackChunk(events));
  }

  const header = chunk("MThd", [0, 1, tracks.length >> 8, tracks.length & 255, PPQ >> 8, PPQ & 255]);
  return new Uint8Array([...header, ...tracks.flat()]);
}

// ---------------- 読み込み ----------------

/**
 * SMF（Type 0/1）を解析する。時間は拍（4分音符 = 1）に換算して返す。
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {{ppq:number, bpm:number, tempoFound:boolean, timeSig:[number, number], name:string, tracks:{name:string, channel:number, program:number|null, notes:{pitch:number,start:number,duration:number,velocity:number}[]}[]}}
 */
export function parseMidi(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  let pos = 0;
  const u32 = () => ((b[pos++] << 24) | (b[pos++] << 16) | (b[pos++] << 8) | b[pos++]) >>> 0;
  const u16 = () => (b[pos++] << 8) | b[pos++];
  const tag = () => String.fromCharCode(b[pos++], b[pos++], b[pos++], b[pos++]);
  const readVlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const c = b[pos++];
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) break;
    }
    return v;
  };
  const text = (len) => {
    const bytes = b.slice(pos, pos + len);
    pos += len;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      try {
        return new TextDecoder("shift_jis").decode(bytes); // 日本の古い MIDI データ
      } catch {
        return String.fromCharCode(...bytes);
      }
    }
  };

  if (tag() !== "MThd") throw new Error("MIDI ファイルではありません。");
  const hlen = u32();
  const hdrEnd = pos + hlen;
  u16(); // format
  const ntrks = u16();
  const division = u16();
  if (division & 0x8000) throw new Error("SMPTE タイムベースの MIDI には対応していません。");
  pos = hdrEnd;
  const ppq = division;

  let bpm = null;
  let timeSig = [4, 4];
  let songName = "";
  // チャンネル単位で集める（Type 0 は 1 トラックに全チャンネルが入っているため）
  const byKey = new Map();
  const getPart = (trackIndex, ch, trackName) => {
    const k = `${trackIndex}:${ch}`;
    if (!byKey.has(k)) byKey.set(k, { name: trackName, channel: ch, program: null, notes: [], trackIndex });
    return byKey.get(k);
  };

  for (let ti = 0; ti < ntrks && pos < b.length; ti++) {
    if (tag() !== "MTrk") throw new Error("トラックの形式が壊れています。");
    const len = u32();
    const end = pos + len;
    let tick = 0;
    let running = 0;
    let trackName = "";
    const open = new Map(); // `${ch}:${pitch}` -> [{tick, vel}]
    const parts = [];
    while (pos < end) {
      tick += readVlq();
      let status = b[pos];
      if (status & 0x80) pos++;
      else status = running;
      if (status === 0xff) {
        const type = b[pos++];
        const l = readVlq();
        if (type === 0x51 && bpm == null) bpm = 60000000 / ((b[pos] << 16) | (b[pos + 1] << 8) | b[pos + 2]);
        if (type === 0x58 && tick === 0) timeSig = [b[pos], 2 ** b[pos + 1]];
        if (type === 0x03) {
          const n = text(l).trim();
          if (ti === 0 && !songName) songName = n;
          trackName = trackName || n;
          continue;
        }
        pos += l;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        pos += readVlq();
        continue;
      }
      running = status;
      const type = status & 0xf0;
      const ch = status & 0x0f;
      const d1 = b[pos++];
      const d2 = type === 0xc0 || type === 0xd0 ? 0 : b[pos++];
      if (type === 0xc0) {
        const part = getPart(ti, ch, trackName);
        if (part.program == null) part.program = d1;
        parts.push(part);
      } else if (type === 0x90 && d2 > 0) {
        const k = `${ch}:${d1}`;
        if (!open.has(k)) open.set(k, []);
        open.get(k).push({ tick, vel: d2 });
      } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
        const k = `${ch}:${d1}`;
        const q = open.get(k);
        const on = q?.shift();
        if (on) {
          const part = getPart(ti, ch, trackName);
          parts.push(part);
          part.notes.push({ pitch: d1, start: on.tick / ppq, duration: Math.max(1, tick - on.tick) / ppq, velocity: on.vel });
        }
      }
    }
    // 名前はトラック末尾で確定するので後から付ける
    for (const part of parts) if (!part.name) part.name = trackName;
    pos = end;
  }

  const tracks = [...byKey.values()]
    .filter((t) => t.notes.length)
    .map((t) => ({ name: t.name || (t.channel === 9 ? "Drums" : `Ch${t.channel + 1}`), channel: t.channel, program: t.program, notes: t.notes.sort((a, c) => a.start - c.start || a.pitch - c.pitch) }));
  return { ppq, bpm: Math.round(bpm ?? 120), tempoFound: bpm != null, timeSig, name: songName, tracks };
}

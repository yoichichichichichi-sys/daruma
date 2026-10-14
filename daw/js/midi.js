// Standard MIDI File (SMF Type 1) の書き出し。お使いの DAW にそのまま読み込める。

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

/** プロジェクトを SMF のバイト列に変換 */
export function projectToMidi(p) {
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

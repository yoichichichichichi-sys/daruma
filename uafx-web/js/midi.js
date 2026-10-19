// Web MIDI transport. UAFX pedals expose MIDI over their USB-C port, so a PC
// that sees the pedal (directly or via a USB MIDI interface) can talk to it here.
import { log, toHex } from "./util.js";

const listeners = new Set();
let access = null;
let output = null;
let input = null;

export const midi = {
  get supported() {
    return typeof navigator.requestMIDIAccess === "function";
  },
  get connected() {
    return output !== null;
  },
  get access() {
    return access;
  },

  async enable() {
    access = await navigator.requestMIDIAccess({ sysex: true }).catch(() =>
      navigator.requestMIDIAccess({ sysex: false }),
    );
    log("sys", "MIDI", `有効化しました (SysEx: ${access.sysexEnabled ? "可" : "不可"})`);
    return access;
  },

  outputs() {
    return access ? [...access.outputs.values()] : [];
  },
  inputs() {
    return access ? [...access.inputs.values()] : [];
  },

  selectOutput(id) {
    output = access?.outputs.get(id) ?? null;
    if (output) log("sys", "MIDI", `出力: ${output.name}`);
  },

  selectInput(id) {
    if (input) input.onmidimessage = null;
    input = access?.inputs.get(id) ?? null;
    if (!input) return;
    input.onmidimessage = (e) => {
      log("rx", "MIDI", `${toHex(e.data)}  ${describe(e.data)}`);
      for (const fn of listeners) fn(e.data);
    };
    log("sys", "MIDI", `入力: ${input.name}`);
  },

  onMessage(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  send(bytes) {
    if (!output) throw new Error("MIDI 出力が選択されていません");
    output.send(bytes);
    log("tx", "MIDI", `${toHex(bytes)}  ${describe(bytes)}`);
  },

  cc(channel, number, value) {
    this.send([0xb0 | ((channel - 1) & 0x0f), number & 0x7f, value & 0x7f]);
  },

  programChange(channel, program) {
    this.send([0xc0 | ((channel - 1) & 0x0f), program & 0x7f]);
  },
};

export function describe(data) {
  const status = data[0];
  if (status === 0xf0) return `SysEx (${data.length} bytes)`;
  const ch = (status & 0x0f) + 1;
  switch (status & 0xf0) {
    case 0x80: return `NoteOff ch${ch} n${data[1]}`;
    case 0x90: return `NoteOn ch${ch} n${data[1]} v${data[2]}`;
    case 0xb0: return `CC ch${ch} #${data[1]} = ${data[2]}`;
    case 0xc0: return `ProgramChange ch${ch} #${data[1]}`;
    case 0xe0: return `PitchBend ch${ch}`;
    default: return "";
  }
}

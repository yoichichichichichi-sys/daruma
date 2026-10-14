// プロジェクト（曲データ）のモデルと Undo 履歴。

import { BEATS_PER_BAR } from "./theory.js";

export const INSTRUMENTS = {
  piano: "ピアノ",
  epiano: "エレピ",
  pad: "パッド",
  strings: "ストリングス",
  pluck: "プラック",
  lead: "リード",
  bass: "シンセベース",
  drums: "ドラム",
};

export const INSTRUMENT_ALIASES = {
  ピアノ: "piano", piano: "piano",
  エレピ: "epiano", ローズ: "epiano", rhodes: "epiano", epiano: "epiano",
  パッド: "pad", pad: "pad", シンセパッド: "pad",
  ストリングス: "strings", 弦: "strings", strings: "strings",
  プラック: "pluck", pluck: "pluck", ギター: "pluck", guitar: "pluck",
  リード: "lead", lead: "lead", シンセ: "lead", synth: "lead",
  ベース: "bass", bass: "bass", シンセベース: "bass",
  ドラム: "drums", drums: "drums", drum: "drums", リズム: "drums",
};

let idCounter = 1;
const newId = () => `t${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function createTrack({ name, instrument = "piano", volume = 0.8 } = {}) {
  return { id: newId(), name: name || INSTRUMENTS[instrument] || "トラック", instrument, volume, pan: 0, mute: false, solo: false, notes: [] };
}

export function createProject() {
  return {
    version: 1,
    title: "無題の曲",
    bpm: 110,
    key: { root: 0, mode: "major" },
    bars: 8,
    loop: { enabled: true, startBar: 0, endBar: 8 },
    chords: [], // [{bar, beat, symbol, length}]
    sections: [], // [{name, startBar, bars}]
    tracks: [],
  };
}

/** 初回起動時のデフォルト構成 */
export function createDefaultProject() {
  const p = createProject();
  p.tracks.push(createTrack({ name: "コード", instrument: "piano" }));
  p.tracks.push(createTrack({ name: "メロディ", instrument: "lead", volume: 0.7 }));
  p.tracks.push(createTrack({ name: "ベース", instrument: "bass" }));
  p.tracks.push(createTrack({ name: "ドラム", instrument: "drums" }));
  return p;
}

export function projectLengthBeats(p) {
  return p.bars * BEATS_PER_BAR;
}

/** 名前・番号（1始まり）・ID・楽器名でトラックを探す */
export function findTrack(p, ref) {
  if (ref == null || ref === "") return null;
  if (typeof ref === "number" || /^\d+$/.test(String(ref))) {
    const t = p.tracks[Number(ref) - 1];
    if (t) return t;
  }
  const s = String(ref).trim().toLowerCase();
  return (
    p.tracks.find((t) => t.id === ref) ||
    p.tracks.find((t) => t.name.toLowerCase() === s) ||
    p.tracks.find((t) => t.name.toLowerCase().includes(s) || s.includes(t.name.toLowerCase())) ||
    p.tracks.find((t) => t.instrument === s || t.instrument === INSTRUMENT_ALIASES[s]) ||
    null
  );
}

export function normalizeNotes(notes) {
  return notes
    .filter((n) => Number.isFinite(n.pitch) && Number.isFinite(n.start) && n.duration > 0)
    .map((n) => ({
      pitch: Math.max(0, Math.min(127, Math.round(n.pitch))),
      start: Math.max(0, round(n.start)),
      duration: round(Math.max(1 / 16, n.duration)),
      velocity: Math.max(1, Math.min(127, Math.round(n.velocity ?? 90))),
    }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

const round = (x) => Math.round(x * 1000) / 1000;

/** 指定範囲（拍）のノートを消す */
export function clearRange(track, startBeat, endBeat) {
  track.notes = track.notes.filter((n) => n.start < startBeat - 1e-6 || n.start >= endBeat - 1e-6);
}

/** Undo/Redo 付きのストア。変更は commit() 経由で行う */
export class Store {
  constructor(project) {
    this.project = project;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.project);
  }

  /** mutator(project) を実行して履歴に積む */
  commit(label, mutator) {
    const before = JSON.stringify(this.project);
    const result = mutator(this.project);
    if (JSON.stringify(this.project) !== before) {
      this.undoStack.push({ label, snapshot: before });
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
      this.emit();
    }
    return result;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ label: entry.label, snapshot: JSON.stringify(this.project) });
    this.project = JSON.parse(entry.snapshot);
    this.emit();
    return entry.label;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ label: entry.label, snapshot: JSON.stringify(this.project) });
    this.project = JSON.parse(entry.snapshot);
    this.emit();
    return entry.label;
  }

  replace(project) {
    this.undoStack.push({ label: "プロジェクト読み込み", snapshot: JSON.stringify(this.project) });
    this.redoStack = [];
    this.project = project;
    this.emit();
  }
}

// Device profiles: which knob/preset sends which MIDI or BLE message.
// The bundled profiles deliberately leave CC numbers unassigned (null):
// fill them from your pedal's MIDI implementation chart or with "Learn".

const STORAGE_KEY = "uafxWeb.profiles.v1";
const ACTIVE_KEY = "uafxWeb.activeProfile.v1";

const ampControls = ["Volume", "Gain", "Bass", "Middle", "Treble"].map((label) => knob(label));

export const BUILTIN_PROFILES = [
  {
    id: "uafx-amp-midi",
    name: "UAFX アンプ系 (MIDI) — Dream / Ruby / Woodrow / Lion など",
    transport: "midi",
    note: "CC 番号は未割当です。マニュアルの MIDI 実装表を見て入力するか、Learn で割り当ててください。",
    presets: { type: "pc", count: 3, base: 0, labels: ["Preset A", "Preset B", "Preset C"] },
    controls: [...ampControls, toggle("Bypass")],
  },
  {
    id: "uafx-fx-midi",
    name: "UAFX エフェクト系 (MIDI) — Golden / Starlight / Astra など",
    transport: "midi",
    note: "CC 番号は未割当です。",
    presets: { type: "pc", count: 3, base: 0, labels: ["Preset A", "Preset B", "Preset C"] },
    controls: ["Mix", "Time", "Feedback", "Mod", "Tone", "Level"].map((label) => knob(label)).concat(toggle("Bypass")),
  },
  {
    id: "uafx-ble-template",
    name: "BLE 解析用テンプレート",
    transport: "ble",
    note: "BLE キャプチャで判明したサービス/キャラクタリスティック UUID とバイト列を書き込んで使います。{v} が値 (1byte)、{v16le}/{v16be} が 2byte 値に置換されます。",
    ble: { characteristic: "", withResponse: true },
    presets: { type: "ble", count: 3, labels: ["Preset A", "Preset B", "Preset C"], template: "" },
    controls: ampControls.map((c) => ({ ...c, midi: undefined, ble: "" })),
  },
];

function knob(label) {
  return { id: slug(label), label, type: "knob", min: 0, max: 127, default: 64, midi: { cc: null } };
}

function toggle(label) {
  return { id: slug(label), label, type: "toggle", on: 127, off: 0, default: 0, midi: { cc: null } };
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function loadProfiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // corrupted or unavailable storage; fall back to builtins
  }
  return structuredClone(BUILTIN_PROFILES);
}

export function saveProfiles(profiles) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // storage full or unavailable; ignore
  }
}

export function loadActiveId() {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveId(id) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore
  }
}

export function validateProfile(p) {
  if (!p || typeof p !== "object") throw new Error("プロファイルはオブジェクトである必要があります");
  if (!p.id || !p.name) throw new Error("id と name は必須です");
  if (!["midi", "ble"].includes(p.transport)) throw new Error('transport は "midi" か "ble" です');
  if (!Array.isArray(p.controls)) throw new Error("controls は配列である必要があります");
  for (const c of p.controls) {
    if (!c.id || !c.label) throw new Error("各 control に id と label が必要です");
    if (!["knob", "toggle"].includes(c.type)) throw new Error(`control "${c.id}" の type は knob / toggle です`);
  }
  return p;
}

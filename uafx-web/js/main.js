import { midi } from "./midi.js";
import { ble } from "./ble.js";
import { usb } from "./usb.js";
import { log, toast, parseHex, fillTemplate, clearLog, exportLog, download } from "./util.js";
import {
  BUILTIN_PROFILES, loadProfiles, saveProfiles, loadActiveId, saveActiveId, validateProfile,
} from "./profiles.js";

const $ = (id) => document.getElementById(id);

let profiles = loadProfiles();
let active = profiles.find((p) => p.id === loadActiveId()) ?? profiles[0];
const values = new Map(); // control id -> current value
let learning = null; // control id waiting for an incoming CC

// ---------- support check ----------
{
  const missing = [];
  if (!midi.supported) missing.push("Web MIDI");
  if (!ble.supported) missing.push("Web Bluetooth");
  if (!usb.supported) missing.push("WebUSB");
  if (!window.isSecureContext) missing.unshift("secure context（https か localhost で開いてください）");
  if (missing.length) {
    $("support-banner").textContent = `このブラウザでは次が使えません: ${missing.join(" / ")}。PC 版の Chrome か Edge を推奨します。`;
    $("support-banner").hidden = false;
  }
}

// ---------- tabs ----------
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tab")) t.classList.toggle("is-active", t === tab);
    for (const p of document.querySelectorAll(".panel")) p.hidden = p.dataset.panel !== tab.dataset.tab;
  });
}

function run(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err?.name === "NotFoundError") return; // user cancelled a device chooser
      log("err", "APP", err.message ?? String(err));
      toast(err.message ?? String(err));
    }
  };
}

// ---------- sending through the active profile ----------
async function sendControl(control, value) {
  if (active.transport === "midi") {
    const cc = control.midi?.cc;
    if (cc === null || cc === undefined) {
      toast(`「${control.label}」の CC 番号が未割当です`);
      return;
    }
    midi.cc(channel(), cc, value);
  } else {
    if (!control.ble) {
      toast(`「${control.label}」の BLE テンプレートが未設定です`);
      return;
    }
    await ble.write(active.ble.characteristic, fillTemplate(control.ble, value), active.ble.withResponse);
  }
}

async function sendPreset(index) {
  const p = active.presets;
  if (p.type === "pc") {
    midi.programChange(channel(), (p.base ?? 0) + index);
  } else {
    if (!p.template) {
      toast("プリセット用 BLE テンプレートが未設定です");
      return;
    }
    await ble.write(active.ble.characteristic, fillTemplate(p.template, index), active.ble.withResponse);
  }
}

function channel() {
  return Math.min(16, Math.max(1, Number($("midi-ch").value) || 1));
}

function updateStatus() {
  const on = active.transport === "midi" ? midi.connected : ble.connected;
  const el = $("transport-status");
  el.textContent = `${active.transport.toUpperCase()} ${on ? "接続中" : "未接続"}`;
  el.className = `status ${on ? "status-on" : "status-off"}`;
}

// ---------- control panel rendering ----------
function renderProfileSelect() {
  const sel = $("profile-select");
  sel.replaceChildren(...profiles.map((p) => new Option(p.name, p.id, false, p.id === active.id)));
  $("profile-note").textContent = active.note ?? "";
  $("profile-json").value = JSON.stringify(active, null, 2);
}

function renderPresets() {
  const wrap = $("preset-buttons");
  wrap.replaceChildren();
  const p = active.presets;
  if (!p) return;
  for (let i = 0; i < p.count; i++) {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = p.labels?.[i] ?? `Preset ${i + 1}`;
    btn.addEventListener("click", run(async () => {
      await sendPreset(i);
      for (const b of wrap.children) b.classList.toggle("is-active", b === btn);
    }));
    wrap.appendChild(btn);
  }
}

function renderControls() {
  const wrap = $("controls");
  wrap.replaceChildren();
  for (const c of active.controls) {
    if (!values.has(c.id)) values.set(c.id, c.default ?? 0);
    const card = document.createElement("div");
    card.className = "control";
    card.dataset.id = c.id;

    const label = document.createElement("div");
    label.className = "control-label";
    label.textContent = c.label;

    const valueEl = document.createElement("div");
    valueEl.className = "control-value";

    const widget = c.type === "toggle" ? buildToggle(c, valueEl) : buildKnob(c, valueEl);
    card.append(label, widget, valueEl, buildMeta(c));
    wrap.appendChild(card);
  }
}

function buildKnob(c, valueEl) {
  const el = document.createElement("div");
  el.className = "knob";
  el.tabIndex = 0;
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", c.label);
  el.setAttribute("aria-valuemin", c.min);
  el.setAttribute("aria-valuemax", c.max);

  let pending = null;
  const paint = (v) => {
    const ratio = (v - c.min) / (c.max - c.min || 1);
    el.style.setProperty("--angle", `${ratio * 270}deg`);
    el.setAttribute("aria-valuenow", v);
    valueEl.textContent = `${v}  (${(ratio * 10).toFixed(1)})`;
  };
  // Coalesce rapid drags into one message per animation frame.
  const set = (v) => {
    v = Math.min(c.max, Math.max(c.min, Math.round(v)));
    if (v === values.get(c.id)) return;
    values.set(c.id, v);
    paint(v);
    if (pending === null) {
      pending = requestAnimationFrame(() => {
        pending = null;
        run(sendControl)(c, values.get(c.id));
      });
    }
  };
  paint(values.get(c.id));

  let startY = 0;
  let startV = 0;
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startV = values.get(c.id);
  });
  el.addEventListener("pointermove", (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const range = c.max - c.min;
    set(startV + ((startY - e.clientY) / 200) * range * (e.shiftKey ? 0.2 : 1));
  });
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    set(values.get(c.id) + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });
  el.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") set(values.get(c.id) + step);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(values.get(c.id) - step);
    else if (e.key === "Home") set(c.min);
    else if (e.key === "End") set(c.max);
    else return;
    e.preventDefault();
  });
  el.addEventListener("dblclick", () => set(c.default ?? c.min));
  el.paint = paint;
  return el;
}

function buildToggle(c, valueEl) {
  const el = document.createElement("button");
  el.className = "toggle";
  el.setAttribute("aria-label", c.label);
  const paint = (v) => {
    const on = v === c.on;
    el.setAttribute("aria-pressed", String(on));
    valueEl.textContent = on ? "ON" : "OFF";
  };
  paint(values.get(c.id));
  el.addEventListener("click", run(async () => {
    const v = values.get(c.id) === c.on ? c.off : c.on;
    values.set(c.id, v);
    paint(v);
    await sendControl(c, v);
  }));
  el.paint = paint;
  return el;
}

function buildMeta(c) {
  const meta = document.createElement("div");
  meta.className = "control-meta row";
  if (active.transport !== "midi") {
    meta.textContent = c.ble ? `BLE: ${c.ble}` : "BLE: 未設定";
    return meta;
  }
  const cc = document.createElement("input");
  cc.type = "number";
  cc.min = 0;
  cc.max = 127;
  cc.className = "num";
  cc.placeholder = "CC#";
  cc.title = "CC 番号";
  cc.value = c.midi?.cc ?? "";
  cc.addEventListener("change", () => assignCc(c.id, cc.value === "" ? null : Number(cc.value)));

  const learn = document.createElement("button");
  learn.className = "btn learn-btn";
  learn.textContent = "Learn";
  learn.addEventListener("click", () => {
    learning = learning === c.id ? null : c.id;
    for (const b of document.querySelectorAll(".learn-btn")) b.classList.remove("is-learning");
    if (learning) {
      learn.classList.add("is-learning");
      toast("ペダル本体のノブを回してください（MIDI 入力が必要）");
    }
  });
  meta.append("CC", cc, learn);
  return meta;
}

function assignCc(controlId, cc) {
  const c = active.controls.find((x) => x.id === controlId);
  c.midi = { ...(c.midi ?? {}), cc };
  persist();
  renderControls();
  $("profile-json").value = JSON.stringify(active, null, 2);
  log("sys", "APP", `「${c.label}」に CC ${cc ?? "未割当"} を割り当てました`);
}

function persist() {
  profiles = profiles.map((p) => (p.id === active.id ? active : p));
  saveProfiles(profiles);
}

function applyActive() {
  saveActiveId(active.id);
  renderProfileSelect();
  renderPresets();
  renderControls();
  updateStatus();
}

// Incoming MIDI: drive Learn, and mirror pedal-side knob moves into the UI.
midi.onMessage((data) => {
  if ((data[0] & 0xf0) !== 0xb0) return;
  const [, number, value] = data;
  if (learning) {
    const id = learning;
    learning = null;
    values.set(id, value);
    assignCc(id, number);
    toast(`CC ${number} を割り当てました`);
    return;
  }
  if (active.transport !== "midi") return;
  for (const c of active.controls) {
    if (c.midi?.cc !== number) continue;
    const v = c.type === "toggle" ? (value >= 64 ? c.on : c.off) : value;
    values.set(c.id, v);
    document.querySelector(`.control[data-id="${CSS.escape(c.id)}"] :is(.knob, .toggle)`)?.paint(v);
  }
});

$("profile-select").addEventListener("change", (e) => {
  active = profiles.find((p) => p.id === e.target.value);
  values.clear();
  applyActive();
});

// ---------- MIDI tab ----------
function fillMidiPorts() {
  const fill = (sel, ports) => {
    const prev = sel.value;
    sel.replaceChildren(new Option("（なし）", ""), ...ports.map((p) => new Option(p.name, p.id)));
    // Prefer the previously chosen port, else anything that looks like a UA device.
    const guess = ports.find((p) => p.id === prev) ?? ports.find((p) => /uafx|universal audio|\bua\b/i.test(`${p.name} ${p.manufacturer}`));
    sel.value = guess?.id ?? "";
  };
  fill($("midi-out"), midi.outputs());
  fill($("midi-in"), midi.inputs());
  midi.selectOutput($("midi-out").value);
  midi.selectInput($("midi-in").value);
  updateStatus();
}

$("midi-enable").addEventListener("click", run(async () => {
  const access = await midi.enable();
  access.onstatechange = (e) => {
    log("sys", "MIDI", `${e.port.type} "${e.port.name}" ${e.port.state}`);
    fillMidiPorts();
  };
  fillMidiPorts();
}));
$("midi-out").addEventListener("change", (e) => { midi.selectOutput(e.target.value); updateStatus(); });
$("midi-in").addEventListener("change", (e) => midi.selectInput(e.target.value));
$("cc-send").addEventListener("click", run(() => midi.cc(channel(), Number($("cc-num").value), Number($("cc-val").value))));
$("pc-send").addEventListener("click", run(() => midi.programChange(channel(), Number($("pc-num").value))));
$("raw-midi-send").addEventListener("click", run(() => midi.send(parseHex($("raw-midi").value))));
$("sweep-run").addEventListener("click", run(async () => {
  const from = Number($("sweep-from").value);
  const to = Number($("sweep-to").value);
  for (let n = from; n <= to; n++) {
    midi.cc(channel(), n, 64);
    await new Promise((r) => setTimeout(r, 150));
  }
}));

// ---------- BLE tab ----------
$("ble-connect").addEventListener("click", run(async () => {
  const services = $("ble-services").value.split(",").map((s) => s.trim()).filter(Boolean)
    .map((s) => (/^[0-9a-f]{4}$/i.test(s) ? parseInt(s, 16) : s.toLowerCase()));
  const { tree } = await ble.connect({ services, namePrefix: $("ble-name-prefix").value.trim() });
  $("ble-disconnect").disabled = false;
  renderBleTree(tree);
  updateStatus();
}));
$("ble-disconnect").addEventListener("click", () => ble.disconnect());
ble.onDisconnect = () => {
  $("ble-disconnect").disabled = true;
  $("ble-tree").textContent = "未接続";
  updateStatus();
};

function renderBleTree(tree) {
  const root = $("ble-tree");
  root.replaceChildren();
  root.classList.remove("muted");
  if (!tree.length) {
    root.textContent = "アクセス可能なサービスがありません。サービス UUID を申告して再接続してください。";
    return;
  }
  for (const svc of tree) {
    const s = document.createElement("div");
    s.className = "svc";
    s.innerHTML = `<div class="svc-uuid mono"></div>`;
    s.firstChild.textContent = `Service ${svc.uuid}`;
    for (const c of svc.characteristics) s.appendChild(buildChr(c));
    root.appendChild(s);
  }
}

function buildChr(c) {
  const el = document.createElement("div");
  el.className = "chr";
  const head = document.createElement("div");
  head.className = "chr-uuid mono";
  head.textContent = c.uuid;
  const props = document.createElement("div");
  props.className = "chr-props";
  props.textContent = c.properties.join(", ");
  const row = document.createElement("div");
  row.className = "row";

  const action = (text, fn) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = text;
    b.addEventListener("click", run(fn));
    row.appendChild(b);
  };
  if (c.properties.includes("read")) action("Read", () => ble.read(c.uuid));
  if (c.properties.includes("notify") || c.properties.includes("indicate")) action("Subscribe", () => ble.subscribe(c.uuid));
  if (c.properties.includes("write") || c.properties.includes("writeWithoutResponse")) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "grow mono";
    input.placeholder = "hex";
    row.appendChild(input);
    action("Write", () => ble.write(c.uuid, parseHex(input.value), c.properties.includes("write")));
    action("プロファイルに設定", () => {
      if (active.transport !== "ble") throw new Error("BLE プロファイルを選択してから設定してください");
      active.ble = { ...active.ble, characteristic: c.uuid };
      persist();
      applyActive();
      toast("書き込み先キャラクタリスティックを設定しました");
    });
  }
  el.append(head, props, row);
  return el;
}

// ---------- USB tab ----------
$("usb-pick").addEventListener("click", run(async () => {
  $("usb-info").textContent = await usb.pick();
}));
$("usb-claim").addEventListener("click", run(() => usb.claim(Number($("usb-iface").value))));
$("usb-send").addEventListener("click", run(() => usb.send(Number($("usb-ep-out").value), parseHex($("usb-data").value))));
$("usb-read").addEventListener("click", run(() => usb.read(Number($("usb-ep-in").value))));

// ---------- profile tab ----------
$("profile-save").addEventListener("click", run(() => {
  const parsed = validateProfile(JSON.parse($("profile-json").value));
  if (parsed.id !== active.id && profiles.some((p) => p.id === parsed.id)) {
    throw new Error(`id "${parsed.id}" は既に使われています`);
  }
  profiles = profiles.map((p) => (p.id === active.id ? parsed : p));
  active = parsed;
  saveProfiles(profiles);
  values.clear();
  applyActive();
  toast("保存しました");
}));
$("profile-new").addEventListener("click", () => {
  const copy = structuredClone(active);
  copy.id = `${active.id}-${Date.now().toString(36)}`;
  copy.name = `${active.name} (コピー)`;
  profiles.push(copy);
  active = copy;
  saveProfiles(profiles);
  applyActive();
  toast("複製しました");
});
$("profile-export").addEventListener("click", () => {
  download(`${active.id}.json`, JSON.stringify(active, null, 2), "application/json");
});
$("profile-import").addEventListener("change", run(async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const parsed = validateProfile(JSON.parse(await file.text()));
  profiles = profiles.filter((p) => p.id !== parsed.id).concat(parsed);
  active = parsed;
  saveProfiles(profiles);
  values.clear();
  applyActive();
  toast(`「${parsed.name}」を読み込みました`);
}));
$("profile-delete").addEventListener("click", () => {
  if (profiles.length <= 1) return toast("最後のプロファイルは削除できません");
  if (!confirm(`「${active.name}」を削除しますか？`)) return;
  profiles = profiles.filter((p) => p.id !== active.id);
  active = profiles[0];
  saveProfiles(profiles);
  applyActive();
});
$("profile-reset").addEventListener("click", () => {
  if (!confirm("同梱プロファイルに戻します。編集・追加したプロファイルは消えます。よろしいですか？")) return;
  profiles = structuredClone(BUILTIN_PROFILES);
  active = profiles[0];
  saveProfiles(profiles);
  values.clear();
  applyActive();
});

// ---------- log ----------
$("log-clear").addEventListener("click", clearLog);
$("log-export").addEventListener("click", exportLog);

applyActive();
log("sys", "APP", "起動しました。まず「MIDI」タブで MIDI を有効化してください。");

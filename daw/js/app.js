// 画面の組み立てとイベント処理。

import { BEATS_PER_BAR, pcName, midiToName, keyName, suggestNextChords } from "./theory.js";
import { sortChords, chordAt, DRUM } from "./generate.js";
import { Store, createDefaultProject, createProject, createTrack, normalizeNotes, INSTRUMENTS } from "./project.js";
import { runAction, findAction } from "./actions.js";
import { parseCommand, HELP_TEXT } from "./operator.js";
import { analyzeProject } from "./assistant.js";
import { projectToMidi, parseMidi } from "./midi.js";
import { Library, analyzeSong, describeSong, classifyParts, roleJa } from "./library.js";
import { StudioProRemote } from "./studiopro.js";
import { Engine } from "./engine.js";
import { ClaudeOperator, MODELS } from "./claude.js";

const PROJECT_KEY = "daruma-daw-project";
const SETTINGS_KEY = "daruma-daw-settings";

// ---------- 保存 ----------
function loadJSON(key) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 保存できない環境（プライベートモード等）では無視 */
  }
}

function isValidProject(p) {
  return p && typeof p === "object" && Array.isArray(p.tracks) && Array.isArray(p.chords) && p.key && Number.isFinite(p.bpm);
}

const saved = loadJSON(PROJECT_KEY);
const store = new Store(isValidProject(saved) ? saved : createDefaultProject());
const settings = { apiKey: "", model: MODELS[0].id, useClaude: false, midiOutId: "", studioOutId: "", internalSynth: true, notes: "", ...(loadJSON(SETTINGS_KEY) || {}) };
const library = new Library();
const studio = new StudioProRemote();

const engine = new Engine(() => store.project);
engine.useInternalSynth = settings.internalSynth;

const ctx = {
  store,
  transport: {
    play: () => engine.play(),
    stop: () => engine.stop(),
    isPlaying: () => engine.isPlaying(),
  },
  exportMidi,
  library,
  studio,
};

let selectedTrackId = store.project.tracks[0]?.id ?? null;
let claude = null;

const $ = (id) => document.getElementById(id);

// ---------- ヘッダー ----------
const keyRootSel = $("key-root");
for (let pc = 0; pc < 12; pc++) {
  const o = document.createElement("option");
  o.value = pc;
  o.textContent = pcName(pc, { root: pc, mode: "major" });
  keyRootSel.append(o);
}

function renderHeader() {
  const p = store.project;
  if (document.activeElement !== $("title")) $("title").value = p.title;
  if (document.activeElement !== $("bpm")) $("bpm").value = p.bpm;
  if (document.activeElement !== $("bars")) $("bars").value = p.bars;
  keyRootSel.value = p.key.root;
  $("key-mode").value = p.key.mode;
  $("loop").checked = p.loop.enabled;
  $("undo").disabled = !store.undoStack.length;
  $("redo").disabled = !store.redoStack.length;
}

$("title").addEventListener("change", (e) => store.commit("曲名", (p) => (p.title = e.target.value.trim() || "無題の曲")));
$("bpm").addEventListener("change", (e) => report(runAction(ctx, "set_tempo", { bpm: Number(e.target.value) }), true));
$("bars").addEventListener("change", (e) => report(runAction(ctx, "set_length", { bars: Number(e.target.value) }), true));
keyRootSel.addEventListener("change", () => changeKey());
$("key-mode").addEventListener("change", () => changeKey());
function changeKey() {
  const root = Number(keyRootSel.value);
  const mode = $("key-mode").value;
  report(runAction(ctx, "set_key", { key: pcName(root, { root, mode }) + (mode === "minor" ? "m" : "") }), true);
}
$("loop").addEventListener("change", (e) => runAction(ctx, "set_loop", { enabled: e.target.checked }));
$("metronome").addEventListener("change", (e) => (engine.metronome = e.target.checked));
$("play").addEventListener("click", togglePlay);
$("undo").addEventListener("click", () => report(runAction(ctx, "undo"), true));
$("redo").addEventListener("click", () => report(runAction(ctx, "redo"), true));
$("export-midi").addEventListener("click", () => report(runAction(ctx, "export_midi"), true));

function togglePlay() {
  if (engine.isPlaying()) engine.stop();
  else engine.play();
  renderPlayButton();
}
function renderPlayButton() {
  $("play").textContent = engine.isPlaying() ? "■ 停止" : "▶ 再生";
}

engine.onPosition = (beat) => {
  renderPlayButton();
  const ph = $("playhead");
  if (beat == null) {
    ph.hidden = true;
    $("position").textContent = "1.1";
    return;
  }
  const bar = Math.floor(beat / BEATS_PER_BAR);
  $("position").textContent = `${bar + 1}.${Math.floor(beat % BEATS_PER_BAR) + 1}`;
  ph.hidden = false;
  ph.style.left = `${beat * roll.ppb}px`;
  // 再生位置が見えなくなったら追従スクロール
  const sc = $("roll-scroll");
  const x = beat * roll.ppb;
  if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = Math.max(0, x - 40);
};

// メニュー
$("menu-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("menu").hidden = !$("menu").hidden;
});
document.addEventListener("click", () => ($("menu").hidden = true));
$("menu").addEventListener("click", (e) => {
  const item = e.target.closest("[data-menu]")?.dataset.menu;
  if (item === "new") {
    if (confirm("新しいプロジェクトを作りますか？（今の曲は「元に戻す」で戻せます）")) {
      engine.stop();
      store.replace(createDefaultProject());
      selectedTrackId = store.project.tracks[0]?.id;
      claude?.reset();
    }
  } else if (item === "save") {
    download(new Blob([JSON.stringify(store.project, null, 2)], { type: "application/json" }), `${safeName(store.project.title)}.json`);
  } else if (item === "load") {
    $("load-file").click();
  } else if (item === "settings") {
    openSettings();
  } else if (item === "import-midi") {
    $("import-midi-file").click();
  } else if (item === "export-track") {
    const t = currentTrack();
    if (t) report(runAction(ctx, "export_midi", { track: t.id }), true);
  } else if (item === "library") {
    openLibrary();
  } else if (item === "remote") {
    openRemote();
  }
});
$("load-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const p = JSON.parse(await file.text());
    if (!isValidProject(p)) throw new Error("形式が違います");
    store.replace({ ...createProject(), ...p });
    selectedTrackId = store.project.tracks[0]?.id;
    addMessage("bot", `「${store.project.title}」を開きました。`);
  } catch (err) {
    addMessage("bot", `読み込めませんでした: ${err.message}`);
  }
});

function safeName(s) {
  return (s || "song").replace(/[\\/:*?"<>|]/g, "_");
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportMidi(trackIds) {
  const part = trackIds?.length === 1 ? store.project.tracks.find((t) => t.id === trackIds[0]) : null;
  const name = `${safeName(store.project.title)}${part ? "_" + safeName(part.name) : ""}.mid`;
  download(new Blob([projectToMidi(store.project, { trackIds })], { type: "audio/midi" }), name);
  return name;
}

// ---------- トラック ----------
function renderTracks() {
  const p = store.project;
  if (!p.tracks.some((t) => t.id === selectedTrackId)) selectedTrackId = p.tracks[0]?.id ?? null;
  const list = $("track-list");
  list.replaceChildren(
    ...p.tracks.map((t) => {
      const li = document.createElement("li");
      li.className = "track" + (t.id === selectedTrackId ? " selected" : "");
      li.dataset.id = t.id;

      const row1 = document.createElement("div");
      row1.className = "track-row";
      const name = document.createElement("input");
      name.className = "track-name";
      name.value = t.name;
      name.setAttribute("aria-label", "トラック名");
      name.addEventListener("change", () => runAction(ctx, "set_track", { track: t.id, name: name.value.trim() || t.name }));
      const count = document.createElement("span");
      count.className = "track-count";
      count.textContent = `${t.notes.length}`;
      const del = document.createElement("button");
      del.className = "icon-btn";
      del.title = "トラック削除";
      del.textContent = "✕";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!t.notes.length || confirm(`「${t.name}」を削除しますか？`)) report(runAction(ctx, "remove_track", { track: t.id }), true);
      });
      row1.append(name, count, del);

      const row2 = document.createElement("div");
      row2.className = "track-row";
      const inst = document.createElement("select");
      inst.setAttribute("aria-label", "楽器");
      for (const [id, label] of Object.entries(INSTRUMENTS)) inst.append(new Option(label, id, false, id === t.instrument));
      inst.addEventListener("change", () => runAction(ctx, "set_track", { track: t.id, instrument: inst.value }));
      const mute = msButton("M", "mute", t.mute, () => runAction(ctx, "set_track", { track: t.id, mute: !t.mute }));
      const solo = msButton("S", "solo", t.solo, () => runAction(ctx, "set_track", { track: t.id, solo: !t.solo }));
      row2.append(inst, mute, solo);

      const row3 = document.createElement("div");
      row3.className = "track-row";
      const vol = document.createElement("input");
      vol.type = "range";
      vol.min = 0;
      vol.max = 1;
      vol.step = 0.01;
      vol.value = t.volume;
      vol.setAttribute("aria-label", "音量");
      vol.addEventListener("change", () => runAction(ctx, "set_track", { track: t.id, volume: Number(vol.value) }));
      row3.append(vol);

      li.append(row1, row2, row3);
      li.addEventListener("click", (e) => {
        if (e.target.closest("input, select, button")) return;
        selectedTrackId = t.id;
        renderTracks();
        renderRoll(true);
      });
      return li;
    }),
  );
}

function msButton(label, kind, on, onClick) {
  const b = document.createElement("button");
  b.className = `ms ${kind}` + (on ? " on" : "");
  b.textContent = label;
  b.title = kind === "mute" ? "ミュート" : "ソロ";
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

$("add-track").addEventListener("click", () => {
  const inst = prompt(`楽器を選んでください: ${Object.entries(INSTRUMENTS).map(([k, v]) => `${v}(${k})`).join(", ")}`, "piano");
  if (!inst) return;
  const r = runAction(ctx, "add_track", { instrument: inst.trim() });
  report(r, true);
  if (r.ok) {
    selectedTrackId = store.project.tracks[store.project.tracks.length - 1].id;
    renderTracks();
    renderRoll(true);
  }
});

// ---------- ピアノロール ----------
const HEADER_H = 40;
const MELODIC_TOP = 96; // C7
const MELODIC_BOTTOM = 24; // C1
const DRUM_ROWS = [
  [DRUM.crash, "クラッシュ"],
  [DRUM.ride, "ライド"],
  [DRUM.hatOpen, "OHハット"],
  [DRUM.hatClosed, "ハット"],
  [DRUM.tomHigh, "タム高"],
  [DRUM.tomLow, "タム低"],
  [DRUM.clap, "クラップ"],
  [DRUM.snare, "スネア"],
  [DRUM.kick, "キック"],
];

const roll = {
  ppb: 40, // 1拍あたりのピクセル
  grid: 0.25,
  noteLen: 1,
  draft: null,
  lastTrackId: null,
};

const rollCanvas = $("roll");
const rollScroll = $("roll-scroll");
const header = document.createElement("canvas");
header.style.cssText = "position:sticky;top:0;display:block;z-index:2;cursor:pointer";
rollScroll.prepend(header);
const keysCanvas = document.createElement("canvas");
const keysCover = document.createElement("div"); // ヘッダー（小節番号・コード）の高さぶん鍵盤を隠す
keysCover.style.cssText = `position:absolute;top:0;left:0;right:0;height:${HEADER_H}px;background:var(--panel);z-index:1;border-bottom:1px solid var(--line)`;
$("roll-keys").append(keysCanvas, keysCover);

function currentTrack() {
  return store.project.tracks.find((t) => t.id === selectedTrackId) || null;
}

function rowsFor(track) {
  if (track?.instrument === "drums") return { rowH: 22, count: DRUM_ROWS.length, pitchOf: (r) => DRUM_ROWS[r]?.[0], rowOf: (p) => DRUM_ROWS.findIndex(([x]) => x === p) };
  return { rowH: 14, count: MELODIC_TOP - MELODIC_BOTTOM + 1, pitchOf: (r) => MELODIC_TOP - r, rowOf: (p) => MELODIC_TOP - p };
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function setupCanvas(c, w, h) {
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.ceil(w * dpr);
  c.height = Math.ceil(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

function renderRoll(scrollToNotes = false) {
  const p = store.project;
  const track = currentTrack();
  const rows = rowsFor(track);
  const totalBeats = p.bars * BEATS_PER_BAR;
  const width = Math.max(totalBeats * roll.ppb, rollScroll.clientWidth);
  const height = rows.count * rows.rowH;
  const colors = {
    bg: cssVar("--roll-bg"),
    black: cssVar("--roll-black"),
    line: cssVar("--roll-line"),
    bar: cssVar("--roll-bar"),
    lane: cssVar("--chord-lane"),
    note: cssVar("--note"),
    border: cssVar("--note-border"),
    text: cssVar("--text"),
    muted: cssVar("--muted"),
    accent: cssVar("--accent"),
  };
  $("editor-title").textContent = track ? `ピアノロール — ${track.name}（${INSTRUMENTS[track.instrument]}）` : "ピアノロール";

  // ヘッダー（小節番号・コード）
  const hg = setupCanvas(header, width, HEADER_H);
  hg.fillStyle = cssVar("--panel");
  hg.fillRect(0, 0, width, HEADER_H);
  hg.fillStyle = colors.lane;
  hg.fillRect(0, 16, width, HEADER_H - 16);
  if (p.loop.enabled) {
    hg.fillStyle = colors.accent;
    hg.globalAlpha = 0.18;
    hg.fillRect(p.loop.startBar * BEATS_PER_BAR * roll.ppb, 0, (p.loop.endBar - p.loop.startBar) * BEATS_PER_BAR * roll.ppb, 16);
    hg.globalAlpha = 1;
  }
  hg.font = "11px system-ui, sans-serif";
  hg.textBaseline = "middle";
  for (let b = 0; b < p.bars; b++) {
    const x = b * BEATS_PER_BAR * roll.ppb;
    hg.fillStyle = colors.bar;
    hg.fillRect(x, 0, 1, HEADER_H);
    hg.fillStyle = colors.muted;
    hg.fillText(String(b + 1), x + 4, 8);
  }
  const chords = sortChords(p.chords);
  hg.font = "600 12px system-ui, sans-serif";
  chords.forEach((c) => {
    const x = (c.bar * BEATS_PER_BAR + (c.beat || 0)) * roll.ppb;
    hg.fillStyle = colors.text;
    hg.fillText(c.symbol, x + 5, 28);
  });

  // 本体
  const g = setupCanvas(rollCanvas, width, height);
  g.fillStyle = colors.bg;
  g.fillRect(0, 0, width, height);
  for (let r = 0; r < rows.count; r++) {
    const pitch = rows.pitchOf(r);
    if (track?.instrument !== "drums" && [1, 3, 6, 8, 10].includes(pitch % 12)) {
      g.fillStyle = colors.black;
      g.fillRect(0, r * rows.rowH, width, rows.rowH);
    }
    g.fillStyle = colors.line;
    g.fillRect(0, (r + 1) * rows.rowH - 1, width, 1);
    if (track?.instrument !== "drums" && pitch % 12 === 0) {
      g.fillStyle = colors.bar;
      g.fillRect(0, (r + 1) * rows.rowH - 1, width, 1);
    }
  }
  for (let b = 0; b <= totalBeats; b += roll.grid) {
    const x = Math.round(b * roll.ppb);
    g.fillStyle = b % BEATS_PER_BAR === 0 ? colors.bar : b % 1 === 0 ? colors.line : colors.line;
    g.globalAlpha = b % 1 === 0 ? 1 : 0.45;
    g.fillRect(x, 0, 1, height);
  }
  g.globalAlpha = 1;

  // 他トラックのノートをうっすら（ゴースト）
  if (track && track.instrument !== "drums") {
    g.fillStyle = colors.muted;
    g.globalAlpha = 0.18;
    for (const t of p.tracks) {
      if (t === track || t.instrument === "drums") continue;
      for (const n of t.notes) {
        const r = rows.rowOf(n.pitch);
        if (r < 0 || r >= rows.count) continue;
        g.fillRect(n.start * roll.ppb, r * rows.rowH + 3, Math.max(2, n.duration * roll.ppb), rows.rowH - 6);
      }
    }
    g.globalAlpha = 1;
  }

  if (track) {
    const notes = roll.draft && roll.draft.trackId === track.id ? [...track.notes, roll.draft.note] : track.notes;
    for (const n of notes) {
      const r = rows.rowOf(n.pitch);
      if (r < 0 || r >= rows.count) continue;
      const x = n.start * roll.ppb;
      const w = Math.max(3, n.duration * roll.ppb - 1);
      g.fillStyle = colors.note;
      g.globalAlpha = 0.45 + (n.velocity / 127) * 0.55;
      g.fillRect(x, r * rows.rowH + 1, w, rows.rowH - 2);
      g.globalAlpha = 1;
      g.strokeStyle = colors.border;
      g.strokeRect(x + 0.5, r * rows.rowH + 1.5, w - 1, rows.rowH - 3);
    }
  }

  // 鍵盤
  const kg = setupCanvas(keysCanvas, 44, height + HEADER_H);
  kg.fillStyle = cssVar("--panel");
  kg.fillRect(0, 0, 44, height + HEADER_H);
  kg.font = "10px system-ui, sans-serif";
  kg.textBaseline = "middle";
  for (let r = 0; r < rows.count; r++) {
    const pitch = rows.pitchOf(r);
    const y = HEADER_H + r * rows.rowH;
    if (track?.instrument === "drums") {
      kg.fillStyle = colors.text;
      kg.fillText(DRUM_ROWS[r][1], 3, y + rows.rowH / 2);
    } else {
      const black = [1, 3, 6, 8, 10].includes(pitch % 12);
      kg.fillStyle = black ? colors.muted : cssVar("--panel");
      kg.fillRect(0, y, black ? 28 : 44, rows.rowH);
      if (pitch % 12 === 0) {
        kg.fillStyle = colors.text;
        kg.fillText(midiToName(pitch), 14, y + rows.rowH / 2);
      }
    }
    kg.fillStyle = colors.line;
    kg.fillRect(0, y + rows.rowH - 1, 44, 1);
  }

  $("playhead").style.top = "0px";
  $("playhead").style.height = `${height + HEADER_H}px`;

  if (scrollToNotes || roll.lastTrackId !== track?.id) {
    roll.lastTrackId = track?.id;
    const ns = track?.notes || [];
    const center = ns.length ? ns.reduce((a, n) => a + rows.rowOf(n.pitch), 0) / ns.length : rows.rowOf(64);
    rollScroll.scrollTop = Math.max(0, center * rows.rowH - rollScroll.clientHeight / 2);
  }
  syncKeys();
}

function syncKeys() {
  keysCanvas.style.transform = `translateY(${-rollScroll.scrollTop}px)`;
}
rollScroll.addEventListener("scroll", syncKeys);

function hitTest(e) {
  const rect = rollCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const track = currentTrack();
  const rows = rowsFor(track);
  const row = Math.floor(y / rows.rowH);
  return { beat: x / roll.ppb, pitch: rows.pitchOf(row), row };
}

rollCanvas.addEventListener("pointerdown", (e) => {
  const track = currentTrack();
  if (!track || e.button > 0) return;
  const { beat, pitch } = hitTest(e);
  if (pitch == null) return;
  const hit = track.notes.findIndex((n) => n.pitch === pitch && beat >= n.start && beat < n.start + n.duration);
  if (hit >= 0) {
    store.commit("ノート削除", (p) => {
      const t = p.tracks.find((x) => x.id === track.id);
      t.notes.splice(hit, 1);
    });
    return;
  }
  const start = Math.floor(beat / roll.grid) * roll.grid;
  const len = track.instrument === "drums" ? roll.grid : roll.noteLen;
  roll.draft = { trackId: track.id, note: { pitch, start, duration: len, velocity: 96 }, origin: start };
  rollCanvas.setPointerCapture(e.pointerId);
  engine.preview(track, pitch, 96);
  renderRoll();
});

rollCanvas.addEventListener("pointermove", (e) => {
  if (!roll.draft) return;
  const { beat } = hitTest(e);
  const end = Math.ceil(beat / roll.grid) * roll.grid;
  if (end > roll.draft.origin + roll.grid) roll.draft.note.duration = end - roll.draft.origin;
  renderRoll();
});

function finishDraft() {
  if (!roll.draft) return;
  const { trackId, note } = roll.draft;
  roll.draft = null;
  store.commit("ノート入力", (p) => {
    const t = p.tracks.find((x) => x.id === trackId);
    if (t) t.notes = normalizeNotes([...t.notes, note]);
  });
}
rollCanvas.addEventListener("pointerup", finishDraft);
rollCanvas.addEventListener("pointercancel", () => {
  roll.draft = null;
  renderRoll();
});

// コードレーンのクリック → その小節のコード候補を提示
header.addEventListener("click", (e) => {
  const rect = header.getBoundingClientRect();
  const beat = (e.clientX - rect.left) / roll.ppb;
  const bar = Math.floor(beat / BEATS_PER_BAR);
  if (e.clientY - rect.top < 16) {
    // 小節番号の段 → そこから再生
    engine.play(bar * BEATS_PER_BAR);
    renderPlayButton();
    return;
  }
  const p = store.project;
  const chords = sortChords(p.chords);
  const prev = chordAt(chords, bar * BEATS_PER_BAR - 0.01);
  const cur = chordAt(chords, bar * BEATS_PER_BAR);
  const list = suggestNextChords(prev && prev !== cur ? prev.symbol : bar > 0 ? prev?.symbol : null, p.key);
  addMessage("bot", `${bar + 1} 小節目のコード候補（前: ${prev && prev !== cur ? prev.symbol : "なし"}）`, list.map((s) => ({ label: `${s.chord} — ${s.reason}`, action: "write_chords", input: { chords: [s.chord], start_bar: bar + 1 } })));
});

$("grid").addEventListener("change", (e) => {
  roll.grid = Number(e.target.value);
  renderRoll();
});
$("note-len").addEventListener("change", (e) => (roll.noteLen = Number(e.target.value)));
$("zoom").addEventListener("input", (e) => {
  roll.ppb = Number(e.target.value);
  renderRoll();
});
window.addEventListener("resize", () => renderRoll());
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => renderRoll());

// ---------- オペレーター（チャット） ----------
const chat = $("chat");

function addMessage(role, text, chips = []) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  if (chips.length) {
    const box = document.createElement("div");
    box.className = "chips";
    for (const c of chips) box.append(chipButton(c));
    div.append(box);
  }
  chat.append(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

/** chip: {label, command} か {label, action, input} */
function chipButton(c) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.textContent = c.label;
  b.addEventListener("click", () => {
    if (c.action) {
      addMessage("user", c.label);
      report(runAction(ctx, c.action, c.input));
    } else {
      handleInput(c.command, { forceRules: true });
    }
  });
  return b;
}

/** アクション結果をチャットに出す。quiet なら失敗時だけ */
function report(r, quiet = false) {
  if (quiet && r.ok) return;
  const chips = [];
  if (r.ok && Array.isArray(r.data)) {
    // 進行の提案 → そのまま使えるボタンに
    for (const item of r.data) {
      if (item.roman && item.id) chips.push({ label: `使う: ${item.name}`, action: "apply_progression", input: { progression_id: item.id } });
      else if (item.chord) chips.push({ label: `${item.chord} を追加`, action: "append_chord", input: { chord: item.chord } });
    }
  }
  if (r.ok && r.data?.ideas) for (const idea of r.data.ideas) chips.push({ label: idea.label, command: idea.command });
  addMessage(r.ok ? "bot" : "tool err", r.message, chips);
}

function runRules(text) {
  const { steps, unknown, help } = parseCommand(text);
  if (help) addMessage("bot", HELP_TEXT);
  for (const s of steps) report(runAction(ctx, s.action, s.input));
  if (unknown.length) {
    const hint = settings.apiKey ? "設定で Claude をオンにすると自由な言い方も通じます。" : "「ヘルプ」で使い方を表示します。";
    addMessage("bot", `「${unknown.join("」「")}」は分かりませんでした。${hint}`);
  }
}

let busy = false;
async function handleInput(text, { forceRules = false } = {}) {
  text = text.trim();
  if (!text || busy) return;
  addMessage("user", text);
  if (forceRules || !settings.useClaude || !settings.apiKey) {
    runRules(text);
    return;
  }
  busy = true;
  const pending = addMessage("bot pending", "考えています…");
  try {
    claude ??= new ClaudeOperator({ apiKey: settings.apiKey, model: settings.model, ctx, notes: settings.notes });
    await claude.send(text, {
      onText: (t) => chat.insertBefore(makeMsg("bot", t), pending),
      onTool: (name, input, r) => chat.insertBefore(makeMsg(r.ok ? "tool" : "tool err", `🎛 ${findAction(name)?.title ?? name}: ${r.message.split("\n")[0]}`), pending),
    });
  } catch (err) {
    chat.insertBefore(makeMsg("tool err", err.message), pending);
  } finally {
    pending.remove();
    busy = false;
    chat.scrollTop = chat.scrollHeight;
  }
}

function makeMsg(role, text) {
  const d = document.createElement("div");
  d.className = `msg ${role}`;
  d.textContent = text;
  return d;
}

$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("chat-input");
  const text = input.value;
  input.value = "";
  handleInput(text);
});
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("chat-form").requestSubmit();
  }
});

// 提案チップ
function renderIdeas() {
  const { ideas } = analyzeProject(store.project);
  const box = $("ideas");
  const fixed = [
    { label: "おまかせで1曲", command: "おまかせで8小節" },
    { label: "進行のアイデア", command: "コード進行の提案" },
    { label: "分析して", command: "分析して" },
  ];
  if (library.songs.length) {
    fixed.unshift({ label: "参考曲の型でアレンジ", command: "参考曲の型でアレンジ" }, { label: "参考曲から進行", command: "参考曲から進行" });
  }
  box.replaceChildren(...[...ideas.slice(0, 3), ...fixed].map(chipButton));
}

function renderModeBadge() {
  const on = settings.useClaude && settings.apiKey;
  const b = $("mode-badge");
  b.textContent = on ? (MODELS.find((m) => m.id === settings.model)?.label.split("（")[0] ?? settings.model) : "ルールモード";
  b.classList.toggle("claude", !!on);
}

// ---------- 設定 ----------
const modelSel = $("model");
for (const m of MODELS) modelSel.append(new Option(m.label, m.id));

async function openSettings() {
  $("api-key").value = settings.apiKey;
  modelSel.value = settings.model;
  $("use-claude").checked = settings.useClaude;
  $("internal-synth").checked = settings.internalSynth;
  $("notes").value = settings.notes;
  await refreshMidiOutputs();
  $("settings").showModal();
}

let midiAccess = null;
async function refreshMidiOutputs() {
  const pairs = [
    [$("midi-out"), settings.midiOutId],
    [$("studio-out"), settings.studioOutId],
  ];
  for (const [sel] of pairs) sel.replaceChildren(new Option("（なし）", ""));
  if (!navigator.requestMIDIAccess) {
    for (const [sel] of pairs) {
      sel.append(new Option("このブラウザは Web MIDI 非対応です（Chrome / Edge を使ってください）", ""));
      sel.disabled = true;
    }
    return;
  }
  try {
    midiAccess ??= await navigator.requestMIDIAccess();
    for (const [sel, current] of pairs) for (const out of midiAccess.outputs.values()) sel.append(new Option(out.name, out.id, false, out.id === current));
  } catch {
    for (const [sel] of pairs) sel.append(new Option("MIDI へのアクセスが許可されませんでした", ""));
  }
}

function applyMidiOut() {
  engine.midiOut = (settings.midiOutId && midiAccess?.outputs.get(settings.midiOutId)) || null;
  studio.setOutput((settings.studioOutId && midiAccess?.outputs.get(settings.studioOutId)) || null);
}

$("settings").addEventListener("close", () => {
  const prevKey = settings.apiKey;
  const prevModel = settings.model;
  settings.apiKey = $("api-key").value.trim();
  settings.model = modelSel.value;
  settings.useClaude = $("use-claude").checked && !!settings.apiKey;
  settings.internalSynth = $("internal-synth").checked;
  settings.midiOutId = $("midi-out").value;
  settings.studioOutId = $("studio-out").value;
  if (settings.studioOutId && settings.studioOutId === settings.midiOutId) {
    // 同じポートに音とコントロール信号を混ぜると Studio Pro が誤動作するので片方を外す
    settings.midiOutId = "";
    addMessage("bot", "「音を送る出力先」と「Mackie Control 用ポート」が同じだったため、音の出力をオフにしました。別々の仮想ポートを使ってください。");
  }
  const prevNotes = settings.notes;
  settings.notes = $("notes").value;
  engine.useInternalSynth = settings.internalSynth;
  applyMidiOut();
  if (prevKey !== settings.apiKey || prevModel !== settings.model || prevNotes !== settings.notes) claude = null;
  saveJSON(SETTINGS_KEY, settings);
  renderModeBadge();
});

// 前回の MIDI 出力を復元（権限がある場合のみ）
if ((settings.midiOutId || settings.studioOutId) && navigator.requestMIDIAccess) {
  navigator
    .requestMIDIAccess()
    .then((a) => {
      midiAccess = a;
      applyMidiOut();
    })
    .catch(() => {});
}

// ---------- MIDI ファイルを開いて編集 ----------
const ROLE_INSTRUMENT = { drums: "drums", bass: "bass", melody: "lead", chords: "piano", other: "pluck" };

$("import-midi-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const midi = parseMidi(await file.arrayBuffer());
    const song = analyzeSong(midi, file.name.replace(/\.midi?$/i, ""));
    const parts = classifyParts(midi.tracks);
    const p = createProject();
    p.title = song.name;
    p.bpm = Math.max(30, Math.min(300, midi.bpm));
    p.key = song.key;
    p.bars = Math.min(256, song.bars);
    p.loop = { enabled: false, startBar: 0, endBar: p.bars };
    p.chords = song.chords.map((c) => ({ bar: Math.floor(c.start / BEATS_PER_BAR), beat: c.start % BEATS_PER_BAR, length: c.length, symbol: chordName(song.key, c) }));
    for (const part of parts) {
      const t = createTrack({ name: part.name || roleJa(part.role), instrument: ROLE_INSTRUMENT[part.role] });
      t.notes = normalizeNotes(part.notes.filter((n) => n.start < p.bars * BEATS_PER_BAR));
      p.tracks.push(t);
    }
    engine.stop();
    store.replace(p);
    selectedTrackId = p.tracks[0]?.id;
    renderRoll(true);
    addMessage("bot", `「${song.name}」を開きました（${p.tracks.length} トラック, ${describeSong(song).key}, ${p.bpm}BPM）。コード表示は自動検出なので目安です。`);
  } catch (err) {
    addMessage("tool err", `MIDI を読み込めませんでした: ${err.message}`);
  }
});

function chordName(key, c) {
  return pcName((key.root + c.interval) % 12, key) + c.quality;
}

// ---------- 参考曲ライブラリ ----------
const libDialog = $("library");

function openLibrary() {
  renderLibrary();
  libDialog.showModal();
}
$("open-library").addEventListener("click", openLibrary);
for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", () => b.closest("dialog").close());

function renderLibrary() {
  renderIdeas();
  $("lib-count").textContent = `${library.songs.length} 曲`;
  $("lib-list").replaceChildren(
    ...library.songs.map((song) => {
      const d = describeSong(song);
      const li = document.createElement("li");
      li.className = "lib-item";
      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("strong");
      name.textContent = song.name;
      const use = document.createElement("button");
      use.className = "btn small";
      use.textContent = "この曲の型でアレンジ";
      use.addEventListener("click", () => {
        libDialog.close();
        addMessage("user", `参考曲「${song.name}」の型でアレンジ`);
        if (!store.project.chords.length) report(runAction(ctx, "library_progression", { source: song.name }));
        report(runAction(ctx, "library_arrange", { source: song.name, parts: ["drums", "bass", "comping", "melody"] }));
      });
      const del = document.createElement("button");
      del.className = "icon-btn";
      del.textContent = "✕";
      del.title = "ライブラリから削除";
      del.addEventListener("click", () => {
        if (confirm(`「${song.name}」をライブラリから削除しますか？`)) {
          library.remove(song.id);
          renderLibrary();
        }
      });
      row.append(name, use, del);
      const meta = document.createElement("div");
      meta.className = "lib-meta";
      meta.textContent = `${d.key} / ${song.bpm}BPM / ${song.bars}小節 / 進行 ${d.progression}\n${d.counts}${d.roles ? " / " + d.roles : ""}`;
      meta.style.whiteSpace = "pre-wrap";
      const tags = document.createElement("input");
      tags.placeholder = "タグ（カンマ区切り）例: ファンク, 90s";
      tags.value = song.tags.join(", ");
      tags.addEventListener("change", () => library.setTags(song.id, tags.value.split(/[,、]/).map((x) => x.trim()).filter(Boolean)));
      li.append(row, meta, tags);
      return li;
    }),
  );
}

async function addLibraryFiles(files) {
  const added = [];
  const failed = [];
  for (const file of files) {
    try {
      const song = analyzeSong(parseMidi(await file.arrayBuffer()), file.name.replace(/\.midi?$/i, ""));
      added.push(song.name);
      if (!library.add(song)) failed.push(`${song.name}（保存容量が足りません。ライブラリを .json に保存して整理してください）`);
    } catch (err) {
      failed.push(`${file.name}: ${err.message}`);
    }
  }
  renderLibrary();
  if (added.length) addMessage("bot", `参考曲を ${added.length} 曲読み込みました: ${added.join("、")}`, [{ label: "参考曲の型でアレンジ", action: "library_arrange", input: {} }, { label: "参考曲から進行", action: "library_progression", input: {} }]);
  if (failed.length) addMessage("tool err", `読み込めなかったもの:\n${failed.join("\n")}`);
}

$("library-files").addEventListener("change", (e) => {
  addLibraryFiles([...e.target.files]);
  e.target.value = "";
});
const drop = $("drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  addLibraryFiles([...e.dataTransfer.files].filter((f) => /\.midi?$/i.test(f.name)));
});
$("lib-export").addEventListener("click", () => download(new Blob([library.exportJSON()], { type: "application/json" }), "daruma-library.json"));
$("lib-import").addEventListener("click", () => $("lib-import-file").click());
$("lib-import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const n = library.importJSON(await file.text());
    renderLibrary();
    addMessage("bot", `ライブラリに ${n} 曲追加しました。`);
  } catch (err) {
    addMessage("tool err", `ライブラリを読み込めませんでした: ${err.message}`);
  }
});

// ---------- Studio Pro リモート ----------
async function openRemote() {
  if (settings.studioOutId && !midiAccess && navigator.requestMIDIAccess) {
    try {
      midiAccess = await navigator.requestMIDIAccess();
      applyMidiOut();
    } catch {
      /* 権限なし */
    }
  }
  $("remote-status").textContent = studio.connected
    ? `接続先: ${studio.output.name}（Mackie Control）。表示中のバンク: トラック ${studio.bank * 8 + 1}〜${studio.bank * 8 + 8}（推定）`
    : "Mackie Control 用ポートが未設定です。「⋯ → 設定」で選んでください。";
  $("remote").showModal();
}
$("open-remote").addEventListener("click", openRemote);

function spRun(input) {
  const r = runAction(ctx, "studio_pro", input);
  if (!r.ok) addMessage("tool err", r.message);
  $("remote-status").textContent = r.ok ? `${r.message}（バンク: トラック ${studio.bank * 8 + 1}〜${studio.bank * 8 + 8}）` : r.message;
}
for (const b of document.querySelectorAll("[data-sp]")) b.addEventListener("click", () => spRun({ command: b.dataset.sp }));
for (const b of document.querySelectorAll("[data-sp-track]")) b.addEventListener("click", () => spRun({ command: b.dataset.spTrack, track: Number($("sp-track").value) }));
$("sp-fader").addEventListener("input", (e) => ($("sp-db").textContent = e.target.value));
$("sp-fader").addEventListener("change", (e) => spRun({ command: "fader", track: Number($("sp-track").value), db: Number(e.target.value) }));
$("sp-bank-reset").addEventListener("click", () => spRun({ command: "bank_reset" }));

// ---------- キーボードショートカット ----------
document.addEventListener("keydown", (e) => {
  const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
  if (e.code === "Space" && !typing) {
    e.preventDefault();
    togglePlay();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
    e.preventDefault();
    report(runAction(ctx, e.shiftKey ? "redo" : "undo"), true);
  }
});

// ---------- 状態変化 → 再描画・自動保存 ----------
let saveTimer = null;
let ideasTimer = null;
store.subscribe(() => {
  renderHeader();
  renderTracks();
  renderRoll();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveJSON(PROJECT_KEY, store.project), 300);
  clearTimeout(ideasTimer);
  ideasTimer = setTimeout(renderIdeas, 200);
});

renderHeader();
renderTracks();
renderRoll(true);
renderIdeas();
renderModeBadge();
addMessage(
  "bot",
  `こんにちは。Daruma DAW のオペレーターです。\n「おまかせで切ない曲を8小節」「テンポ92」「コード Am F C G」「メロディ作って」のように話しかけてください。\n「ヘルプ」で一覧を表示します。`,
);
window.__daw = { store, engine, ctx, keyName };

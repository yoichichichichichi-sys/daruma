// Shared helpers: hex parsing/formatting, the traffic log and toast.

const logEl = document.getElementById("log");
const logPause = document.getElementById("log-pause");
const toastEl = document.getElementById("toast");
const MAX_LOG_LINES = 2000;
const logLines = [];

export function toHex(bytes) {
  const arr = bytes instanceof DataView
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

export function parseHex(text) {
  const clean = text.replace(/0x/gi, "").replace(/[^0-9a-f]/gi, "");
  if (clean.length === 0 || clean.length % 2 !== 0) {
    throw new Error(`16進数として解釈できません: "${text}"`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Expands a byte template such as "A0 03 {v}" or "01 {v16le}" with a value.
export function fillTemplate(template, value) {
  const v = Math.max(0, Math.round(value));
  const hex = template
    .replace(/\{v16le\}/g, `${byte(v & 0xff)} ${byte((v >> 8) & 0xff)}`)
    .replace(/\{v16be\}/g, `${byte((v >> 8) & 0xff)} ${byte(v & 0xff)}`)
    .replace(/\{v\}/g, byte(v & 0xff));
  return parseHex(hex);
}

function byte(n) {
  return n.toString(16).padStart(2, "0");
}

export function log(kind, source, message) {
  const time = new Date().toISOString().slice(11, 23);
  const line = `${time} ${kind.toUpperCase().padEnd(3)} [${source}] ${message}`;
  logLines.push(line);
  if (logLines.length > MAX_LOG_LINES) logLines.shift();
  if (logPause.checked) return;
  const li = document.createElement("li");
  li.className = kind;
  li.textContent = line;
  logEl.appendChild(li);
  while (logEl.childElementCount > MAX_LOG_LINES) logEl.firstElementChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}

export function clearLog() {
  logLines.length = 0;
  logEl.replaceChildren();
}

export function exportLog() {
  download(`uafx-log-${Date.now()}.txt`, logLines.join("\n"), "text/plain");
}

export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastTimer = null;
export function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2200);
}

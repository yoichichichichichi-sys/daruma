// WebUSB descriptor viewer and raw bulk/interrupt transfers on vendor-specific
// interfaces. Audio/MIDI/HID classes are blocked by the browser on purpose.
import { log, toHex } from "./util.js";

let device = null;
let claimed = null;

export const usb = {
  get supported() {
    return !!navigator.usb;
  },

  async pick() {
    device = await navigator.usb.requestDevice({ filters: [] });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    log("sys", "USB", `選択: ${device.productName ?? "?"} (${hex4(device.vendorId)}:${hex4(device.productId)})`);
    return describe(device);
  },

  async claim(iface) {
    if (!device) throw new Error("USB デバイスが選択されていません");
    await device.claimInterface(iface);
    claimed = iface;
    log("sys", "USB", `interface ${iface} を claim しました`);
  },

  async send(endpoint, bytes) {
    if (claimed === null) throw new Error("先に interface を claim してください");
    const res = await device.transferOut(endpoint, bytes);
    log("tx", "USB", `EP${endpoint} OUT ${toHex(bytes)} (${res.status})`);
  },

  async read(endpoint, length = 64) {
    if (claimed === null) throw new Error("先に interface を claim してください");
    const res = await device.transferIn(endpoint, length);
    log("rx", "USB", `EP${endpoint} IN ${res.data ? toHex(res.data) : "(no data)"} (${res.status})`);
  },
};

const CLASS_NAMES = {
  0x01: "Audio (MIDI含む・保護対象)",
  0x02: "CDC",
  0x03: "HID (保護対象)",
  0x08: "Mass Storage (保護対象)",
  0x0a: "CDC-Data",
  0xfe: "Application Specific (DFU 等)",
  0xff: "Vendor Specific",
};

function describe(d) {
  const lines = [
    `製品名      : ${d.productName ?? "-"}`,
    `メーカー    : ${d.manufacturerName ?? "-"}`,
    `シリアル    : ${d.serialNumber ?? "-"}`,
    `VID:PID     : ${hex4(d.vendorId)}:${hex4(d.productId)}`,
    `USB         : ${d.usbVersionMajor}.${d.usbVersionMinor}  デバイスクラス 0x${hex2(d.deviceClass)}`,
    `FW バージョン: ${d.deviceVersionMajor}.${d.deviceVersionMinor}.${d.deviceVersionSubminor}`,
  ];
  for (const cfg of d.configurations) {
    lines.push(`\nConfiguration ${cfg.configurationValue} ${cfg.configurationName ?? ""}`);
    for (const iface of cfg.interfaces) {
      for (const alt of iface.alternates) {
        const cls = CLASS_NAMES[alt.interfaceClass] ?? "";
        lines.push(`  Interface ${iface.interfaceNumber} alt${alt.alternateSetting}: class 0x${hex2(alt.interfaceClass)} sub 0x${hex2(alt.interfaceSubclass)} proto 0x${hex2(alt.interfaceProtocol)} ${cls} ${alt.interfaceName ?? ""}`);
        for (const ep of alt.endpoints) {
          lines.push(`    EP${ep.endpointNumber} ${ep.direction.toUpperCase()} ${ep.type} ${ep.packetSize}B`);
        }
      }
    }
  }
  return lines.join("\n");
}

function hex4(n) {
  return n.toString(16).padStart(4, "0");
}
function hex2(n) {
  return n.toString(16).padStart(2, "0");
}

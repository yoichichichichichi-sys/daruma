// Web Bluetooth GATT explorer + transport. The UAFX BLE protocol is
// undocumented, so this module only provides raw access: discover, read,
// write and subscribe. Mapping knobs to bytes is done in the profile.
import { log, toHex } from "./util.js";

let device = null;
let server = null;
const characteristics = new Map(); // uuid -> BluetoothRemoteGATTCharacteristic

export const ble = {
  get supported() {
    return !!navigator.bluetooth;
  },
  get connected() {
    return !!server?.connected;
  },

  async connect({ services, namePrefix }) {
    const options = namePrefix
      ? { filters: [{ namePrefix }], optionalServices: services }
      : { acceptAllDevices: true, optionalServices: services };
    device = await navigator.bluetooth.requestDevice(options);
    device.addEventListener("gattserverdisconnected", () => {
      log("sys", "BLE", `切断されました: ${device.name ?? device.id}`);
      characteristics.clear();
      this.onDisconnect?.();
    });
    log("sys", "BLE", `接続中: ${device.name ?? "(名前なし)"} id=${device.id}`);
    server = await device.gatt.connect();

    const tree = [];
    let primaries = [];
    try {
      primaries = await server.getPrimaryServices();
    } catch (err) {
      log("err", "BLE", `サービス取得失敗（UUID を申告していない可能性）: ${err.message}`);
    }
    for (const svc of primaries) {
      const entry = { uuid: svc.uuid, characteristics: [] };
      for (const chr of await svc.getCharacteristics().catch(() => [])) {
        characteristics.set(chr.uuid, chr);
        entry.characteristics.push({ uuid: chr.uuid, properties: propsOf(chr) });
      }
      tree.push(entry);
    }
    log("sys", "BLE", `サービス ${tree.length} 件を検出`);
    return { name: device.name, tree };
  },

  disconnect() {
    if (device?.gatt.connected) device.gatt.disconnect();
  },

  async read(uuid) {
    const value = await chr(uuid).readValue();
    log("rx", "BLE", `read ${short(uuid)}: ${toHex(value)}`);
    return value;
  },

  async write(uuid, bytes, withResponse = true) {
    const c = chr(uuid);
    if (withResponse && c.properties.write) await c.writeValueWithResponse(bytes);
    else await c.writeValueWithoutResponse(bytes);
    log("tx", "BLE", `write ${short(uuid)}: ${toHex(bytes)}`);
  },

  async subscribe(uuid) {
    const c = chr(uuid);
    c.addEventListener("characteristicvaluechanged", (e) => {
      log("rx", "BLE", `notify ${short(uuid)}: ${toHex(e.target.value)}`);
    });
    await c.startNotifications();
    log("sys", "BLE", `通知購読開始 ${short(uuid)}`);
  },

  onDisconnect: null,
};

function chr(uuid) {
  const c = characteristics.get(uuid);
  if (!c) throw new Error(`キャラクタリスティック ${uuid} が見つかりません（未接続か未検出）`);
  return c;
}

function propsOf(c) {
  return Object.entries({
    read: c.properties.read,
    write: c.properties.write,
    writeWithoutResponse: c.properties.writeWithoutResponse,
    notify: c.properties.notify,
    indicate: c.properties.indicate,
  }).filter(([, on]) => on).map(([name]) => name);
}

function short(uuid) {
  return uuid.startsWith("0000") && uuid.endsWith("-0000-1000-8000-00805f9b34fb")
    ? uuid.slice(4, 8)
    : uuid.slice(0, 8) + "…";
}

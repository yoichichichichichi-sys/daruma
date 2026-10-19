# UAFX Web Control（非公式）

Universal Audio UAFX シリーズのペダル（Dream '65 / Ruby '63 / Woodrow '55 / Lion '68 /
Golden Reverberator / Starlight Echo / Astra Modulation など）は、公式にはスマホの
**UAFX Control** アプリからしか細かく操作できません（デスクトップ版の UAFX Control
は提供終了し、PC の UA Connect はファームウェア更新と登録専用です）。

このツールは、PC のブラウザ（Chrome / Edge）からペダルを操作し、通信内容を解析するための
ビルド不要な静的 Web アプリです。Universal Audio とは無関係の非公式ツールです。

## 起動

Web MIDI / Web Bluetooth / WebUSB は secure context（https か localhost）でしか動かないので、
ローカルサーバーで配信してください。

```bash
cd uafx-web
python3 -m http.server 8000
# Chrome か Edge で http://localhost:8000 を開く
```

## 3 つの接続経路

| 経路 | 状態 | 用途 |
| --- | --- | --- |
| **MIDI（USB-C）** | UA が公式に対応している経路。そのまま使える | プリセット切替（Program Change）、ノブ操作（CC） |
| **Bluetooth LE** | プロトコル非公開。解析が必要 | アプリと同等の全パラメーター操作（解析できれば） |
| **USB（WebUSB）** | デスクリプタの確認用 | ペダルが PC から何として見えているかの確認 |

### 1. MIDI（まずはこれ）

1. ペダルの USB-C を PC に直結するか、USB ホスト対応の MIDI インターフェース経由で接続します
   （UA は USB ホスト対応の MIDI インターフェースを案内しています。PC がホストになって
   直接見えるかどうかはペダルとファームウェア次第なので、まず直結を試してください）。
2. 「MIDI」タブ → **MIDI を有効化**。出力/入力に UAFX が出てくれば成功です。
3. 「コントロール」タブでプリセットボタンを押すと Program Change が送られます。
4. ノブの CC 番号は**同梱プロファイルでは未割当**です（推測の番号を入れると誤動作するため）。
   次のどれかで割り当ててください。
   - お使いのペダルのマニュアルの MIDI 実装表を見て、各ノブ下の `CC#` 欄に入力する
   - **Learn** を押してからペダル本体のノブを回す（ペダルが CC を送信する場合のみ）
   - 「MIDI」タブの **CC スイープ**で 1 つずつ送って、どのパラメーターが動くか調べる

ノブはドラッグ（上下）・マウスホイール・矢印キー（Shift で 10 刻み）で操作し、ダブルクリックで
初期値に戻ります。

### 2. Bluetooth LE（プロトコル解析）

UAFX Control アプリとペダルの BLE 通信は非公開なので、自分のペダルで解析する前提の機能です。

1. **サービス UUID を調べる**: スマホの nRF Connect などでペダルをスキャンし、
   アドバタイズされているサービス UUID をメモします。Web Bluetooth は事前に申告した
   UUID のサービスにしかアクセスできないためです。
2. **アプリの通信をキャプチャする**: Android の開発者オプションで「Bluetooth HCI スヌープログ」を
   有効にし、UAFX Control でノブを 1 つずつ動かしてから bugreport でログを取り出して Wireshark で開きます。
   どのキャラクタリスティックに、どんなバイト列が書かれているかを特定します。
3. 「Bluetooth 解析」タブに UUID を入れて **スキャンして接続**（スマホのアプリは終了しておく）。
   Read / Subscribe / Write で挙動を確認し、書き込み先で **プロファイルに設定** を押します。
4. 「プロファイル」タブで「BLE 解析用テンプレート」を開き、各コントロールの `ble` に
   バイト列のテンプレートを書きます。

> ⚠️ 不明なバイト列を書き込むと設定が壊れたり予期しない動作をする可能性があります。
> 自己責任で、まず Read / Subscribe で観察するところから始めてください。

### 3. USB（WebUSB）

「USB 解析」タブで、USB-C 直結時の VID/PID とインターフェース構成を表示します。
Audio/MIDI/HID クラスはブラウザの保護対象なので WebUSB では開けません（MIDI クラスとして見えて
いれば「MIDI」タブで使えます）。ベンダー固有クラス（0xFF）のインターフェースがあれば、
claim して生データを送受信できます。

## プロファイル書式

```jsonc
{
  "id": "my-dream65",
  "name": "Dream '65（自分用）",
  "transport": "midi",            // "midi" | "ble"
  "note": "画面に表示されるメモ",
  "presets": { "type": "pc", "count": 3, "base": 0, "labels": ["A", "B", "C"] },
  "controls": [
    { "id": "gain", "label": "Gain", "type": "knob", "min": 0, "max": 127, "default": 64,
      "midi": { "cc": 13 } },       // ← 13 は例。実際の番号を入れる
    { "id": "bypass", "label": "Bypass", "type": "toggle", "on": 127, "off": 0, "default": 0,
      "midi": { "cc": null } }
  ]
}
```

BLE プロファイルの場合:

```jsonc
{
  "transport": "ble",
  "ble": { "characteristic": "<書き込み先の UUID>", "withResponse": true },
  "presets": { "type": "ble", "count": 3, "template": "<例: 02 {v}>" },
  "controls": [
    { "id": "gain", "label": "Gain", "type": "knob", "min": 0, "max": 127, "default": 64,
      "ble": "<例: 01 05 {v}>" }
  ]
}
```

テンプレート中の `{v}` は値 1 バイト、`{v16le}` / `{v16be}` は 2 バイト値
（リトルエンディアン / ビッグエンディアン）に置き換えられます。プロファイルは
`localStorage` に保存され、JSON でエクスポート/インポートできます。

## 構成

- `index.html` / `style.css` — UI
- `js/main.js` — 画面とプロファイルの結線
- `js/midi.js` — Web MIDI 送受信
- `js/ble.js` — Web Bluetooth GATT エクスプローラー
- `js/usb.js` — WebUSB デスクリプタ表示・生転送
- `js/profiles.js` — 同梱プロファイルと保存処理
- `js/util.js` — hex 変換・通信ログ

外部依存はありません。通信ログは「保存 (.txt)」で書き出せるので、解析結果の記録に使えます。

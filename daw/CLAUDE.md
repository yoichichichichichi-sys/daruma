# studio-pro-assistant

Fender Studio Pro（Windows）で曲を作るユーザーのための「オペレーター＆作曲アシスタント」。
ビルド不要のブラウザアプリ（静的 HTML/CSS/JS, ES Modules, 依存パッケージなし）。
経緯・決定事項・ユーザー環境の詳細は `docs/HANDOFF.md` を読むこと。

## コマンド

- テスト: `npm test`（= `node --test tests/*.test.mjs`、Node 18+）。変更したら必ず通す
- ローカル起動: Windows は `start.bat`（PowerShell の簡易サーバー、Python 不要）、それ以外は `python3 -m http.server 8000`
  - `file://` では ES Modules が読めないので必ずサーバー経由で開く
- 画面確認: Playwright + Chromium で `http://localhost:8000` を開いてスクリーンショット（デスクトップ 1400px とスマホ 390px、横スクロールが出ないこと）

## 構成

| ファイル | 役割 |
|---|---|
| `js/actions.js` | **すべての編集操作の入口**。日本語オペレーターと Claude のツールが共通で使う。新機能はまずここにアクションを足す |
| `js/operator.js` | ルールベースの日本語コマンド解析 → アクション |
| `js/claude.js` | Claude のツール呼び出しループ（アクションをツールとして渡す）、システムプロンプト |
| `js/library.js` | 参考曲ライブラリ: MIDI 解析（パート判定・キー/コード検出・型の抽出）、ステム別 MIDI のまとめとクリーンアップ、型からの生成 |
| `js/studiopro.js` | Studio Pro のリモート操作（Mackie Control プロトコル） |
| `js/midi.js` | SMF の読み書き |
| `js/engine.js` | Web Audio シンセ、先読みスケジューラ、Web MIDI 出力 |
| `js/theory.js` / `js/generate.js` / `js/assistant.js` | 音楽理論 / フレーズ生成 / 分析と提案 |
| `js/project.js` | 曲データモデルと Undo/Redo |
| `js/app.js` | 画面（ピアノロール、チャット、ライブラリ、リモート、設定） |

時間の単位は拍（4分音符 = 1、4/4 固定）。小節番号はアクションの入力では 1 始まり、内部データでは 0 始まり。

## 守ること

- UI の文言・コメント・README は日本語。周りのコードに合わせる
- 参考曲のメロディをそのまま書き出す機能は作らない（借りるのはリズム・輪郭・コード上の音程などの「型」まで）。
  YouTube などからの音源取り込みツールも作らない（ユーザーと合意済み。正規購入・CD・公式マルチトラックを使う方針）
- 精度を優先する（ユーザーの明確な要望）。手軽さのために精度を落とす機能は提案止まりにする
- Claude API: 既定モデルは `claude-opus-5-5`、`thinking: {type: "adaptive"}`、`output_config.effort`、Opus/Sonnet ではサーバー側 fallback（`server-side-fallback-2026-07-01` + `fallbacks: "default"`）。SDK は esm.sh から `@anthropic-ai/sdk@0.128.0` を読む。応答の content は thinking ブロックごと履歴に積む（append-only）
- Studio Pro の実機では Windows + loopMIDI で「再生・停止」と「MIDI 書き出し → ドラッグ取り込み」だけ確認済み。ほかの MCU ボタンは未確認なので、確認状況を README と `docs/HANDOFF.md` に正直に書く
- Studio Pro のメニュー名などバージョン依存の情報は断定しない

# 動画URL帳 (iOS)

`ios/`（コピペ帳）と同じ考え方の3ターゲット構成（本体アプリ + ウィジェット + 共有
エクステンション）ですが、URLの保存とサムネイル表示専用に作り直しています。

## できること

- **URLの自動キャプチャ**: アプリを開いた瞬間にクリップボードを確認し、URLで
  あれば自動で保存します（iOSは他アプリのクリップボードをバックグラウンドで
  読み取れないため。詳しくは `ios/README.md` の説明を参照）
- **共有エクステンションでワンタップ保存**: YouTubeアプリなどの共有シートに
  「動画URL帳に保存」が並びます。タップするだけで自動保存され、0.6秒ほどの
  確認表示のあと自動で閉じます。これが「YouTubeでボタンが現れて押せば自動
  記録」の実装にあたります（`VideoUrlNotebookShare/ShareViewController.swift`）
- **サムネイル付きグリッド表示（ランチャー風）**: YouTube/Vimeoは公式の
  サムネイルCDNから、それ以外のサイトはファビコンから自動生成します
- **ホーム画面ウィジェット**: 矢印ボタンで前後の保存URLを切り替え、
  「開く」ボタンでそのままSafari/該当アプリへ
- 検索、手動保存、削除（コンテキストメニュー）、URLコピー
- `UIPasteControl`（確認シートなしで貼り付けられるボタン）にも対応

## セットアップ

Mac + Xcodeが必要です。このセッションが動いているクラウドのLinux環境には
SwiftツールチェインもXcodeも無いため、**コンパイル・実機/シミュレータでの
動作確認はできていません**。括弧の対応とplist/entitlementsのXMLとしての
妥当性は機械的に確認済みですが、実際のビルドはお使いのMacで行ってください。
同梱の `web/` プロトタイプでURL解析・サムネイル解決のロジック自体は
ブラウザ上で動作確認済みです。

### XcodeGenを使う（おすすめ）

```
brew install xcodegen
cd video-url-saver/ios
xcodegen generate
open VideoUrlNotebook.xcodeproj
```

3つのターゲット（`VideoUrlNotebook` / `VideoUrlNotebookWidgetExtension` /
`VideoUrlNotebookShareExtension`）すべてでSigning & Capabilitiesを開き、
自分のApple ID / チームを設定してください。

### 必須の手動設定: App Group

`Shared/AppGroup.swift` の `group.com.videourlnotebook.shared` は、
**あなた自身のApple Developerアカウントの下で作る必要があります**。
本体アプリ・ウィジェット・共有エクステンションの **3つすべて** のターゲットで
Signing & Capabilities →「+ Capability」→「App Groups」を追加し、同じ
グループにチェックを入れてください（1つでも忘れるとデータが共有されません）。

### ホーム画面への追加

シミュレータ/実機にインストール後、ホーム画面を長押し →「＋」→
「動画URL帳」を探して追加してください。

## この場で特に確認できていない箇所

- `VideoUrlNotebookShare/ShareViewController.swift`: `NSExtensionActivationRule`
  の設定（YouTubeアプリの共有がURLとして来るかテキストとして来るかは、
  アプリのバージョンや状況によって変わるため、両方を受け付けるようにして
  います）と、`NSExtensionPrincipalClass` によるコード直起動（storyboard
  無し）の組み合わせ
- `VideoUrlNotebookWidget/WidgetThumbnailLoader.swift`: ウィジェットの
  タイムライン生成中に同期的にサムネイル画像をダウンロードする処理
  （Androidウィジェット版の同期Bitmap取得と同じ考え方です）
- `PasteControlView.swift`（`UIPasteControl`の使い方）

## 構成

```
video-url-saver/ios/
├── project.yml                                XcodeGenのプロジェクト定義
├── Shared/                                    3ターゲット共通コード
│   ├── AppGroup.swift
│   ├── UrlEntry.swift                         データモデル
│   ├── UrlMetadataResolver.swift              URL解析（YouTube/Vimeo/サイト判定）
│   └── UrlRepository.swift                    App Group内のJSONファイルへの読み書き
├── VideoUrlNotebook/                          アプリ本体（SwiftUI）
│   ├── VideoUrlNotebookApp.swift              起動時の自動取り込み
│   ├── UrlStore.swift                         画面用の状態管理
│   ├── ContentView.swift                      グリッド表示・検索・追加
│   ├── UrlCardView.swift                      サムネイルカード（タップで開く）
│   └── PasteControlView.swift
├── VideoUrlNotebookShare/                     共有エクステンション（YouTube等の共有シートに表示）
│   └── ShareViewController.swift
└── VideoUrlNotebookWidget/                    ウィジェット拡張
    ├── UrlWidget.swift
    ├── UrlWidgetIntents.swift
    └── WidgetThumbnailLoader.swift
```

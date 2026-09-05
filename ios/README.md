# コピペ帳 (iOS)

Android版と同じ考え方の履歴ツールですが、iOSの制約に合わせて挙動を変えています。

## Androidとの違い（重要）

- **自動キャプチャは「アプリを開いた瞬間」だけ**: Appleは他アプリのクリップボード
  内容をバックグラウンドで勝手に読み取ることを禁止しています。このアプリを開く
  （フォアグラウンドに来る）たびにクリップボードを確認して保存しますが、他の
  アプリがコピーした内容を初めて読むときはiOS自体が「"コピペ帳"にペーストを許可
  しますか？」という確認シートを出すことがあります。これはOSの仕様であり、
  アプリ側で消すことはできません
- そのため、確認なしで即座に取り込みたい場合は **「クリップボードから読み込む」
  のペーストボタン**（`UIPasteControl`という、Appleが用意したボタン部品）を使って
  ください。ボタンをタップすること自体が同意とみなされるため、確認シートが
  出ません
- **ホーム画面ウィジェットは「上下スワイプ」ではなく「矢印ボタンで送る」形**:
  WidgetKit（iOSのウィジェットの仕組み）には、Androidの`StackView`のような
  スワイプでカードをめくる機能が存在しません。代わりに、ウィジェット内の
  ▲/▼ボタンをタップして1件ずつ履歴を送り、「コピー」ボタンでその内容を即座に
  クリップボードへコピーする形にしています（コピーへの書き込みには確認は
  出ません。読み取りだけが制限されています）
  - この「ボタンで送れるウィジェット」機能自体が **iOS 17以降** の機能のため、
    このアプリの対応OSはiOS 17以降としています

## できること

- 日付別の履歴（今日／昨日／9月3日(木)のようなセクション）とピン留めセクション
- 検索、削除（スワイプ）、ピン留め（スワイプ）
- テキストを直接貼り付けて保存
- ホーム画面ウィジェット（矢印ボタンで前後の履歴に切り替え、コピーボタンで即コピー）

## セットアップ

このプロジェクトはMac + Xcodeが必要です。このセッションが動いているクラウドの
Linux環境にはSwiftツールチェインもXcodeも無いため、**コンパイル・実機/シミュレータ
での動作確認はできていません**。括弧の対応と、plist/entitlementsのXMLとしての
妥当性は機械的に確認済みですが、実際のビルドはお使いのMacで行ってください。

### 方法A: XcodeGenを使う（おすすめ）

1. Mac に [XcodeGen](https://github.com/yonaskolb/XcodeGen) を入れる
   ```
   brew install xcodegen
   ```
2. この `ios/` フォルダで実行
   ```
   cd ios
   xcodegen generate
   open CopyNotebook.xcodeproj
   ```
3. Xcodeで両方のターゲット（`CopyNotebook` と `CopyNotebookWidgetExtension`）の
   Signing & Capabilities を開き、自分のApple ID / チームを設定する

### 方法B: 手動でXcodeプロジェクトを作る

XcodeGenを使わない場合は、Xcodeで以下を作成し、このフォルダのファイルを
ドラッグ&ドロップで追加してください。

1. 新規プロジェクト → **App**（SwiftUI, iOS, 名前は自由）
2. `Shared/` と `CopyNotebook/` の中身をアプリ本体のターゲットに追加
   （`Info.plist` は生成されたものと置き換え、`CopyNotebook.entitlements` を
   Signing & Capabilities の Entitlements File に指定）
3. File → New → Target → **Widget Extension** を追加（"Include Configuration
   Intent" のチェックは外す）
4. `Shared/` と `CopyNotebookWidget/` の中身をウィジェットのターゲットに追加
   （生成されたテンプレートのSwiftファイルは削除して、こちらに差し替え）

### 必須の手動設定: App Group

`Shared/AppGroup.swift` の `group.com.copynotebook.shared` という文字列は、
**あなた自身のApple Developerアカウントの下で作る必要があります**（ソース
コードだけでは作成できません）。

1. アプリ本体のターゲット → Signing & Capabilities → 「+ Capability」→
   「App Groups」を追加
2. 「+」で新しいグループを作成（例: `group.com.copynotebook.shared`。任意の
   識別子でも構いませんが、その場合は `Shared/AppGroup.swift` の
   `identifier` もその文字列に書き換えてください）
3. ウィジェットのターゲットでも同じ手順を繰り返し、**同じグループ**にチェックを
   入れる（これを忘れるとアプリとウィジェットでデータが共有されません）

### ホーム画面への追加

シミュレータ/実機にインストール後、ホーム画面を長押し →「＋」→「コピペ帳」を
探して追加してください。

## 構成

```
ios/
├── project.yml                          XcodeGenのプロジェクト定義
├── Shared/                              アプリとウィジェットの両方が使う共有コード
│   ├── AppGroup.swift                   App Groupの識別子・共有コンテナ
│   ├── ClipEntry.swift                  データモデル
│   └── ClipRepository.swift             App Group内のJSONファイルへの読み書き
├── CopyNotebook/                        アプリ本体（SwiftUI）
│   ├── CopyNotebookApp.swift            起動時の自動取り込み
│   ├── ClipStore.swift                  画面用の状態管理（検索・日付グループ化など）
│   ├── ContentView.swift                日付別の履歴一覧画面
│   ├── ClipRowView.swift                履歴の1行（タップでコピー、スワイプで削除/ピン）
│   ├── PasteControlView.swift           確認シートなしで貼り付けられるボタン
│   ├── Info.plist
│   └── CopyNotebook.entitlements
└── CopyNotebookWidget/                  ウィジェット拡張
    ├── CopyNotebookWidgetBundle.swift
    ├── ClipWidget.swift                 ウィジェットの見た目とタイムライン
    ├── ClipWidgetIntents.swift          ▲▼ボタンとコピーボタンの処理（App Intents）
    ├── Info.plist
    └── CopyNotebookWidget.entitlements
```

## この場で特に確認できていない箇所

- `PasteControlView.swift`（`UIPasteControl` の使い方）: UIKit相互運用の中で
  一番間違えやすい部分です。もし動かない場合でも、通常のテキスト貼り付け保存
  と、アプリを開いた時の自動取り込みは独立して動くはずです
- ウィジェットの `Button(intent:)`（iOS 17のインタラクティブウィジェットAPI）

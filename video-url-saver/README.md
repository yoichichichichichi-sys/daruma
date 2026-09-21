# 動画URL帳

動画やサイトのURLをコピー/共有するだけで記憶させ、サムネイル付きの
グリッド（ランチャー風の一覧）でサッと見返せるアプリです。コピペ帳
（`../android`, `../ios`, `../web`）と同じ自動キャプチャの仕組みを土台に、
URL・サムネイル専用に作り直しています。

## 主な機能

- **URLの自動記憶**: 他のアプリでURLをコピーした瞬間に自動で保存
  （Android: アクセシビリティサービス／iOS: アプリを開いた瞬間）
- **YouTubeの「共有」から即保存**: YouTubeアプリなどの共有シートに
  このアプリがボタンとして並びます。タップするだけで、画面を開かずに
  自動でURLが記録されます
  - Android: `ShareReceiverActivity`（ACTION_SEND を受け取る透明な画面）
  - iOS: 共有エクステンション（`VideoUrlNotebookShare`）
  - Web(PWA): Web Share Target（`share-target.html`）— Android版Chrome等で
    ホーム画面に追加したPWAが共有先の候補に出てきます。iOS Safariは
    Web Share Targetに対応していないため、iOSではネイティブアプリの共有
    エクステンションを使ってください
- **サムネイルの自動生成**: YouTube/Vimeoは公式サムネイル、その他のサイトは
  ファビコンを表示。すべてURLから機械的に導出しているので追加の設定は不要です
- **ランチャー的な一目でわかる閲覧**: グリッド表示（Web/iOS）とホーム画面
  ウィジェット（Android/iOS）の両方で、サムネイルを並べてサッと探せます

## このリポジトリの構成

- **`web/`** — ブラウザだけで動く、インストール可能なPWA（ビルド不要の
  HTML/CSS/JS）。**この場でPlaywright（ヘッドレスChromium）を使い、URL解析・
  重複排除・検索・グリッド/リスト切替・共有ターゲット経由の保存・永続化を
  実際に動かして確認済みです。** 詳細は [`web/README.md`](web/README.md)。
- **`android/`** — ネイティブアプリ（Kotlin）。詳細は
  [`android/README.md`](android/README.md)。
- **`ios/`** — iOS版（Swift/SwiftUI + WidgetKit + Share Extension）。詳細は
  [`ios/README.md`](ios/README.md)。

`android/` と `ios/` はこのセッションの実行環境（Android SDK / Xcode に
ネットワーク・OS制約でアクセスできないクラウドLinuxコンテナ）では
コンパイル・実機確認ができていません。Android Studio / Xcodeで開いて
ビルド・実行して確認してください。

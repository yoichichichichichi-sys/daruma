# コピペ帳 (Android)

コピーした内容を自動で履歴に残し、ホーム画面のウィジェットで上下にフリックして
呼び出せるクリップボード履歴アプリです。

## できること

- **自動キャプチャ**: 他のアプリでテキストをコピーした瞬間に、アクセシビリティ
  機能を使って自動で履歴に保存します（バックグラウンドで動作）
- **日付別の履歴画面**: 「今日」「昨日」「9月3日(木)」のように日付ごとにまとまった
  一覧で確認できます。ピン留めした項目は一番上の専用セクションに表示されます
- **ホーム画面ウィジェット**: `StackView`（Android標準のスタック型ウィジェット）を
  使っているため、追加の実装なしに指で上下にフリックして履歴のカードをめくれます。
  カードをタップするとその内容が再度クリップボードにコピーされます
- 検索、ピン留め、削除、手動保存（アプリ内に直接貼り付け）

## セットアップ（Android Studio が必要です）

1. Android Studio で `android/` フォルダを開く（Gradle sync が自動で走ります）
2. 実機またはエミュレータで実行
3. アプリを開くと「自動保存をオンにする」バナーが出るので、そこから
   設定 > ユーザー補助（アクセシビリティ）を開き、「コピペ帳」を有効にする
   - これは Android の仕様上、ユーザー自身が手動でオンにする必要があり、
     アプリ側から自動で有効化することはできません
4. ホーム画面を長押し → ウィジェット → 「コピペ帳」を追加すると、
   スタック型のウィジェットが置けます

## なぜアクセシビリティ機能を使うのか

Android 10 以降、フォアグラウンドにないアプリ（＝入力中のアプリでも既定の
キーボードでもないアプリ）は `ClipboardManager.getPrimaryClip()` で
クリップボードの中身を読み取れないよう制限されています。プライバシー保護の
ための仕様です。

アクセシビリティサービスはこの制限の対象外になるため、多くの市販の
クリップボード管理アプリと同様、ここでも「常駐する何もしないアクセシビリティ
サービス」を使ってクリップボードの変化を監視しています
（`ClipCaptureAccessibilityService`）。画面の内容そのものを読み取ることは
していません。

## この場でビルド・実機確認はできていません

このプロジェクトはクラウドの Linux 環境で書かれており、Android SDK / Google の
Maven リポジトリへのネットワークアクセスが許可されていないため、この場では
コンパイルや実機・エミュレータでの動作確認ができていません。コードは
Android の標準的な作法（Room, AccessibilityService, AppWidget + StackView,
ViewBinding）に沿って書いていますが、Android Studio で開いて実際にビルド・
実行して確認してください。

Gradle Wrapper（`gradlew` / `gradle/wrapper/*`）はこのセッションのローカル
Gradle を使って生成済みです。初回ビルド時にお使いの環境から
`gradle-8.9-bin.zip`（services.gradle.org）が自動ダウンロードされます。

## 構成

```
android/
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/copynotebook/clip/
│       │   ├── data/        Room データベース（ClipEntry, ClipDao, AppDatabase, ClipRepository）
│       │   ├── service/     ClipCaptureAccessibilityService（自動キャプチャ）
│       │   ├── ui/          MainActivity, HistoryViewModel, HistoryAdapter（日付別履歴）
│       │   └── widget/      ClipStackWidgetProvider ほか（ホーム画面ウィジェット）
│       └── res/             レイアウト・文字列・アイコンなど
├── build.gradle.kts
└── settings.gradle.kts
```

## 既知の制約

- OEM（メーカー独自カスタマイズ）によってはバックグラウンドのアクセシビリティ
  サービスがバッテリー最適化で止められることがあります。その場合は
  端末の設定でバッテリー最適化の対象からこのアプリを除外してください
- ウィジェットは `notifyAppWidgetViewDataChanged` を使って手動で更新しています。
  ランチャー（ホームアプリ）によって反映の速さに差が出ることがあります

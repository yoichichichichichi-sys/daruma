# 動画URL帳 (Android)

動画やサイトのURLをサムネイル付きで保存し、グリッド表示でサッと見返せるアプリです。
`android/`（コピペ帳）と同じ土台（Room, AccessibilityService, AppWidget +
StackView, ViewBinding）を使い、URL専用に作り直しています。

## できること

- **URLの自動キャプチャ**: 他のアプリでURLをコピーした瞬間に、アクセシビリティ
  機能を使って自動で保存します（URLでないコピーは無視します）
- **共有シートからワンタップ保存**: YouTubeアプリなどで「共有」をタップすると
  出てくる一覧に「動画URL帳」が並びます。それを選ぶだけで、画面を開かずに
  自動保存されます（`ShareReceiverActivity`）。これが「YouTubeでボタンが
  現れて押せば自動記録」の実装にあたります
- **サムネイル付きグリッド表示（ランチャー風）**: YouTube/Vimeoは公式の
  サムネイルCDNから、それ以外のサイトはファビコンから自動生成します
- **ホーム画面ウィジェット**: `StackView`でサムネイルを上下にフリックして
  見返せます。タップでそのままリンクを開けます
- 検索、手動保存、削除、URLコピー

## セットアップ（Android Studio が必要です）

1. Android Studio で `video-url-saver/android/` フォルダを開く
2. 実機またはエミュレータで実行
3. 自動保存をオンにするには、バナーから設定 > ユーザー補助を開き
   「動画URL帳」を有効にする（Androidの仕様上、手動操作が必要です）
4. ホーム画面を長押し → ウィジェット → 「動画URL帳」を追加

## サムネイルの仕組み

- YouTube: URLから動画IDを取り出し `i.ytimg.com/vi/{id}/hqdefault.jpg` を利用
- Vimeo: 同様に `vumbnail.com/{id}.jpg` を利用
- それ以外のサイト: Googleのファビコンサービスを利用（サムネイル画像そのものを
  取得するにはページのOGPタグを解析するサーバー/APIが必要になるため、この
  スキャフォールドでは軽量なファビコン表示にとどめています。将来
  `LinkPresentation`相当の仕組みを足すならここが拡張ポイントです）

## この場でビルド・実機確認はできていません

このプロジェクトはクラウドのLinux環境で書かれており、Android SDK / Google の
Maven リポジトリへのネットワークアクセスが許可されていないため、この場では
コンパイル・実機確認ができていません。同梱の `web/` プロトタイプ
（ビルド不要のHTML/CSS/JS）でロジック自体はブラウザ上で動作確認済みです。
Android Studio で開いて実際にビルド・実行して確認してください。

Gradle Wrapper は `android/`（コピペ帳）と同じものを流用しています。

## 構成

```
video-url-saver/android/
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/videourlnotebook/
│       │   ├── data/     Room データベース + URL解析（UrlMetadataResolver）
│       │   ├── service/  UrlCaptureAccessibilityService（自動キャプチャ）
│       │   ├── share/    ShareReceiverActivity（共有シートからの保存）
│       │   ├── ui/       MainActivity, UrlGridViewModel, UrlGridAdapter
│       │   └── widget/   UrlStackWidgetProvider ほか（ホーム画面ウィジェット）
│       └── res/
├── build.gradle.kts
└── settings.gradle.kts
```

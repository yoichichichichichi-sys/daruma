import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: UrlStore
    @State private var newURLText: String = ""
    @State private var showClearAllConfirm = false

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        TextField("https://... のURLを貼り付け", text: $newURLText)
                            .textFieldStyle(.roundedBorder)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)

                        PasteControlView { text in
                            _ = store.capture(text)
                        }
                    }

                    Button("保存") {
                        if store.capture(newURLText) {
                            newURLText = ""
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(newURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Text("YouTubeアプリ等の共有シートから「動画URL帳」を選ぶと、ボタン一つで自動保存できます。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal)
                .padding(.top, 8)

                if store.filtered.isEmpty {
                    ContentUnavailableView(
                        "まだ保存したURLがありません",
                        systemImage: "link",
                        description: Text("動画やサイトのリンクを貼り付けてみましょう")
                    )
                    .padding(.top, 40)
                } else {
                    LazyVGrid(columns: columns, spacing: 16) {
                        ForEach(store.filtered) { entry in
                            UrlCardView(entry: entry)
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("動画URL帳")
            .searchable(text: $store.searchQuery, prompt: "タイトル・サイト名・URLで検索")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("すべて削除", role: .destructive) {
                        showClearAllConfirm = true
                    }
                    .disabled(store.entries.isEmpty)
                }
            }
            .confirmationDialog(
                "保存したURLをすべて削除しますか？",
                isPresented: $showClearAllConfirm,
                titleVisibility: .visible
            ) {
                Button("すべて削除", role: .destructive) { store.clearAll() }
                Button("キャンセル", role: .cancel) {}
            }
        }
    }
}

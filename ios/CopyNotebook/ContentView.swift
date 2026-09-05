import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: ClipStore
    @State private var newEntryText: String = ""
    @State private var showClearAllConfirm = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        TextEditor(text: $newEntryText)
                            .frame(minHeight: 70)
                            .overlay(alignment: .topLeading) {
                                if newEntryText.isEmpty {
                                    Text("コピーしたい文章をここに貼り付けてください")
                                        .foregroundStyle(.secondary)
                                        .padding(.top, 8)
                                        .padding(.leading, 5)
                                        .allowsHitTesting(false)
                                }
                            }

                        HStack {
                            Button("この内容を保存") {
                                store.capture(newEntryText)
                                newEntryText = ""
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(newEntryText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                            PasteControlView { text in
                                store.capture(text)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }

                if !store.pinnedEntries.isEmpty {
                    Section("📌 ピン留め") {
                        ForEach(store.pinnedEntries) { entry in
                            ClipRowView(entry: entry)
                        }
                    }
                }

                ForEach(store.dateSections, id: \.label) { section in
                    Section(section.label) {
                        ForEach(section.entries) { entry in
                            ClipRowView(entry: entry)
                        }
                        .onDelete { offsets in
                            store.delete(at: offsets, in: section.entries)
                        }
                    }
                }

                if store.entries.isEmpty {
                    ContentUnavailableView(
                        "まだ何も保存されていません",
                        systemImage: "doc.on.clipboard"
                    )
                }
            }
            .navigationTitle("コピペ帳")
            .searchable(text: $store.searchQuery, prompt: "保存した内容を検索")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("すべて削除", role: .destructive) {
                        showClearAllConfirm = true
                    }
                    .disabled(store.entries.isEmpty)
                }
            }
            .confirmationDialog(
                "すべての履歴を削除しますか？（ピン留めも含みます）",
                isPresented: $showClearAllConfirm,
                titleVisibility: .visible
            ) {
                Button("すべて削除", role: .destructive) { store.clearAll() }
                Button("キャンセル", role: .cancel) {}
            }
        }
    }
}

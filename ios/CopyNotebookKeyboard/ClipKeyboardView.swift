import SwiftUI

struct ClipKeyboardView: View {
    @ObservedObject var model: KeyboardModel

    var body: some View {
        VStack(spacing: 6) {
            if model.hasFullAccess {
                categoryTabs
                clipList
            } else {
                fullAccessNotice
            }
            bottomRow
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemGroupedBackground))
    }

    private var categoryTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                tab(title: "すべて", category: nil)
                ForEach(ClipCategory.allCases) { category in
                    tab(title: "\(category.emoji) \(category.label)", category: category)
                }
            }
            .padding(.horizontal, 8)
        }
    }

    private func tab(title: String, category: ClipCategory?) -> some View {
        let selected = model.selectedCategory == category
        return Button(title) { model.selectedCategory = category }
            .font(.footnote)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .foregroundStyle(selected ? Color.white : Color.secondary)
            .background(selected ? Color.accentColor : Color(uiColor: .secondarySystemGroupedBackground),
                        in: Capsule())
    }

    private var clipList: some View {
        ScrollView {
            LazyVStack(spacing: 6) {
                ForEach(model.visibleEntries) { entry in
                    Button {
                        model.insert(entry.text)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.text)
                                .lineLimit(2)
                                .foregroundStyle(.primary)
                                .multilineTextAlignment(.leading)
                            Text("\(entry.pinned ? "📌 " : "")\(entry.category.emoji) \(entry.createdAt.formatted(date: .omitted, time: .shortened))")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color(uiColor: .secondarySystemGroupedBackground),
                                    in: RoundedRectangle(cornerRadius: 8))
                    }
                }
                if model.visibleEntries.isEmpty {
                    Text("このカテゴリにはまだ何もありません")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 40)
                }
            }
            .padding(.horizontal, 8)
        }
    }

    private var fullAccessNotice: some View {
        VStack(spacing: 8) {
            Text("保存した一覧を表示するには「フルアクセスを許可」が必要です")
                .font(.footnote.bold())
            Text("設定 → 一般 → キーボード → キーボード → コピペ帳 → フルアクセスを許可")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .multilineTextAlignment(.center)
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var bottomRow: some View {
        HStack(spacing: 6) {
            key("globe", width: 50) { model.nextKeyboard() }
            if model.hasFullAccess {
                key("doc.on.clipboard", width: 50) { model.saveCurrentClipboard() }
            }
            Button { model.insert(" ") } label: {
                Text("空白").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .keyStyle()
            key("delete.left", width: 50) { model.deleteBackward() }
            key("return", width: 60) { model.insert("\n") }
        }
        .frame(height: 42)
        .padding(.horizontal, 8)
    }

    private func key(_ systemImage: String, width: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage).frame(width: width).frame(maxHeight: .infinity)
        }
        .keyStyle()
    }
}

private extension View {
    func keyStyle() -> some View {
        self
            .foregroundStyle(.primary)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 6))
    }
}

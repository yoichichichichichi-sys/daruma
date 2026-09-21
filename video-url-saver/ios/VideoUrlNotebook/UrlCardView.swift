import SwiftUI
import UIKit

struct UrlCardView: View {
    @EnvironmentObject private var store: UrlStore
    @Environment(\.openURL) private var openURL
    let entry: UrlEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .bottomLeading) {
                AsyncImage(url: entry.thumbnailURL) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().aspectRatio(16 / 9, contentMode: .fill)
                    default:
                        Rectangle().fill(Color(uiColor: .secondarySystemBackground))
                    }
                }
                .frame(height: 100)
                .clipped()
                .cornerRadius(10)

                Text(kindLabel)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.black.opacity(0.65))
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
                    .padding(6)
            }

            Text(entry.title)
                .font(.caption)
                .fontWeight(.semibold)
                .lineLimit(2)

            Text(entry.siteName)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if let url = entry.url { openURL(url) }
        }
        .contextMenu {
            Button {
                UIPasteboard.general.string = entry.urlString
            } label: {
                Label("URLをコピー", systemImage: "doc.on.doc")
            }
            Button(role: .destructive) {
                store.delete(entry)
            } label: {
                Label("削除", systemImage: "trash")
            }
        }
    }

    private var kindLabel: String {
        switch entry.kind {
        case .youtube: return "▶ YouTube"
        case .vimeo: return "▶ Vimeo"
        case .site: return "🔗 サイト"
        }
    }
}

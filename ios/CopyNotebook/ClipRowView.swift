import SwiftUI
import UIKit

struct ClipRowView: View {
    @EnvironmentObject private var store: ClipStore
    let entry: ClipEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(entry.text)
                .lineLimit(3)
                .font(.body)

            Text(entry.createdAt, style: .time)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            UIPasteboard.general.string = entry.text
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                store.delete(entry)
            } label: {
                Label("削除", systemImage: "trash")
            }
        }
        .swipeActions(edge: .leading) {
            Button {
                store.togglePin(entry)
            } label: {
                Label(entry.pinned ? "ピン解除" : "ピン留め", systemImage: entry.pinned ? "pin.slash" : "pin")
            }
            .tint(.orange)
        }
    }
}

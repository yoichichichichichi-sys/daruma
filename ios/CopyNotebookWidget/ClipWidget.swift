import WidgetKit
import SwiftUI

struct ClipWidgetTimelineEntry: TimelineEntry {
    let date: Date
    let current: ClipEntry?
    let total: Int
    let position: Int
}

struct ClipWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> ClipWidgetTimelineEntry {
        ClipWidgetTimelineEntry(
            date: Date(),
            current: ClipEntry(text: "コピーした内容がここに表示されます", pinned: false),
            total: 1,
            position: 0
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (ClipWidgetTimelineEntry) -> Void) {
        completion(makeEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ClipWidgetTimelineEntry>) -> Void) {
        // No time-based refresh: the widget only changes when the app
        // captures a new clip (WidgetCenter.reloadAllTimelines) or the
        // prev/next buttons run ShiftClipIntent (reloadTimelines(ofKind:)).
        completion(Timeline(entries: [makeEntry()], policy: .never))
    }

    private func makeEntry() -> ClipWidgetTimelineEntry {
        let all = ClipRepository.ordered()
        guard !all.isEmpty else {
            return ClipWidgetTimelineEntry(date: Date(), current: nil, total: 0, position: 0)
        }
        var index = ClipRepository.widgetIndex
        if index < 0 || index >= all.count { index = 0 }
        return ClipWidgetTimelineEntry(date: Date(), current: all[index], total: all.count, position: index)
    }
}

struct ClipWidgetView: View {
    var entry: ClipWidgetTimelineEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let clip = entry.current {
                Text(clip.text)
                    .font(.system(size: 14))
                    .lineLimit(4)
                    .multilineTextAlignment(.leading)

                Spacer(minLength: 0)

                HStack {
                    Text(clip.pinned ? "📌 " + timeLabel(clip.createdAt) : timeLabel(clip.createdAt))
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    Spacer()

                    if entry.total > 1 {
                        Text("\(entry.position + 1) / \(entry.total)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                HStack(spacing: 12) {
                    Button(intent: ShiftClipIntent(direction: -1)) {
                        Image(systemName: "chevron.up")
                    }
                    .disabled(entry.total <= 1)

                    Button(intent: CopyCurrentClipIntent(clipID: clip.id.uuidString)) {
                        Label("コピー", systemImage: "doc.on.doc")
                            .font(.caption)
                    }
                    .frame(maxWidth: .infinity)

                    Button(intent: ShiftClipIntent(direction: 1)) {
                        Image(systemName: "chevron.down")
                    }
                    .disabled(entry.total <= 1)
                }
                .buttonStyle(.bordered)
            } else {
                Text("コピーした内容がここに表示されます")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .containerBackground(for: .widget) {
            Color(uiColor: .secondarySystemBackground)
        }
    }

    private func timeLabel(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "M/d H:mm"
        return formatter.string(from: date)
    }
}

struct ClipWidget: Widget {
    let kind: String = "ClipWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ClipWidgetProvider()) { entry in
            ClipWidgetView(entry: entry)
        }
        .configurationDisplayName("コピペ帳")
        .description("上下のボタンで履歴を送り、コピーボタンでその内容をすぐ使えます。")
        .supportedFamilies([.systemMedium])
    }
}

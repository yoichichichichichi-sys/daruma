import WidgetKit
import SwiftUI

struct UrlWidgetTimelineEntry: TimelineEntry {
    let date: Date
    let current: UrlEntry?
    let thumbnail: UIImage?
    let total: Int
    let position: Int
}

struct UrlWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> UrlWidgetTimelineEntry {
        UrlWidgetTimelineEntry(date: Date(), current: nil, thumbnail: nil, total: 0, position: 0)
    }

    func getSnapshot(in context: Context, completion: @escaping (UrlWidgetTimelineEntry) -> Void) {
        completion(makeEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UrlWidgetTimelineEntry>) -> Void) {
        // No time-based refresh: the widget only changes when the app or
        // share extension saves a new URL (WidgetCenter.reloadAllTimelines)
        // or the prev/next buttons run ShiftUrlIntent.
        completion(Timeline(entries: [makeEntry()], policy: .never))
    }

    private func makeEntry() -> UrlWidgetTimelineEntry {
        let all = UrlRepository.ordered()
        guard !all.isEmpty else {
            return UrlWidgetTimelineEntry(date: Date(), current: nil, thumbnail: nil, total: 0, position: 0)
        }
        var index = UrlRepository.widgetIndex
        if index < 0 || index >= all.count { index = 0 }
        let entry = all[index]
        let thumbnail = WidgetThumbnailLoader.fetch(entry.thumbnailURLString)
        return UrlWidgetTimelineEntry(date: Date(), current: entry, thumbnail: thumbnail, total: all.count, position: index)
    }
}

struct UrlWidgetView: View {
    var entry: UrlWidgetTimelineEntry

    var body: some View {
        if let item = entry.current {
            VStack(alignment: .leading, spacing: 6) {
                Group {
                    if let thumbnail = entry.thumbnail {
                        Image(uiImage: thumbnail).resizable().aspectRatio(16 / 9, contentMode: .fill)
                    } else {
                        Rectangle().fill(Color(uiColor: .tertiarySystemBackground))
                    }
                }
                .frame(height: 70)
                .clipped()
                .cornerRadius(8)

                Text(item.title)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .lineLimit(1)

                HStack {
                    Text(item.siteName)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Spacer()
                    if entry.total > 1 {
                        Text("\(entry.position + 1) / \(entry.total)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                HStack(spacing: 10) {
                    Button(intent: ShiftUrlIntent(direction: -1)) {
                        Image(systemName: "chevron.up")
                    }
                    .disabled(entry.total <= 1)

                    if let url = item.url {
                        Link(destination: url) {
                            Label("開く", systemImage: "arrow.up.right.square")
                                .font(.caption)
                        }
                        .frame(maxWidth: .infinity)
                    }

                    Button(intent: ShiftUrlIntent(direction: 1)) {
                        Image(systemName: "chevron.down")
                    }
                    .disabled(entry.total <= 1)
                }
                .buttonStyle(.bordered)
            }
            .padding(10)
            .containerBackground(for: .widget) {
                Color(uiColor: .secondarySystemBackground)
            }
        } else {
            VStack {
                Text("保存したURLがここに表示されます")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(12)
            .containerBackground(for: .widget) {
                Color(uiColor: .secondarySystemBackground)
            }
        }
    }
}

struct UrlWidget: Widget {
    let kind: String = "UrlWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UrlWidgetProvider()) { entry in
            UrlWidgetView(entry: entry)
        }
        .configurationDisplayName("動画URL帳")
        .description("上下のボタンで履歴を送り、「開く」でそのままリンクを開けます。")
        .supportedFamilies([.systemMedium])
    }
}

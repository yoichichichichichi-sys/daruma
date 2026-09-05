import Foundation
import Combine
import WidgetKit

/// The app-side view model. Wraps ClipRepository with the reactive state
/// SwiftUI needs, and tells the widget to refresh after every change.
@MainActor
final class ClipStore: ObservableObject {
    @Published private(set) var entries: [ClipEntry] = []
    @Published var searchQuery: String = ""

    init() {
        entries = ClipRepository.ordered()
    }

    func refresh() {
        entries = ClipRepository.ordered()
    }

    private func persist() {
        entries.sort { lhs, rhs in
            if lhs.pinned != rhs.pinned { return lhs.pinned && !rhs.pinned }
            return lhs.createdAt > rhs.createdAt
        }
        ClipRepository.saveAll(entries)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Saves `text`, moving an existing identical entry back to the top
    /// (keeping its pinned state) instead of duplicating it - same
    /// de-dupe behaviour as the Android and web versions.
    func capture(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        if let index = entries.firstIndex(where: { $0.text == trimmed }) {
            var existing = entries.remove(at: index)
            existing.createdAt = Date()
            entries.insert(existing, at: 0)
        } else {
            entries.insert(ClipEntry(text: trimmed), at: 0)
        }
        persist()
    }

    func togglePin(_ entry: ClipEntry) {
        guard let index = entries.firstIndex(where: { $0.id == entry.id }) else { return }
        entries[index].pinned.toggle()
        persist()
    }

    func delete(_ entry: ClipEntry) {
        entries.removeAll { $0.id == entry.id }
        persist()
    }

    func delete(at offsets: IndexSet, in section: [ClipEntry]) {
        let ids = offsets.map { section[$0].id }
        entries.removeAll { ids.contains($0.id) }
        persist()
    }

    func clearAll() {
        entries.removeAll()
        persist()
    }

    var filtered: [ClipEntry] {
        guard !searchQuery.isEmpty else { return entries }
        return entries.filter { $0.text.localizedCaseInsensitiveContains(searchQuery) }
    }

    var pinnedEntries: [ClipEntry] {
        filtered.filter { $0.pinned }
    }

    /// Unpinned entries grouped into ("今日" / "昨日" / "9月3日(木)", [ClipEntry])
    /// sections, most recent day first - mirrors the Android app's date grouping.
    var dateSections: [(label: String, entries: [ClipEntry])] {
        let unpinned = filtered.filter { !$0.pinned }
        var order: [Date] = []
        var buckets: [Date: [ClipEntry]] = [:]

        let calendar = Calendar.current
        for entry in unpinned {
            let day = calendar.startOfDay(for: entry.createdAt)
            if buckets[day] == nil {
                buckets[day] = []
                order.append(day)
            }
            buckets[day]?.append(entry)
        }

        return order.map { day in
            (label: Self.dayLabel(for: day, calendar: calendar), entries: buckets[day] ?? [])
        }
    }

    private static func dayLabel(for day: Date, calendar: Calendar) -> String {
        if calendar.isDateInToday(day) { return "今日" }
        if calendar.isDateInYesterday(day) { return "昨日" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "M月d日(E)"
        return formatter.string(from: day)
    }
}

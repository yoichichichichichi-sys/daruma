import Foundation
import Combine
import WidgetKit

/// The app-side view model. Wraps UrlRepository with the reactive state
/// SwiftUI needs, and tells the widget to refresh after every change.
@MainActor
final class UrlStore: ObservableObject {
    @Published private(set) var entries: [UrlEntry] = []
    @Published var searchQuery: String = ""

    init() {
        entries = UrlRepository.ordered()
    }

    func refresh() {
        entries = UrlRepository.ordered()
    }

    @discardableResult
    func capture(_ text: String) -> Bool {
        guard let entry = UrlRepository.capture(text) else { return false }
        entries.removeAll { $0.id == entry.id }
        entries.insert(entry, at: 0)
        entries.sort { $0.addedAt > $1.addedAt }
        WidgetCenter.shared.reloadAllTimelines()
        return true
    }

    func delete(_ entry: UrlEntry) {
        entries.removeAll { $0.id == entry.id }
        UrlRepository.saveAll(entries)
        WidgetCenter.shared.reloadAllTimelines()
    }

    func clearAll() {
        entries.removeAll()
        UrlRepository.saveAll(entries)
        WidgetCenter.shared.reloadAllTimelines()
    }

    var filtered: [UrlEntry] {
        guard !searchQuery.isEmpty else { return entries }
        return entries.filter {
            $0.title.localizedCaseInsensitiveContains(searchQuery) ||
            $0.siteName.localizedCaseInsensitiveContains(searchQuery) ||
            $0.urlString.localizedCaseInsensitiveContains(searchQuery)
        }
    }
}

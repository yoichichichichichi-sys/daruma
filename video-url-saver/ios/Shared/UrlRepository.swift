import Foundation

/// Plain, synchronous read/write access to the JSON file living inside the
/// shared App Group container. The main app, the share extension, and the
/// widget extension's timeline provider all use this directly.
enum UrlRepository {

    private static var fileURL: URL {
        AppGroup.containerURL.appendingPathComponent("saved_urls.json")
    }

    static func loadAll() -> [UrlEntry] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder().decode([UrlEntry].self, from: data)) ?? []
    }

    static func saveAll(_ entries: [UrlEntry]) {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Newest first, same ordering the Android and web versions use.
    static func ordered() -> [UrlEntry] {
        loadAll().sorted { $0.addedAt > $1.addedAt }
    }

    /// Parses `rawText` for a URL and saves it, moving an existing
    /// duplicate back to the top instead of re-adding it. Used by the main
    /// app's foreground capture, its manual add field, and the share
    /// extension - so all three go through one de-dupe rule.
    @discardableResult
    static func capture(_ rawText: String) -> UrlEntry? {
        guard let resolved = UrlMetadataResolver.resolve(rawText) else { return nil }

        var entries = loadAll()
        let entry: UrlEntry
        if let index = entries.firstIndex(where: { $0.urlString == resolved.urlString }) {
            var existing = entries.remove(at: index)
            existing.addedAt = Date()
            entry = existing
        } else {
            entry = UrlEntry(
                urlString: resolved.urlString,
                title: resolved.title,
                siteName: resolved.siteName,
                thumbnailURLString: resolved.thumbnailURLString,
                kind: resolved.kind
            )
        }
        entries.insert(entry, at: 0)
        saveAll(entries)
        return entry
    }

    /// Index into `ordered()` that the widget is currently showing. Shared
    /// through the App Group's UserDefaults so the widget's prev/next
    /// buttons and its timeline stay in sync with each other.
    static var widgetIndex: Int {
        get { AppGroup.sharedDefaults.integer(forKey: "widgetIndex") }
        set { AppGroup.sharedDefaults.set(newValue, forKey: "widgetIndex") }
    }
}

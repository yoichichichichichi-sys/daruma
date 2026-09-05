import Foundation

/// Plain, synchronous read/write access to the JSON file living inside the
/// shared App Group container. Both the main app (via ClipStore) and the
/// widget extension's timeline provider use this directly - a widget's
/// timeline methods are expected to read their data synchronously, the same
/// way the Android version's RemoteViewsFactory does a blocking DB read.
enum ClipRepository {

    private static var fileURL: URL {
        AppGroup.containerURL.appendingPathComponent("clips.json")
    }

    static func loadAll() -> [ClipEntry] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder().decode([ClipEntry].self, from: data)) ?? []
    }

    static func saveAll(_ entries: [ClipEntry]) {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Pinned first, then newest first - same ordering the Android and web
    /// versions use.
    static func ordered() -> [ClipEntry] {
        loadAll().sorted { lhs, rhs in
            if lhs.pinned != rhs.pinned { return lhs.pinned && !rhs.pinned }
            return lhs.createdAt > rhs.createdAt
        }
    }

    /// Index into `ordered()` that the widget is currently showing. Shared
    /// through the App Group's UserDefaults so the widget's prev/next
    /// buttons and its timeline stay in sync with each other.
    static var widgetIndex: Int {
        get { AppGroup.sharedDefaults.integer(forKey: "widgetIndex") }
        set { AppGroup.sharedDefaults.set(newValue, forKey: "widgetIndex") }
    }
}

import Foundation

/// The App Group shared between the main app and the widget extension so
/// they can read and write the same clip history. This identifier must be
/// created under your own Apple Developer account and enabled as a
/// capability on BOTH targets (Signing & Capabilities > + Capability >
/// App Groups) - it cannot be set up from source code alone.
enum AppGroup {
    static let identifier = "group.com.copynotebook.shared"

    static var containerURL: URL {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier) else {
            fatalError("App Group '\(identifier)' is not configured. Enable it in Signing & Capabilities for both targets.")
        }
        return url
    }

    static var sharedDefaults: UserDefaults {
        guard let defaults = UserDefaults(suiteName: identifier) else {
            fatalError("App Group '\(identifier)' is not configured.")
        }
        return defaults
    }
}

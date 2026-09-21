import Foundation

/// The App Group shared between the main app, the share extension, and the
/// widget extension so they can read and write the same saved-URL list.
/// This identifier must be created under your own Apple Developer account
/// and enabled as a capability on ALL THREE targets (Signing & Capabilities
/// > + Capability > App Groups) - it cannot be set up from source code alone.
enum AppGroup {
    static let identifier = "group.com.videourlnotebook.shared"

    static var containerURL: URL {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier) else {
            fatalError("App Group '\(identifier)' is not configured. Enable it in Signing & Capabilities for all targets.")
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

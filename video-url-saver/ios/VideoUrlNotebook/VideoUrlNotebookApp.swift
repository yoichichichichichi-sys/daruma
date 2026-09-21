import SwiftUI
import UIKit
import WidgetKit

@main
struct VideoUrlNotebookApp: App {
    @StateObject private var store = UrlStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                store.refresh()
                captureFromPasteboardIfNeeded()
            }
        }
    }

    /// Best-effort automatic capture: when the app comes to the foreground,
    /// check whether the clipboard holds a URL and save it. See
    /// ios/README.md (コピペ帳) for why iOS requires this "open the app"
    /// trigger instead of a background listener, and why the first read of
    /// another app's clipboard content shows an "Allow Paste from ___"
    /// sheet - the PasteControlView button in ContentView skips that sheet.
    private func captureFromPasteboardIfNeeded() {
        guard UIPasteboard.general.hasStrings else { return }
        guard let text = UIPasteboard.general.string, !text.isEmpty else { return }
        store.capture(text)
    }
}

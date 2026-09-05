import SwiftUI
import UIKit

@main
struct CopyNotebookApp: App {
    @StateObject private var store = ClipStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                captureFromPasteboardIfNeeded()
            }
        }
    }

    /// Best-effort automatic capture: when the app comes to the foreground,
    /// check whether the clipboard holds new text and save it.
    ///
    /// Apple does not allow an app to silently read another app's clipboard
    /// content in the background - the first time this reads content placed
    /// there by a different app, iOS shows its own "Allow Paste from ___"
    /// confirmation sheet. That one-tap confirmation is the most automatic
    /// iOS permits; see ios/README.md for why, and for the PasteControlView
    /// alternative that skips the prompt entirely.
    private func captureFromPasteboardIfNeeded() {
        guard UIPasteboard.general.hasStrings else { return }
        guard let text = UIPasteboard.general.string, !text.isEmpty else { return }
        store.capture(text)
    }
}

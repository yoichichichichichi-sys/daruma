import SwiftUI
import UIKit

/// Wraps UIKit's UIPasteControl (iOS 16+) - a system-provided paste button.
/// Tapping it does NOT trigger iOS's "Allow Paste from ___" permission
/// sheet, because the tap itself is the user's explicit consent to paste;
/// that's what makes it the friction-free way to pull in "what I just
/// copied," compared to a plain UIPasteboard.general.string read.
///
/// This is the one piece of UIKit interop in this project most worth
/// double-checking in Xcode - it could not be compiled in the environment
/// this was written in. If it misbehaves, the app still works via the
/// plain-text "この内容を保存" flow and the best-effort foreground capture
/// in CopyNotebookApp.swift.
struct PasteControlView: UIViewRepresentable {
    var onPaste: (String) -> Void

    func makeUIView(context: Context) -> UIPasteControl {
        var configuration = UIPasteControl.Configuration()
        configuration.displayMode = .labelOnly
        let control = UIPasteControl(configuration: configuration)
        control.target = context.coordinator
        control.setContentHuggingPriority(.defaultHigh, for: .horizontal)
        return control
    }

    func updateUIView(_ uiView: UIPasteControl, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onPaste: onPaste)
    }

    final class Coordinator: NSObject, UIPasteConfigurationSupporting {
        let onPaste: (String) -> Void
        var pasteConfiguration: UIPasteConfiguration? = UIPasteConfiguration(forAccepting: NSString.self)

        init(onPaste: @escaping (String) -> Void) {
            self.onPaste = onPaste
        }

        func paste(itemProviders: [NSItemProvider]) {
            for provider in itemProviders where provider.canLoadObject(ofClass: NSString.self) {
                _ = provider.loadObject(ofClass: NSString.self) { object, _ in
                    guard let text = object as? String else { return }
                    DispatchQueue.main.async {
                        self.onPaste(text)
                    }
                }
            }
        }
    }
}

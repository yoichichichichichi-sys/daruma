import SwiftUI
import UIKit

/// Wraps UIKit's UIPasteControl (iOS 16+) - see ios/README.md (コピペ帳) for
/// why this is the friction-free way to pull in "what I just copied"
/// without iOS's "Allow Paste from ___" confirmation sheet.
struct PasteControlView: UIViewRepresentable {
    var onPaste: (String) -> Void

    func makeUIView(context: Context) -> UIPasteControl {
        var configuration = UIPasteControl.Configuration()
        configuration.displayMode = .iconOnly
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

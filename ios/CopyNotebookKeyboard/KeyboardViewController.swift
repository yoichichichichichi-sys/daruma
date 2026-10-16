import UIKit
import SwiftUI
import WidgetKit

/// The "paste from the list" half of the app.
///
/// iOS does not let any app change the system's long-press "Paste" menu -
/// it always pastes only the latest copy. The one place a third-party app
/// may type into *other* apps' text fields is a custom keyboard, so this is
/// a keyboard whose keys are the saved clips: switch to it with the 🌐 key,
/// tap any clip (latest, 2 before, 30 before - doesn't matter) and it is
/// inserted at the cursor, then 🌐 again to go back to your usual keyboard.
final class KeyboardViewController: UIInputViewController {

    private let model = KeyboardModel()
    private var hosting: UIHostingController<ClipKeyboardView>?

    override func viewDidLoad() {
        super.viewDidLoad()

        model.insert = { [weak self] text in self?.textDocumentProxy.insertText(text) }
        model.deleteBackward = { [weak self] in self?.textDocumentProxy.deleteBackward() }
        model.nextKeyboard = { [weak self] in self?.advanceToNextInputMode() }

        let host = UIHostingController(rootView: ClipKeyboardView(model: model))
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(host)
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.heightAnchor.constraint(equalToConstant: 300),
        ])
        host.didMove(toParent: self)
        hosting = host
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        model.hasFullAccess = hasFullAccess
        model.reload()
    }
}

/// State for the SwiftUI keyboard view.
final class KeyboardModel: ObservableObject {
    @Published var entries: [ClipEntry] = []
    /// nil = 「すべて」.
    @Published var selectedCategory: ClipCategory?
    /// Without "Allow Full Access" a keyboard extension cannot read the App
    /// Group container shared with the app, so there is nothing to show.
    @Published var hasFullAccess = false

    var insert: (String) -> Void = { _ in }
    var deleteBackward: () -> Void = {}
    var nextKeyboard: () -> Void = {}

    var visibleEntries: [ClipEntry] {
        guard let category = selectedCategory else { return entries }
        return entries.filter { $0.category == category }
    }

    func reload() {
        guard hasFullAccess else {
            entries = []
            return
        }
        entries = ClipRepository.ordered()
    }

    /// Files whatever is currently on the clipboard into the history.
    /// Triggered by a button tap, not automatically: reading the clipboard
    /// may show iOS's paste-permission banner.
    func saveCurrentClipboard() {
        guard hasFullAccess, let text = UIPasteboard.general.string else { return }
        ClipRepository.capture(text)
        WidgetCenter.shared.reloadAllTimelines()
        reload()
    }
}

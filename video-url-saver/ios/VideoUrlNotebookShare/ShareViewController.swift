import UIKit
import UniformTypeIdentifiers
import WidgetKit

/// The "plugin button" the app requirements describe: because this
/// extension declares NSExtensionActivationRule for URLs and text (see
/// Info.plist), iOS lists "動画URL帳に保存" in the system share sheet -
/// including the one YouTube (and every other app/browser) shows when you
/// tap the Share icon on a video or page. Picking it here saves the link
/// immediately with no further taps; unlike Android's transparent
/// ShareReceiverActivity, iOS extensions must show *something*, so this
/// briefly confirms and closes itself.
final class ShareViewController: UIViewController {

    private let statusLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.35)

        let card = UIView()
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 14
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        statusLabel.text = "保存しています..."
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(equalToConstant: 220),
            card.leadingAnchor.constraint(lessThanOrEqualTo: view.leadingAnchor, constant: 24),

            statusLabel.topAnchor.constraint(equalTo: card.topAnchor, constant: 24),
            statusLabel.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -24),
            statusLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            statusLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
        ])

        extractSharedText { [weak self] text in
            DispatchQueue.main.async {
                self?.handle(text: text)
            }
        }
    }

    private func handle(text: String?) {
        let entry = text.flatMap { UrlRepository.capture($0) }
        statusLabel.text = entry != nil ? "動画URL帳に保存しました" : "URLが見つかりませんでした"
        WidgetCenter.shared.reloadAllTimelines()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
    }

    /// Looks through every attachment of every extension item for either a
    /// URL or plain text - YouTube's share sheet and Safari's each supply
    /// these slightly differently, so both are handled.
    private func extractSharedText(completion: @escaping (String?) -> Void) {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            completion(nil)
            return
        }

        let attachments = items.flatMap { $0.attachments ?? [] }

        func tryNext(_ index: Int) {
            guard index < attachments.count else {
                completion(nil)
                return
            }
            let provider = attachments[index]

            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                    if let url = item as? URL {
                        completion(url.absoluteString)
                    } else {
                        tryNext(index + 1)
                    }
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                    if let text = item as? String {
                        completion(text)
                    } else {
                        tryNext(index + 1)
                    }
                }
            } else {
                tryNext(index + 1)
            }
        }

        tryNext(0)
    }
}

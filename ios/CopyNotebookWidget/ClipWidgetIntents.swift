import AppIntents
import WidgetKit
import UIKit

/// Moves the widget's "current card" pointer by one step, in either
/// direction. This is the iOS equivalent of Android's StackView swipe -
/// WidgetKit has no swipe-through-cards gesture, so a pair of chevron
/// buttons drives the same "send through history" behaviour instead.
struct ShiftClipIntent: AppIntent {
    static var title: LocalizedStringResource = "前後の履歴に切り替え"

    @Parameter(title: "方向")
    var direction: Int // -1 = previous, 1 = next

    init() {
        self.direction = 1
    }

    init(direction: Int) {
        self.direction = direction
    }

    func perform() async throws -> some IntentResult {
        let all = ClipRepository.ordered()
        guard !all.isEmpty else { return .result() }

        var index = ClipRepository.widgetIndex + direction
        if index < 0 { index = all.count - 1 }
        if index >= all.count { index = 0 }
        ClipRepository.widgetIndex = index

        WidgetCenter.shared.reloadTimelines(ofKind: "ClipWidget")
        return .result()
    }
}

/// Copies the currently shown card back to the system pasteboard. Writing
/// to UIPasteboard never needs permission (only reading someone else's
/// pasteboard content does), so this works instantly with no prompt.
struct CopyCurrentClipIntent: AppIntent {
    static var title: LocalizedStringResource = "この内容をコピー"

    @Parameter(title: "クリップID")
    var clipID: String

    init() {
        self.clipID = ""
    }

    init(clipID: String) {
        self.clipID = clipID
    }

    func perform() async throws -> some IntentResult {
        if let uuid = UUID(uuidString: clipID),
           let entry = ClipRepository.ordered().first(where: { $0.id == uuid }) {
            UIPasteboard.general.string = entry.text
        }
        return .result()
    }
}

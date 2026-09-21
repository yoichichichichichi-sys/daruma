import AppIntents
import WidgetKit

/// Moves the widget's "current card" pointer by one step, in either
/// direction - the iOS equivalent of Android's StackView swipe (see
/// コピペ帳's ShiftClipIntent for the full rationale).
struct ShiftUrlIntent: AppIntent {
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
        let all = UrlRepository.ordered()
        guard !all.isEmpty else { return .result() }

        var index = UrlRepository.widgetIndex + direction
        if index < 0 { index = all.count - 1 }
        if index >= all.count { index = 0 }
        UrlRepository.widgetIndex = index

        WidgetCenter.shared.reloadTimelines(ofKind: "UrlWidget")
        return .result()
    }
}

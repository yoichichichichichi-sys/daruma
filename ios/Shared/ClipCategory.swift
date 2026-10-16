import Foundation

/// Automatic "shelf" a saved clip is filed under - same rules as the
/// Android version's ClipCategory.kt. Derived from the text on the fly
/// rather than stored, so old clips need no migration and get re-sorted
/// whenever the rules improve.
enum ClipCategory: String, CaseIterable, Identifiable {
    case url, email, phone, number, text

    var id: String { rawValue }

    var label: String {
        switch self {
        case .url: return "リンク"
        case .email: return "メール"
        case .phone: return "電話番号"
        case .number: return "数字・コード"
        case .text: return "テキスト"
        }
    }

    var emoji: String {
        switch self {
        case .url: return "🔗"
        case .email: return "✉️"
        case .phone: return "📞"
        case .number: return "🔢"
        case .text: return "📝"
        }
    }

    static func classify(_ text: String) -> ClipCategory {
        // Japanese input often produces full-width digits/letters (０９０ー…).
        let dashed = text.replacingOccurrences(of: "ー", with: "-")
        let t = (dashed.applyingTransform(.fullwidthToHalfwidth, reverse: false) ?? dashed)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if t.contains("\n") { return .text }
        if matches(t, #"^(https?://|www\.)\S+$"#, caseInsensitive: true) { return .url }
        if matches(t, #"^[\w.+-]+@[\w-]+(\.[\w-]+)+$"#) { return .email }

        let digits = t.filter(\.isASCIIDigit).count
        if matches(t, #"^\+?[\d\-\s()]+$"#), (10...13).contains(digits),
           t.hasPrefix("0") || t.hasPrefix("+") || t.hasPrefix("(0") {
            return .phone
        }
        if matches(t, #"^[\dA-Za-z\-_.,:/#]+$"#), digits > 0, digits * 2 >= t.count {
            return .number
        }
        return .text
    }

    private static func matches(_ s: String, _ pattern: String, caseInsensitive: Bool = false) -> Bool {
        s.range(of: pattern, options: caseInsensitive ? [.regularExpression, .caseInsensitive] : .regularExpression) != nil
    }
}

private extension Character {
    var isASCIIDigit: Bool { ("0"..."9").contains(self) }
}

extension ClipEntry {
    var category: ClipCategory { ClipCategory.classify(text) }
}

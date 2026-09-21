import Foundation

/// Turns raw shared/pasted text into a saveable UrlEntry shape: finds the
/// first URL in the text, works out whether it's a YouTube or Vimeo link
/// (to point straight at their public thumbnail CDNs), and falls back to a
/// favicon for anything else. Mirrors the Android UrlMetadataResolver and
/// the web prototype's buildMetadata() so all three platforms save the
/// same shape of entry.
enum UrlMetadataResolver {

    struct Resolved {
        let urlString: String
        let kind: LinkKind
        let siteName: String
        let title: String
        let thumbnailURLString: String
    }

    static func resolve(_ rawText: String) -> Resolved? {
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let candidate = firstURL(in: trimmed) ?? trimmed
        guard let components = URLComponents(string: candidate),
              let scheme = components.scheme, scheme == "http" || scheme == "https",
              let host = components.host else { return nil }

        if let id = youTubeID(components: components, host: host) {
            return Resolved(
                urlString: candidate,
                kind: .youtube,
                siteName: "YouTube",
                title: "YouTube動画",
                thumbnailURLString: "https://i.ytimg.com/vi/\(id)/hqdefault.jpg"
            )
        }

        if let id = vimeoID(components: components, host: host) {
            return Resolved(
                urlString: candidate,
                kind: .vimeo,
                siteName: "Vimeo",
                title: "Vimeo動画",
                thumbnailURLString: "https://vumbnail.com/\(id).jpg"
            )
        }

        let siteName = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        let encoded = candidate.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? candidate
        return Resolved(
            urlString: candidate,
            kind: .site,
            siteName: siteName,
            title: siteName,
            thumbnailURLString: "https://www.google.com/s2/favicons?sz=128&domain_url=\(encoded)"
        )
    }

    private static func firstURL(in text: String) -> String? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return nil
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = detector.firstMatch(in: text, range: range), let url = match.url else { return nil }
        return url.absoluteString
    }

    private static func youTubeID(components: URLComponents, host: String) -> String? {
        var normalized = host
        for prefix in ["www.", "m.", "music."] where normalized.hasPrefix(prefix) {
            normalized = String(normalized.dropFirst(prefix.count))
        }

        let pathSegments = components.path.split(separator: "/").map(String.init)
        switch normalized {
        case "youtu.be":
            return pathSegments.first
        case "youtube.com":
            if components.path == "/watch" {
                return components.queryItems?.first(where: { $0.name == "v" })?.value
            }
            if pathSegments.first == "shorts" || pathSegments.first == "embed" || pathSegments.first == "live" {
                return pathSegments.count > 1 ? pathSegments[1] : nil
            }
            return nil
        default:
            return nil
        }
    }

    private static func vimeoID(components: URLComponents, host: String) -> String? {
        var normalized = host
        for prefix in ["www.", "player."] where normalized.hasPrefix(prefix) {
            normalized = String(normalized.dropFirst(prefix.count))
        }
        guard normalized == "vimeo.com" else { return nil }
        let pathSegments = components.path.split(separator: "/").map(String.init)
        guard let first = pathSegments.first, first.allSatisfy(\.isNumber) else { return nil }
        return first
    }
}

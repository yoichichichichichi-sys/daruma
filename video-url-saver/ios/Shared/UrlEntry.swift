import Foundation

enum LinkKind: String, Codable {
    case youtube
    case vimeo
    case site
}

struct UrlEntry: Identifiable, Codable, Equatable {
    let id: UUID
    var urlString: String
    var title: String
    var siteName: String
    var thumbnailURLString: String
    var kind: LinkKind
    var addedAt: Date

    init(
        id: UUID = UUID(),
        urlString: String,
        title: String,
        siteName: String,
        thumbnailURLString: String,
        kind: LinkKind,
        addedAt: Date = Date()
    ) {
        self.id = id
        self.urlString = urlString
        self.title = title
        self.siteName = siteName
        self.thumbnailURLString = thumbnailURLString
        self.kind = kind
        self.addedAt = addedAt
    }

    var url: URL? { URL(string: urlString) }
    var thumbnailURL: URL? { URL(string: thumbnailURLString) }
}

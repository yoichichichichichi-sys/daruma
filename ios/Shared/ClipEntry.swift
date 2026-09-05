import Foundation

struct ClipEntry: Identifiable, Codable, Equatable {
    let id: UUID
    var text: String
    var createdAt: Date
    var pinned: Bool

    init(id: UUID = UUID(), text: String, createdAt: Date = Date(), pinned: Bool = false) {
        self.id = id
        self.text = text
        self.createdAt = createdAt
        self.pinned = pinned
    }
}

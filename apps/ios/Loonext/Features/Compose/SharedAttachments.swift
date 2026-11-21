import Foundation

struct SharedAttachments: Identifiable, Sendable {
    static let maxFiles = 10
    static let maxFileBytes = 25 * 1024 * 1024
    private static let lifetime: TimeInterval = 86_400
    #if LOONEXT_QA
    private static let group = "group.com.loonext.ios.qa"
    #else
    private static let group = "group.com.loonext.ios"
    #endif

    let directory: URL
    let files: [URL]
    var id: URL { directory }

    static func directory() throws -> URL {
        let manager = FileManager.default
        guard let container = manager.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw CocoaError(.fileWriteNoPermission)
        }
        let inbox = container.appendingPathComponent("SharedAttachments", isDirectory: true)
        try manager.createDirectory(at: inbox, withIntermediateDirectories: true)
        return inbox
    }

    static func next() -> SharedAttachments? {
        let manager = FileManager.default
        let keys: Set<URLResourceKey> = [.creationDateKey, .isDirectoryKey]
        guard let inbox = try? directory(),
              let items = try? manager.contentsOfDirectory(at: inbox, includingPropertiesForKeys: Array(keys))
        else { return nil }

        let cutoff = Date().addingTimeInterval(-lifetime)
        let shares = items.compactMap { item -> (URL, Date)? in
            guard let metadata = try? item.resourceValues(forKeys: keys),
                  let created = metadata.creationDate, metadata.isDirectory == true
            else { return nil }
            if created < cutoff {
                try? manager.removeItem(at: item)
                return nil
            }
            return item.pathExtension == "ready" ? (item, created) : nil
        }.sorted { $0.1 < $1.1 }

        for (directory, _) in shares {
            guard let folders = try? manager.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: nil, options: .skipsHiddenFiles
            ) else { continue }
            let files = folders.sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { folder in
                try? manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).first
            }
            if !files.isEmpty {
                return SharedAttachments(directory: directory, files: files)
            }
        }
        return nil
    }

    func discard() {
        try? FileManager.default.removeItem(at: directory)
    }
}

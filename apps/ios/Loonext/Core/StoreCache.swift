import CryptoKit
import Foundation
import Security

private let readCacheCapacity = 5 * 1024 * 1024
private let keychainService = "com.loonext.ios.offline-reads"
private let cachedRecordId = "[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}"
private let detailRoutePattern = "^/v1/(conversations/\(cachedRecordId)(/messages|/events)?|tasks/\(cachedRecordId))$"

actor StoreCache {
    private let directory: URL
    private let diskKey: SymmetricKey?
    private let memory = NSCache<NSString, NSData>()

    init(
        directory: URL = URL.applicationSupportDirectory.appendingPathComponent("OfflineReads", isDirectory: true),
        diskKey: SymmetricKey? = nil
    ) {
        self.directory = directory
        self.diskKey = diskKey
        memory.totalCostLimit = readCacheCapacity
    }

    func read(_ key: String) -> Data? {
        let url = fileURL(key)
        if let data = memory.object(forKey: key as NSString) {
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
            return data as Data
        }
        guard let encryptionKey = encryptionKey(create: false),
              let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              (1...readCacheCapacity).contains(size),
              let bytes = try? Data(contentsOf: url),
              let sealed = try? AES.GCM.SealedBox(combined: bytes),
              let data = try? AES.GCM.open(sealed, using: encryptionKey, authenticating: Data(key.utf8))
        else { return nil }
        memory.setObject(data as NSData, forKey: key as NSString, cost: data.count)
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
        return data
    }

    func write(_ data: Data, for key: String, whileSignedIn: @Sendable () -> Bool) {
        guard data.count < readCacheCapacity, whileSignedIn() else { return }
        memory.setObject(data as NSData, forKey: key as NSString, cost: data.count)
        guard let encryptionKey = encryptionKey(create: true),
              let sealed = try? AES.GCM.seal(data, using: encryptionKey, authenticating: Data(key.utf8)),
              let bytes = sealed.combined, bytes.count <= readCacheCapacity else { return }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var protectedDirectory = directory
            var resources = URLResourceValues()
            resources.isExcludedFromBackup = true
            try protectedDirectory.setResourceValues(resources)
            try bytes.write(to: fileURL(key), options: [.atomic, .completeFileProtection])
            prune()
        } catch {
            return
        }
    }

    func remove(_ key: String) {
        memory.removeObject(forKey: key as NSString)
        try? FileManager.default.removeItem(at: fileURL(key))
    }

    func clear() {
        memory.removeAllObjects()
        try? FileManager.default.removeItem(at: directory)
    }

    static func discardDiskKey() {
        SecItemDelete(keychainQuery as CFDictionary)
    }

    private func fileURL(_ key: String) -> URL {
        let hash = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(hash + ".read")
    }

    private func prune() {
        let keys: Set<URLResourceKey> = [.fileSizeKey, .contentModificationDateKey]
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: Array(keys), options: [.skipsHiddenFiles]
        ) else { return }
        let entries = files.compactMap { file -> (URL, Int, Date)? in
            guard file.pathExtension == "read",
                  let values = try? file.resourceValues(forKeys: keys),
                  let size = values.fileSize else { return nil }
            return (file, size, values.contentModificationDate ?? .distantPast)
        }
        var total = entries.reduce(0) { $0 + $1.1 }
        for (url, size, _) in entries.sorted(by: { $0.2 < $1.2 }) {
            if total <= readCacheCapacity { break }
            do {
                try FileManager.default.removeItem(at: url)
                total -= size
            } catch {
                continue
            }
        }
    }

    private static var keychainQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: "read-cache-key",
        ]
    }

    private func encryptionKey(create: Bool) -> SymmetricKey? {
        if let diskKey { return diskKey }
        var query = Self.keychainQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess, let bytes = result as? Data {
            return SymmetricKey(data: bytes)
        }
        guard status == errSecItemNotFound, create else { return nil }
        let key = SymmetricKey(size: .bits256)
        var insert = Self.keychainQuery
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        insert[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        let added = SecItemAdd(insert as CFDictionary, nil)
        if added == errSecDuplicateItem { return encryptionKey(create: false) }
        return added == errSecSuccess ? key : nil
    }
}

func isOfflineRead(path: String, query: [String: String?], userId: String) -> Bool {
    let supplied = query.compactMapValues { $0 }
    switch path {
    case "/v1/for-you":
        return supplied.isEmpty
    case "/v1/conversations":
        return Set(supplied.keys).isSubset(of: ["limit", "status", "pinned"]) &&
            [nil, "open"].contains(supplied["status"]) &&
            [nil, "only", "exclude"].contains(supplied["pinned"])
    case "/v1/tasks":
        return Set(supplied.keys).isSubset(of: ["limit", "status", "assigned_user_id"]) &&
            [nil, "all", "me", userId].contains(supplied["assigned_user_id"])
    default:
        return supplied.keys.allSatisfy { $0 == "limit" } &&
            path.range(of: detailRoutePattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

extension ApiError {
    var invalidatesOfflineReads: Bool { [401, 403, 404, 410].contains(httpStatus) }
}

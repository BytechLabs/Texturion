import Foundation
import UIKit
import UniformTypeIdentifiers

/// SPEC §7 outbound MMS limits — validated here AND by the API.
let maxPhotos = 3
let maxPhotoBytes = 1024 * 1024
let acceptedPhotoTypes: Set<String> = ["image/jpeg", "image/png", "image/gif"]

/// D19 note-file limits (server: 10 files per owner, 25 MB each).
let maxNoteFiles = 10
let maxNoteFileBytes: Int64 = 25 * 1024 * 1024

/// A photo staged on the composer: bytes ready for base64 inline send.
struct StagedPhoto: Identifiable, Equatable, Sendable {
    let id: String
    let contentType: String
    let bytes: Data

    func toOutboundMedia() -> OutboundMedia {
        OutboundMedia(content_type: contentType, base64: bytes.base64EncodedString())
    }

    // Identity by staged id — Data equality would compare megabytes otherwise.
    static func == (lhs: StagedPhoto, rhs: StagedPhoto) -> Bool { lhs.id == rhs.id }
}

/// A note file staged for upload AFTER the note row exists (D28 chain). The
/// picked document is copied into our scratch container at stage time so the
/// bytes stay readable after the picker's security scope ends.
struct StagedFile: Identifiable, Equatable, Sendable {
    let id: String
    let localURL: URL
    let name: String
    let contentType: String
    let sizeBytes: Int64

    static func == (lhs: StagedFile, rhs: StagedFile) -> Bool { lhs.id == rhs.id }
}

enum PhotoPrepResult: Sendable {
    case ready(StagedPhoto)
    case rejected(String)
}

/// Sniff the image type from magic bytes — the server byte-sniffs the same
/// way, so the declared picker type is never trusted.
private func sniffImageType(_ data: Data) -> String? {
    guard data.count >= 4 else { return nil }
    let b = [UInt8](data.prefix(4))
    if b[0] == 0xFF, b[1] == 0xD8, b[2] == 0xFF { return "image/jpeg" }
    if b[0] == 0x89, b[1] == 0x50, b[2] == 0x4E, b[3] == 0x47 { return "image/png" }
    if b[0] == 0x47, b[1] == 0x49, b[2] == 0x46, b[3] == 0x38 { return "image/gif" }
    return nil
}

/// Read + normalize one picked image for MMS: jpeg/png/gif ≤1 MB pass through
/// untouched (an animated GIF survives); anything else — HEIC, WebP, or an
/// oversized photo — is transcoded to JPEG under 1 MB with the platform codecs
/// (progressive downscale + quality steps). Pure and synchronous; call it off
/// the main thread for large camera originals.
nonisolated func preparePhoto(data: Data) -> PhotoPrepResult {
    if data.isEmpty {
        return .rejected("Couldn't read that photo. Try attaching it again.")
    }
    if let sniffed = sniffImageType(data), acceptedPhotoTypes.contains(sniffed),
       data.count <= maxPhotoBytes {
        return .ready(StagedPhoto(id: UUID().uuidString, contentType: sniffed, bytes: data))
    }
    guard let jpeg = transcodeToJpeg(data) else {
        return .rejected("That image can't be sent. Try a different photo.")
    }
    return .ready(StagedPhoto(id: UUID().uuidString, contentType: "image/jpeg", bytes: jpeg))
}

/// Decode, downscale to a sane texting size, and JPEG-compress under the 1 MB
/// wire cap. Returns nil when the bytes aren't a decodable image.
private nonisolated func transcodeToJpeg(_ raw: Data) -> Data? {
    guard var image = UIImage(data: raw), image.size.width > 0, image.size.height > 0 else {
        return nil
    }

    // Downscale toward ≤2048pt on the long edge first — keeps peak memory
    // flat for huge camera originals.
    let longEdge = max(image.size.width, image.size.height)
    if longEdge > 2048 {
        let scale = 2048 / longEdge
        guard let scaled = resized(
            image,
            to: CGSize(width: image.size.width * scale, height: image.size.height * scale)
        ) else { return nil }
        image = scaled
    }

    // Quality steps, then halve dimensions and try again — always terminates.
    for _ in 0 ..< 4 {
        for quality in [0.85, 0.7, 0.55, 0.4] {
            if let bytes = image.jpegData(compressionQuality: quality),
               bytes.count <= maxPhotoBytes {
                return bytes
            }
        }
        let nextW = max(1, image.size.width / 2)
        let nextH = max(1, image.size.height / 2)
        if nextW == image.size.width, nextH == image.size.height { return nil }
        guard let scaled = resized(image, to: CGSize(width: nextW, height: nextH)) else {
            return nil
        }
        image = scaled
    }
    return nil
}

private nonisolated func resized(_ image: UIImage, to size: CGSize) -> UIImage? {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: size, format: format)
    return renderer.image { _ in
        image.draw(in: CGRect(origin: .zero, size: size))
    }
}

enum FileStageResult: Sendable {
    case ready(StagedFile)
    case rejected(String)
}

/// Resolve name/size/type for a document-picker URL, enforce the D19 limits,
/// and copy the bytes into a scratch file that outlives the picker's
/// security scope.
nonisolated func stageNoteFile(pickedURL: URL) -> FileStageResult {
    let accessing = pickedURL.startAccessingSecurityScopedResource()
    defer {
        if accessing { pickedURL.stopAccessingSecurityScopedResource() }
    }

    let name = pickedURL.lastPathComponent
    guard !name.isEmpty else {
        return .rejected("Couldn't read that file. Try picking it again.")
    }

    let size: Int64
    do {
        let values = try pickedURL.resourceValues(forKeys: [.fileSizeKey])
        guard let fileSize = values.fileSize else {
            return .rejected("Couldn't read that file's size. Try picking it again.")
        }
        size = Int64(fileSize)
    } catch {
        return .rejected("Couldn't read that file's size. Try picking it again.")
    }
    if size > maxNoteFileBytes {
        return .rejected("Files can be up to 25 MB each.")
    }

    let id = UUID().uuidString
    let stagingDir = FileManager.default.temporaryDirectory
        .appendingPathComponent("note-staging", isDirectory: true)
    let destination = stagingDir.appendingPathComponent(id, isDirectory: false)
    do {
        try FileManager.default.createDirectory(at: stagingDir, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: pickedURL, to: destination)
    } catch {
        return .rejected("Couldn't read that file. Try picking it again.")
    }

    let contentType = UTType(filenameExtension: pickedURL.pathExtension)?
        .preferredMIMEType ?? "application/octet-stream"
    return .ready(
        StagedFile(
            id: id,
            localURL: destination,
            name: name,
            contentType: contentType,
            sizeBytes: size
        )
    )
}

/// Read a staged file's bytes at upload time (the scratch copy is still live).
nonisolated func readStagedFile(_ file: StagedFile) -> Data? {
    try? Data(contentsOf: file.localURL)
}

/// Delete the scratch copy once the file was uploaded or the chip removed.
nonisolated func discardStagedFile(_ file: StagedFile) {
    try? FileManager.default.removeItem(at: file.localURL)
}

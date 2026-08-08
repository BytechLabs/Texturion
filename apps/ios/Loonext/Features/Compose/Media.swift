import Foundation
import UIKit
import UniformTypeIdentifiers

/// SPEC §7 outbound MMS limits — validated here AND by the API.
let maxPhotos = 3
let maxPhotoBytes = 1024 * 1024
let acceptedPhotoTypes: Set<String> = ["image/jpeg", "image/png", "image/gif"]

/// Everything a text can actually carry outbound (#189). Photos are only the
/// most common case; the phone apps and the web composer admit the same set,
/// and the API re-checks it. Mirrors MMS_OUTBOUND_MEDIA_TYPES on Android.
let mmsOutboundMediaTypes: Set<String> = [
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "audio/mpeg", "audio/mp4", "audio/amr", "audio/wav", "audio/ogg", "audio/3gpp",
    "video/mp4", "video/3gpp", "video/quicktime",
    "application/pdf", "text/vcard", "text/x-vcard", "text/calendar", "text/plain",
]

/// Spellings that mean a type we already admit. Pickers and file systems
/// disagree about these, and rejecting "audio/x-m4a" for not being
/// "audio/mp4" would be a lie about what we can send.
private let mmsTypeAliases: [String: String] = [
    "audio/x-m4a": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/vnd.wave": "audio/wav",
    "audio/amr-nb": "audio/amr",
    "audio/mp3": "audio/mpeg",
    "video/3gp": "video/3gpp",
    "text/directory": "text/vcard",
]

/// Fallback when a picker declares nothing useful (or "public.data").
private let mmsExtensionTypes: [String: String] = [
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp",
    "mp3": "audio/mpeg", "m4a": "audio/mp4", "amr": "audio/amr",
    "wav": "audio/wav", "ogg": "audio/ogg", "oga": "audio/ogg",
    "mp4": "video/mp4", "3gp": "video/3gpp", "mov": "video/quicktime",
    "pdf": "application/pdf", "vcf": "text/vcard", "ics": "text/calendar",
    "txt": "text/plain",
]

/// Lowercase, parameters stripped, aliases mapped.
nonisolated func canonicalMmsType(_ raw: String) -> String {
    let cleaned = raw
        .split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false)
        .first
        .map(String.init)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased() ?? ""
    return mmsTypeAliases[cleaned] ?? cleaned
}

/// The content type a picked file would be SENT as; nil = not deliverable.
nonisolated func mmsTypeForFile(declaredType: String?, name: String?) -> String? {
    let declared = canonicalMmsType(declaredType ?? "")
    if mmsOutboundMediaTypes.contains(declared) { return declared }
    let ext = (name ?? "")
        .split(separator: ".").last
        .map { $0.lowercased() } ?? ""
    return mmsExtensionTypes[ext]
}

/// "312 B" / "48 KB" / "0.9 MB" for staged chips.
nonisolated func stagedSizeLabel(_ sizeBytes: Int) -> String {
    if sizeBytes < 1024 { return "\(sizeBytes) B" }
    if sizeBytes < 1024 * 1024 { return "\((sizeBytes + 512) / 1024) KB" }
    return String(format: "%.1f MB", Double(sizeBytes) / (1024.0 * 1024.0))
}

/// D19 note-file limits (server: 10 files per owner, 25 MB each).
let maxNoteFiles = 10
let maxNoteFileBytes: Int64 = 25 * 1024 * 1024

/// One item staged on the composer for an outbound text: bytes ready for
/// base64 inline send. Not only photos — a text can carry audio, video, a
/// contact card, a calendar invite, a PDF or a plain-text file — so `name`
/// and `sizeBytes` ride along for the chips that cannot show a thumbnail.
struct StagedPhoto: Identifiable, Equatable, Sendable {
    let id: String
    let contentType: String
    let bytes: Data
    /// The picked file's display name, when it came from the file picker.
    var name: String?

    var sizeBytes: Int { bytes.count }

    /// The coarse kind a chip labels and icons itself by.
    var kind: MediaKind { MediaKind.of(contentType) }

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

/// Stage one picked document as outbound MMS media (#189): resolve the name and
/// type, route images through the existing transcode pipeline (an oversized
/// photo still becomes deliverable), and hold everything else to the 1 MB
/// decoded ceiling. Rejection copy matches the web and Android composers word
/// for word.
nonisolated func stageMmsMedia(pickedURL: URL) -> PhotoPrepResult {
    let accessing = pickedURL.startAccessingSecurityScopedResource()
    defer {
        if accessing { pickedURL.stopAccessingSecurityScopedResource() }
    }

    let name = pickedURL.lastPathComponent
    let display = name.isEmpty ? "That file" : "\"\(name)\""
    let declared = try? pickedURL.resourceValues(forKeys: [.contentTypeKey])
        .contentType?.preferredMIMEType

    guard let contentType = mmsTypeForFile(declaredType: declared ?? nil, name: name) else {
        return .rejected(
            "\(display) isn't something a text can carry. "
                + "Try a photo, video, audio clip, contact card, or PDF."
        )
    }

    guard let bytes = try? Data(contentsOf: pickedURL, options: .mappedIfSafe) else {
        return .rejected("Couldn't read that file. Try picking it again.")
    }
    if bytes.isEmpty { return .rejected("\(display) is empty.") }

    // Images go through the transcoder: an oversized or HEIC photo becomes
    // deliverable rather than being turned away.
    if contentType.hasPrefix("image/") {
        switch preparePhoto(data: bytes) {
        case .ready(let photo):
            return .ready(
                StagedPhoto(
                    id: photo.id,
                    contentType: photo.contentType,
                    bytes: photo.bytes,
                    name: name.isEmpty ? nil : name
                )
            )
        case .rejected(let reason):
            return .rejected(reason)
        }
    }

    if bytes.count > maxPhotoBytes {
        return .rejected("\(display) is over 1 MB, the most a text can carry.")
    }
    return .ready(
        StagedPhoto(
            id: UUID().uuidString,
            contentType: contentType,
            // A memory-mapped Data would be read lazily long after the
            // security scope closes; copy the bytes we are going to send.
            bytes: Data(bytes),
            name: name.isEmpty ? nil : name
        )
    )
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
/// The D19 note-attachment allow-list: images (never SVG), PDFs, plain text,
/// CSV, zip, and the Office/OpenDocument family. The server is the authority
/// (it sniffs the bytes), so this only stops a file the picker should never
/// have offered — an .exe, say — before it is staged, with the same sentence
/// the web composer uses. Mirrors isAllowedAttachmentType in
/// apps/web/src/lib/attachments/validate.ts.
private let allowedNoteFileTypes: Set<String> = [
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/zip",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
]

nonisolated func isAllowedNoteFileType(_ contentType: String) -> Bool {
    let type = contentType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if type == "image/svg+xml" { return false }
    if type.hasPrefix("image/") { return type.count > "image/".count }
    return allowedNoteFileTypes.contains(type)
}

nonisolated func stageNoteFile(pickedURL: URL) -> FileStageResult {
    let accessing = pickedURL.startAccessingSecurityScopedResource()
    defer {
        if accessing { pickedURL.stopAccessingSecurityScopedResource() }
    }

    let name = pickedURL.lastPathComponent
    guard !name.isEmpty else {
        return .rejected("Couldn't read that file. Try picking it again.")
    }

    // Only reject a type that is PRESENT and explicitly disallowed: the server
    // sniffs the bytes and is the authority, so an unknown type still goes.
    let declaredType = (try? pickedURL.resourceValues(forKeys: [.contentTypeKey]))?
        .contentType?.preferredMIMEType ?? ""
    if !declaredType.isEmpty, !isAllowedNoteFileType(declaredType) {
        return .rejected("That file type isn't allowed. Images, PDFs, and documents only.")
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

/// #294 — park marked-up bytes where the uploader already knows how to read them.
///
/// A staged file is a URL on disk, not a buffer, so an edited photo needs somewhere
/// to live between the editor and the send. It goes beside the scratch copy it
/// replaces, and the OLD file is deleted — leaving a copy of a customer's kitchen
/// around to be swept later is the opposite of what #330 spent a day on.
///
/// Returns nil when the write fails, and the caller keeps the unmarked original:
/// losing the arrow is annoying, losing the photo is not acceptable.
nonisolated func stageMarkedUpPhoto(_ original: StagedFile, data: Data) -> StagedFile? {
    let name = PhotoMarkup.markedUpFileName(original.name)
    let target = original.localURL
        .deletingLastPathComponent()
        .appendingPathComponent("markup-\(original.id)-\(name)")
    do {
        try data.write(to: target)
    } catch {
        return nil
    }
    try? FileManager.default.removeItem(at: original.localURL)
    return StagedFile(
        id: original.id,
        localURL: target,
        name: name,
        contentType: "image/jpeg",
        sizeBytes: Int64(data.count)
    )
}

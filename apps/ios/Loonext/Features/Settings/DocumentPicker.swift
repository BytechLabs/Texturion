import SwiftUI
import UniformTypeIdentifiers

/// The upload routes accept exactly these types, up to 10 MB each.
let maxDocumentBytes = 10 * 1024 * 1024

/// One tap target that opens the system file importer for a single multipart
/// field (LOA / carrier invoice / bill) and hands back a validated
/// `DocumentUpload`: PDF/PNG/JPEG only, 10 MB ceiling checked client-side
/// (the server enforces the same), bytes read off the main thread.
struct DocumentPickButton: View {
    let label: String
    let fieldName: String
    var disabled: Bool = false
    let onPicked: @MainActor (DocumentUpload) -> Void
    let onError: @MainActor (String) -> Void

    @State private var importing = false

    var body: some View {
        Button(label) { importing = true }
            .buttonStyle(.bordered)
            .disabled(disabled)
            .fileImporter(
                isPresented: $importing,
                allowedContentTypes: [.pdf, .png, .jpeg]
            ) { result in
                switch result {
                case .success(let url):
                    let field = fieldName
                    Task {
                        let upload = await Task.detached(priority: .userInitiated) {
                            readDocument(url: url, fieldName: field)
                        }.value
                        if let upload {
                            onPicked(upload)
                        } else {
                            onError("Use a PDF, PNG, or JPEG up to 10 MB.")
                        }
                    }
                case .failure:
                    onError("Couldn't read that file. Try another one.")
                }
            }
    }
}

/// Read + validate a picked document. Nil when the type is wrong, the file is
/// empty, or it exceeds 10 MB.
func readDocument(url: URL, fieldName: String) -> DocumentUpload? {
    let scoped = url.startAccessingSecurityScopedResource()
    defer {
        if scoped { url.stopAccessingSecurityScopedResource() }
    }
    guard let type = UTType(filenameExtension: url.pathExtension) else { return nil }
    let mime: String
    let fallbackExtension: String
    if type.conforms(to: .pdf) {
        mime = "application/pdf"
        fallbackExtension = "pdf"
    } else if type.conforms(to: .png) {
        mime = "image/png"
        fallbackExtension = "png"
    } else if type.conforms(to: .jpeg) {
        mime = "image/jpeg"
        fallbackExtension = "jpg"
    } else {
        return nil
    }
    guard let data = try? Data(contentsOf: url), !data.isEmpty, data.count <= maxDocumentBytes else {
        return nil
    }
    let name = url.lastPathComponent
    return DocumentUpload(
        fieldName: fieldName,
        fileName: name.isEmpty ? "\(fieldName).\(fallbackExtension)" : name,
        mimeType: mime,
        bytes: data
    )
}

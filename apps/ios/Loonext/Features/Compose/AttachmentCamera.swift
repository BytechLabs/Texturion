import ImageIO
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct AttachmentCamera: UIViewControllerRepresentable {
    let onCapture: (Data?) -> Void
    let onCancel: () -> Void

    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.image.identifier]
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: AttachmentCamera

        init(parent: AttachmentCamera) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            parent.onCapture((info[.originalImage] as? UIImage)?.jpegData(compressionQuality: 0.92))
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.onCancel()
        }
    }
}

struct AttachmentSourceActions: View {
    let locale: String
    let onCamera: () -> Void
    let onPhotos: () -> Void
    let onFiles: () -> Void

    var body: some View {
        if AttachmentCamera.isAvailable {
            Button(action: onCamera) {
                Label(AppStrings.translate(locale, "thread.takePhoto"), systemImage: "camera")
            }
        }
        Button(action: onPhotos) {
            Label(AppStrings.translate(locale, "thread.photoLibrary"), systemImage: "photo")
        }
        Button(action: onFiles) {
            Label(AppStrings.translate(locale, "thread.attachFile"), systemImage: "paperclip")
        }
    }
}

nonisolated func stageNotePhoto(data: Data, locale: String) -> FileStageResult {
    guard Int64(data.count) <= maxNoteFileBytes else {
        return .rejected(AppStrings.translate(locale, "contactsTasks.noteFileTooBig"))
    }
    guard let image = CGImageSourceCreateWithData(data as CFData, nil),
          let imageType = CGImageSourceGetType(image),
          let suffix = UTType(imageType as String)?.preferredFilenameExtension else {
        return .rejected(AppStrings.translate(locale, "thread.photoReadFailed"))
    }
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let url = folder.appendingPathComponent("photo").appendingPathExtension(suffix)
    do {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: folder) }
        try data.write(to: url, options: .atomic)
        return stageNoteFile(pickedURL: url, locale: locale)
    } catch {
        return .rejected(AppStrings.translate(locale, "thread.photoReadFailed"))
    }
}

import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private var copyTask: Task<Void, Never>?
    private let status = UILabel()
    private let save = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        status.text = NSLocalizedString("share.instructions", comment: "")
        status.font = .preferredFont(forTextStyle: .body)
        status.adjustsFontForContentSizeCategory = true
        status.numberOfLines = 0
        save.setTitle(NSLocalizedString("share.save", comment: ""), for: .normal)
        save.addTarget(self, action: #selector(saveItems), for: .touchUpInside)
        let close = UIButton(type: .system)
        close.setTitle(NSLocalizedString("share.close", comment: ""), for: .normal)
        close.addTarget(self, action: #selector(closeExtension), for: .touchUpInside)
        let content = UIStackView(arrangedSubviews: [status, save, close])
        content.axis = .vertical
        content.spacing = 16
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            content.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            save.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            close.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
    }

    @objc private func closeExtension() {
        copyTask?.cancel()
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    @objc private func saveItems() {
        save.isEnabled = false
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        copyTask = Task {
            do {
                try await copy(providers)
                status.text = NSLocalizedString("share.saved", comment: "")
                save.isHidden = true
            } catch is CancellationError {
                return
            } catch {
                status.text = NSLocalizedString("share.failed", comment: "")
                save.isEnabled = true
            }
        }
    }

    private func copy(_ providers: [NSItemProvider]) async throws {
        guard (1...SharedAttachments.maxFiles).contains(providers.count) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let manager = FileManager.default
        let inbox = try SharedAttachments.directory()
        let working = inbox.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try manager.createDirectory(at: working, withIntermediateDirectories: false)
        defer { try? manager.removeItem(at: working) }
        for (index, provider) in providers.enumerated() {
            try Task.checkCancellation()
            let folder = working.appendingPathComponent(String(index), isDirectory: true)
            try manager.createDirectory(at: folder, withIntermediateDirectories: false)
            try await copy(provider, to: folder)
        }
        try Task.checkCancellation()
        try manager.moveItem(at: working, to: working.appendingPathExtension("ready"))
    }

    private func copy(_ provider: NSItemProvider, to folder: URL) async throws {
        let types = provider.registeredTypeIdentifiers.compactMap { UTType($0) }
        guard let type = types.first(where: { $0.conforms(to: .image) || $0.conforms(to: .pdf) || $0.conforms(to: .plainText) })
        else { throw CocoaError(.fileReadUnknown) }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            _ = provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, error in
                do {
                    guard let url else { throw error ?? CocoaError(.fileReadUnknown) }
                    let info = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                    guard info.isRegularFile == true,
                          let size = info.fileSize,
                          (1...SharedAttachments.maxFileBytes).contains(size)
                    else { throw CocoaError(.fileReadTooLarge) }
                    let suffix = type.preferredFilenameExtension ?? url.pathExtension
                    let name = url.deletingPathExtension().lastPathComponent
                    let destination = folder.appendingPathComponent(name).appendingPathExtension(suffix)
                    try FileManager.default.copyItem(at: url, to: destination)
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}

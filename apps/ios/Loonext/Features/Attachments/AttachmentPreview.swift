import Foundation
import UIKit

/**
 #240 — the bounded preview this phone generates beside the original.

 A note attachment is capped at 25 MB and ten per note (D19 §2.4), and the
 thread re-fetched every one of them on every scroll, for every member of the
 crew, against a fixed 200 GB egress allowance (D34) — and on the tech's own
 mobile data (#289). The image on screen is a few hundred points wide.

 The phone that is uploading is the one place in the system where a resize costs
 nothing: it has just decoded this image to show it in the staging strip. It
 also shrinks the UPLOAD, which is the half of #289 nothing else was going to
 fix — a tech sending five job photos over LTE.

 BEST-EFFORT, ALWAYS. Every failure path returns nil and the original uploads
 alone, which is exactly what happened before this shipped. A corrupt file, a
 format this OS version will not decode, a memory ceiling on a 100-megapixel
 panorama — none of those are worth costing somebody the photo they were trying
 to send from a job site.

 Hand-ported from packages/shared/src/attachment-preview.ts and its Kotlin twin.
 The numbers live in shared so this, the other two clients and the Worker that
 refuses a bad one all agree.
 */
enum AttachmentPreview {

    /// Longest edge of a preview, in pixels. Mirrors PREVIEW_MAX_EDGE.
    static let maxEdge = 1600

    /// JPEG quality, 0...1. Mirrors PREVIEW_JPEG_QUALITY.
    static let jpegQuality: CGFloat = 0.72

    /// Below this an original is already its own preview.
    static let worthItBytes = 512 * 1024

    /// Hard ceiling, whatever the original weighs. The server refuses more.
    static let maxPreviewBytes = 400 * 1024

    /// A preview must be at most this fraction of its original.
    static let maxPreviewFraction = 0.5

    /// The file name a generated preview carries. Cosmetic — the server keys it.
    static let fileName = "preview.jpg"

    /// The image types this product actually stores, from
    /// `packages/shared/src/attachment-types.ts`.
    ///
    /// Enumerated, never a `hasPrefix("image/")` rule: that admitted
    /// image/tiff, image/avif and image/bmp, none of which the bucket accepts.
    /// It also keeps `image/svg+xml` out by absence rather than by its own
    /// line — an SVG is an active document, and so is whatever arrives next
    /// with the same property.
    static let allowedImageTypes: Set<String> = [
        "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
    ]

    /// Is a derivative worth having for this file at all?
    static func worthHaving(_ contentType: String, _ sizeBytes: Int) -> Bool {
        allowedImageTypes.contains(
            contentType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        ) && sizeBytes > worthItBytes
    }

    /**
     The preview's pixel dimensions for an original of `width` x `height`.

     Never scales up, and never rounds an edge to zero — a panorama 8000 x 12
     would otherwise produce a zero-height context, which fails to render.
     */
    static func dimensions(_ width: Int, _ height: Int) -> (width: Int, height: Int) {
        guard width > 0, height > 0 else { return (1, 1) }
        let scale = min(1.0, Double(maxEdge) / Double(max(width, height)))
        return (
            max(1, Int((Double(width) * scale).rounded())),
            max(1, Int((Double(height) * scale).rounded()))
        )
    }

    /**
     Is a generated preview actually worth sending?

     The same two rules the server enforces, asked before the upload. A
     re-encode can genuinely come out bigger than its source — an
     already-optimised small JPEG re-encoded at a fixed quality is the ordinary
     case — and the right answer there is to send the original alone rather than
     earn a 422.
     */
    static func isUseful(_ previewBytes: Int, _ originalBytes: Int) -> Bool {
        previewBytes > 0
            && previewBytes <= maxPreviewBytes
            && Double(previewBytes) <= Double(originalBytes) * maxPreviewFraction
    }

    /**
     A downscaled JPEG of `bytes`, or nil when one is not worth making, not
     possible, or not worth sending.

     `UIGraphicsImageRenderer` rather than Core Image: it is the path that
     honours the image's EXIF orientation for free, and a preview that came out
     sideways would be worse than none at all.
     */
    static func make(contentType: String, bytes: Data) -> Data? {
        guard worthHaving(contentType, bytes.count) else { return nil }
        guard let image = UIImage(data: bytes) else { return nil }

        let size = dimensions(Int(image.size.width), Int(image.size.height))
        let target = CGSize(width: size.width, height: size.height)

        let format = UIGraphicsImageRendererFormat.default()
        // Points, not pixels: the numbers above ARE pixels, and letting the
        // renderer apply the device scale would produce a 3x preview on a
        // modern phone — three times the bytes for a picture nobody zooms.
        format.scale = 1
        format.opaque = true

        let scaled = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        guard let data = scaled.jpegData(compressionQuality: jpegQuality) else { return nil }
        return isUseful(data.count, bytes.count) ? data : nil
    }
}

import SwiftUI
import UIKit

/// #294 — draw on a photo before it goes.
///
/// ## Evaluation
///
/// "An arrow and a circle on a photo beats a paragraph explaining where to look, and
/// takes three seconds instead of thirty." The whole value is in those three seconds,
/// so every decision here is about not spending them.
///
/// ## What binds it
///
/// *Zen of Clarity* — two tools, one colour, one undo. No layers, no freehand, no
/// picker. A drawing app is a different product, and every control here is one more
/// thing to skip past while standing in somebody's kitchen.
///
/// *Smart Defaults* — Arrow is selected on open, because pointing at something is what
/// nine out of ten of these are. The fixed colour is red with a white halo, legible on
/// brick, on rust and on a white bathroom wall — the problem a picker exists to solve,
/// solved without asking.
///
/// *WCAG 2.5.7* — a drag is the fast gesture, and tap-then-tap does the same job for
/// anybody whose hand shakes or whose touch never registers as a drag.
///
/// ## Why it edits the staged copy
///
/// D28 keeps two doors into the system, so an annotated photo must be an ordinary note
/// attachment rather than a new kind of thing. The marks are burned into the bytes and
/// the staged file is replaced. Nothing is destroyed: the original is still in the
/// camera roll, and this copy has not been sent anywhere.
@MainActor
struct PhotoMarkupSheet: View {
    let image: UIImage
    /// JPEG bytes with the marks burned in.
    let onDone: @MainActor (Data) -> Void
    let onCancel: @MainActor () -> Void

    @State private var tool = PhotoMarkup.arrow
    @State private var marks: [PhotoMark] = []
    @State private var dragging: PhotoMark?
    /// WCAG 2.5.7: the first of two taps, when a drag is not available.
    @State private var anchor: CGPoint?
    @State private var canvasSize: CGSize = .zero
    @State private var saving = false

    @Environment(\.appLocale) private var appLocale

    private var pending: [PhotoMark] {
        if let dragging { return [dragging] }
        if let anchor { return [PhotoMark(tool: tool, from: anchor, to: anchor)] }
        return []
    }

    private var preview: UIImage {
        renderMarks(on: image, marks: marks + pending)
    }

    /// Screen point → image pixels. The photo is displayed scaled to fit.
    private func toImage(_ point: CGPoint) -> CGPoint {
        guard canvasSize.width > 0, canvasSize.height > 0 else { return point }
        return CGPoint(
            x: point.x / canvasSize.width * image.size.width,
            y: point.y / canvasSize.height * image.size.height
        )
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 8) {
                Image(uiImage: preview)
                    .resizable()
                    .scaledToFit()
                    .background(
                        GeometryReader { proxy in
                            Color.clear.onAppear { canvasSize = proxy.size }
                                .onChange(of: proxy.size) { _, next in canvasSize = next }
                        }
                    )
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                let start = toImage(value.startLocation)
                                dragging = PhotoMark(
                                    tool: tool,
                                    from: start,
                                    to: toImage(value.location)
                                )
                            }
                            .onEnded { value in
                                let start = toImage(value.startLocation)
                                let end = toImage(value.location)
                                dragging = nil
                                let moved = PhotoMarkup.isDeliberateDrag(
                                    from: start,
                                    to: end,
                                    width: image.size.width,
                                    height: image.size.height
                                )
                                if moved {
                                    marks.append(PhotoMark(tool: tool, from: start, to: end))
                                    anchor = nil
                                    return
                                }
                                // Tapped. First tap anchors, second finishes — the
                                // single-pointer path (WCAG 2.5.7). Nothing is drawn
                                // from a lone tap, so a stray one cannot leave a dot
                                // on a customer's job record.
                                guard let held = anchor else {
                                    anchor = end
                                    return
                                }
                                if PhotoMarkup.isDeliberateDrag(
                                    from: held,
                                    to: end,
                                    width: image.size.width,
                                    height: image.size.height
                                ) {
                                    marks.append(PhotoMark(tool: tool, from: held, to: end))
                                }
                                anchor = nil
                            }
                    )

                HStack(spacing: 8) {
                    ForEach(PhotoMarkup.tools, id: \.self) { option in
                        let on = tool == option
                        Button { tool = option } label: {
                            Text(PhotoMarkup.label(option))
                                .font(.golos(12.5))
                                .foregroundStyle(on ? BrandColor.paper : BrandColor.muted600)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(on ? BrandColor.ink : BrandColor.canvas, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? [.isSelected] : [])
                    }
                    Button(PhotoMarkup.undo) { _ = marks.popLast() }
                        .font(.golos(12.5))
                        .disabled(marks.isEmpty)
                    Spacer(minLength: 0)
                }

                Text(anchor == nil ? PhotoMarkup.hint : PhotoMarkup.hintSecondTap)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted600)
            }
            .padding(16)
            .navigationTitle(AppStrings.translate(appLocale, "thread.markupTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(appLocale, "common.cancel")) {
                        onCancel()
                    }
                    .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(
                        saving
                            ? AppStrings.translate(appLocale, "common.saving")
                            : PhotoMarkup.save
                    ) {
                        saving = true
                        let rendered = preview
                        Task {
                            // Off the main actor: encoding a 12-megapixel photo is
                            // enough work to drop frames while the sheet is up.
                            let data = await Task.detached {
                                // 0.9: the marks must stay crisp, and this is a photo
                                // somebody will look at closely enough to read a
                                // serial number off.
                                rendered.jpegData(compressionQuality: 0.9)
                            }.value
                            saving = false
                            if let data { onDone(data) }
                        }
                    }
                    .disabled(saving || marks.isEmpty)
                }
            }
        }
    }
}

/// The photo with the marks drawn into it.
///
/// Halo first, then ink on top — that order is the whole of the "no colour picker"
/// decision, and it is why one fixed red is legible on any photograph.
@MainActor
func renderMarks(on image: UIImage, marks: [PhotoMark]) -> UIImage {
    guard !marks.isEmpty else { return image }
    let format = UIGraphicsImageRendererFormat()
    // 1: draw in IMAGE pixels, so the marks land where the maths put them rather
    // than at the screen's scale factor.
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
    return renderer.image { context in
        image.draw(in: CGRect(origin: .zero, size: image.size))
        let stroke = PhotoMarkup.strokeWidth(
            width: image.size.width,
            height: image.size.height
        )
        for mark in marks {
            draw(
                mark,
                in: context.cgContext,
                width: stroke * PhotoMarkup.haloScale,
                colour: PhotoMarkup.halo
            )
            draw(mark, in: context.cgContext, width: stroke, colour: PhotoMarkup.ink)
        }
    }
}

private func draw(_ mark: PhotoMark, in ctx: CGContext, width: CGFloat, colour: UInt32) {
    ctx.setStrokeColor(UIColor(hex: colour).cgColor)
    ctx.setLineWidth(width)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)

    if mark.tool == PhotoMarkup.circle {
        ctx.strokeEllipse(in: PhotoMarkup.circleFromDrag(from: mark.from, to: mark.to))
        return
    }

    ctx.move(to: mark.from)
    ctx.addLine(to: mark.to)
    ctx.strokePath()

    let (left, right) = PhotoMarkup.arrowHead(from: mark.from, to: mark.to, stroke: width)
    ctx.move(to: left)
    ctx.addLine(to: mark.to)
    ctx.addLine(to: right)
    ctx.strokePath()
}

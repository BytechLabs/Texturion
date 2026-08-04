import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_PREVIEW_BYTES } from "@loonext/shared";

import { makeAttachmentPreview } from "./preview";
import { buildAttachmentForm } from "./validate";

/**
 * #240 — the browser makes the bounded preview that rides along with the
 * upload.
 *
 * Every path here is best-effort by design: a browser without
 * `createImageBitmap`, a CMYK JPEG the decoder refuses, a canvas that will not
 * give up a blob, a re-encode that came out bigger than its source. All of them
 * return null and the original uploads alone, which is exactly what happened
 * before this shipped. A tech on a job site must never lose a photo because a
 * thumbnail did not work out.
 */

function imageFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

/** Stand in for the decode + canvas stack jsdom does not have. */
function stubCanvas(options: {
  width?: number;
  height?: number;
  blobSize?: number | null;
  decodeThrows?: boolean;
}) {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      if (options.decodeThrows) throw new Error("cannot decode");
      return {
        width: options.width ?? 4000,
        height: options.height ?? 3000,
        close,
      };
    }),
  );
  const drawImage = vi.fn();
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { drawImage };
      }
      async convertToBlob() {
        if (options.blobSize === null) return null;
        return new Blob([new Uint8Array(options.blobSize ?? 150 * 1024)], {
          type: "image/jpeg",
        });
      }
    },
  );
  return { close, drawImage };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("makeAttachmentPreview", () => {
  it("makes one for a big image, scaled to the shared ceiling", async () => {
    const { drawImage, close } = stubCanvas({ width: 4000, height: 3000 });
    const preview = await makeAttachmentPreview(
      imageFile("roof.jpg", "image/jpeg", 8 * 1024 * 1024),
    );
    expect(preview).not.toBeNull();
    expect(preview?.type).toBe("image/jpeg");
    // 4000x3000 → 1600x1200, the shared dimensions rule.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    // The decoded bitmap is tens of megabytes. On a phone browser with four
    // photos staged, not releasing them is the difference between a slow tab
    // and a dead one.
    expect(close).toHaveBeenCalled();
  });

  it("does not even decode a file that does not want one", async () => {
    // A PDF, and a small photo. Decoding either would be work spent to learn
    // something the size and type already said.
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    expect(
      await makeAttachmentPreview(
        imageFile("quote.pdf", "application/pdf", 20 * 1024 * 1024),
      ),
    ).toBeNull();
    expect(
      await makeAttachmentPreview(imageFile("small.jpg", "image/jpeg", 40 * 1024)),
    ).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it("gives up quietly when the browser cannot decode", async () => {
    stubCanvas({ decodeThrows: true });
    expect(
      await makeAttachmentPreview(
        imageFile("cmyk.jpg", "image/jpeg", 8 * 1024 * 1024),
      ),
    ).toBeNull();
  });

  it("gives up quietly on a browser with no createImageBitmap", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    expect(
      await makeAttachmentPreview(
        imageFile("roof.jpg", "image/jpeg", 8 * 1024 * 1024),
      ),
    ).toBeNull();
  });

  it("drops a result the server would refuse", async () => {
    // An already-optimised JPEG re-encoded at a fixed quality can come out
    // bigger than its source. Sending it would earn a 422 on a photo that was
    // perfectly fine — so the client asks the same question first.
    stubCanvas({ blobSize: MAX_PREVIEW_BYTES + 1 });
    expect(
      await makeAttachmentPreview(
        imageFile("roof.jpg", "image/jpeg", 8 * 1024 * 1024),
      ),
    ).toBeNull();

    stubCanvas({ blobSize: 500 * 1024 });
    expect(
      await makeAttachmentPreview(
        imageFile("roof.jpg", "image/jpeg", 600 * 1024),
      ),
    ).toBeNull();
  });

  it("drops an empty encode", async () => {
    stubCanvas({ blobSize: 0 });
    expect(
      await makeAttachmentPreview(
        imageFile("roof.jpg", "image/jpeg", 8 * 1024 * 1024),
      ),
    ).toBeNull();
  });
});

describe("the multipart body", () => {
  it("carries the preview beside the file when there is one", () => {
    const file = imageFile("roof.jpg", "image/jpeg", 1024);
    const preview = imageFile("preview.jpg", "image/jpeg", 128);
    const form = buildAttachmentForm("note", "note-1", file, preview);
    expect(form.get("file")).toBe(file);
    expect(form.get("preview")).toBe(preview);
  });

  it("omits the field entirely when there is none", () => {
    // Not an empty field — the API reads `form.get("preview")` and an empty
    // string would be a zero-byte "preview" it then has to refuse.
    const form = buildAttachmentForm(
      "note",
      "note-1",
      imageFile("roof.jpg", "image/jpeg", 1024),
      null,
    );
    expect(form.has("preview")).toBe(false);
    expect(
      buildAttachmentForm(
        "note",
        "note-1",
        imageFile("roof.jpg", "image/jpeg", 1024),
      ).has("preview"),
    ).toBe(false);
  });
});

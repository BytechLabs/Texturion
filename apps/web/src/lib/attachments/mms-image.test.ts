import { MMS_MAX_MEDIA_BYTES } from "@loonext/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { needsMmsImageResize, prepareMmsImage } from "./preview";

describe(prepareMmsImage, () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each([
    ["job.png", "image/png"],
    ["job.jpeg", "image/jpeg"],
  ])("fits a six-megabyte %s into the MMS limit using the shared resize ladder", async (name, type) => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const encodings: { width: number; height: number; quality?: number }[] = [];
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4096, height: 3072, close })));
    vi.stubGlobal("OffscreenCanvas", class {
      private readonly width: number;
      private readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() { return { fillRect, drawImage }; }
      async convertToBlob({ quality }: ImageEncodeOptions) {
        encodings.push({ width: this.width, height: this.height, quality });
        const size = this.width > 1024 ? MMS_MAX_MEDIA_BYTES + 1 : MMS_MAX_MEDIA_BYTES;
        return new Blob([new Uint8Array(size)], { type: "image/jpeg" });
      }
    });

    const source = new File([new Uint8Array(6 * MMS_MAX_MEDIA_BYTES)], name, { type });
    expect(needsMmsImageResize(source)).toBe(true);
    const result = await prepareMmsImage(source);
    expect(result).toMatchObject({ name: "job.jpg", type: "image/jpeg", size: MMS_MAX_MEDIA_BYTES });
    expect(encodings).toEqual([
      { width: 2048, height: 1536, quality: 0.85 },
      { width: 2048, height: 1536, quality: 0.7 },
      { width: 2048, height: 1536, quality: 0.55 },
      { width: 2048, height: 1536, quality: 0.4 },
      { width: 1024, height: 768, quality: 0.85 },
    ]);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 2048, 1536);
    expect(fillRect.mock.invocationCallOrder[0]).toBeLessThan(drawImage.mock.invocationCallOrder[0]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("leaves oversized GIFs and documents for validation and prepares HEIC", () => {
    const large = new Uint8Array(MMS_MAX_MEDIA_BYTES + 1);
    expect(needsMmsImageResize(new File([large], "animation.gif", { type: "image/gif" }))).toBe(false);
    expect(needsMmsImageResize(new File([large], "quote.pdf", { type: "application/pdf" }))).toBe(false);
    expect(needsMmsImageResize(new File(["photo"], "driveway.heic"))).toBe(true);
  });
});

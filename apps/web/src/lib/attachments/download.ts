import { mmsFileExtension } from "@loonext/shared";

export function attachmentFileName(contentType: string | null): string {
  const extension = mmsFileExtension(contentType);
  return extension ? `attachment.${extension}` : "attachment";
}

export function attachmentDownloadUrl(signedUrl: string, fileName: string): string {
  const url = new URL(signedUrl);
  // Storage uses Content-Disposition for cross-origin downloads.
  url.searchParams.set("download", fileName);
  return url.href;
}

export function downloadAttachment(signedUrl: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = attachmentDownloadUrl(signedUrl, fileName);
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}

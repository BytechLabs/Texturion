/**
 * Clipboard paste classification for the composers (D28 / finding #10).
 *
 * A genuine file paste (a screenshot, a file copied from the OS file manager)
 * carries only the file flavor on the clipboard. An Office copy (Word, Excel,
 * a browser selection) carries BOTH a `text/html` (and usually `text/plain`)
 * flavor AND a synthesized image/file of the rendered selection — pasting that
 * as "files" and calling `preventDefault()` would swallow the text the user
 * actually meant to paste.
 *
 * So: treat a paste as a file paste ONLY when it carries files and no
 * text/html flavor. Pure and DOM-light (reads `types` + `files.length` off a
 * DataTransfer-shaped object) so it unit-tests without a real ClipboardEvent.
 */

/** The minimal DataTransfer surface this predicate reads. */
export interface ClipboardLike {
  types: readonly string[] | DOMStringList;
  files: { length: number };
}

/**
 * True when the paste should be handled as a file attachment (and the default
 * text paste suppressed). False for Office/rich-text copies that merely ride
 * along with a synthesized image — those keep their normal text paste.
 */
export function isFilePaste(data: ClipboardLike | null | undefined): boolean {
  if (!data) return false;
  if (data.files.length === 0) return false;
  const types = Array.from(data.types ?? []);
  // text/html is the tell of a rich-text/Office copy; a real file paste has no
  // HTML flavor. (text/plain alone is not enough — some file managers add it.)
  if (types.includes("text/html")) return false;
  return true;
}

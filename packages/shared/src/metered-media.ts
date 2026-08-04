/**
 * #289 — "download photos on Wi-Fi only, at minimum".
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT AN ON/OFF SWITCH FOR PHOTOS.
 *
 * The obvious reading is "when this is on and I am on mobile data, do not
 * download photos". Building that would make the app look broken on a job site:
 * a thread of grey rectangles is not a thread, and a tech who turned the
 * setting on last month has no idea why today's photos will not load.
 *
 * #240 changed what the choice can be. A thread and a gallery now fetch a
 * bounded PREVIEW — a 1600px JPEG, 150-250 KB — and the ORIGINAL is fetched
 * only when somebody opens a photo full-size or downloads it. Those are two
 * different sizes of decision, and the setting should follow that line rather
 * than cut across it:
 *
 *   - the preview always loads, so the thread reads normally on any connection;
 *   - the original waits for a tap when the phone is on metered data.
 *
 * That is the setting somebody actually wants: "do not spend my data on a 25 MB
 * file I did not ask for". It costs them nothing to leave on, which is the only
 * reason a setting like this survives contact with a real user.
 *
 * ---------------------------------------------------------------------------
 * DEFAULT OFF.
 *
 * #289 says it plainly: "most people will never open the setting, and the ones
 * who do will be very glad it exists". Defaulting it ON would put a tap between
 * every tradesperson and every full-size photo, to solve a problem most of them
 * do not have. The ones who do have it will find it, because they are the ones
 * who go looking.
 */

/** What the device says about the connection it is on. */
export type ConnectionKind =
  /** Wi-Fi, ethernet, or anything the OS does not consider metered. */
  | "unmetered"
  /** Cellular, or a hotspot the OS has been told is metered. */
  | "metered"
  /**
   * The OS would not say.
   *
   * Treated as UNMETERED throughout. A phone that cannot answer is usually a
   * phone without the permission to answer, and the failure we can afford is
   * spending data somebody did not want spent — not a photo that never loads
   * with no way to find out why.
   */
  | "unknown";

export interface MediaFetchInput {
  /** Which of a row's two objects is being asked for (#240). */
  variant: "preview" | "original";
  connection: ConnectionKind;
  /** The device setting, default false. */
  wifiOnlyOriginals: boolean;
  /**
   * Somebody tapped this specific photo.
   *
   * A per-image escape rather than a per-session one: the point of the setting
   * is that data is spent deliberately, and "load this one" is the deliberate
   * act. A blanket "load everything for now" would be the setting turning
   * itself off, quietly, on the surface where it matters most.
   */
  requested: boolean;
}

/** May this fetch go ahead right now? */
export function mayFetchMedia(input: MediaFetchInput): boolean {
  // The preview is the thread. It is always allowed, on any connection, with
  // the setting on or off — see the header for why an all-or-nothing block is
  // the wrong product.
  if (input.variant === "preview") return true;
  if (!input.wifiOnlyOriginals) return true;
  if (input.connection !== "metered") return true;
  return input.requested;
}

/**
 * The sentence shown in place of a full-size photo that is waiting for a tap.
 *
 * Says the CONDITION and the REMEDY in one line, because the alternative — a
 * spinner that never resolves, or a generic "couldn't load" — is how a
 * deliberate setting gets reported as a bug.
 */
export const METERED_ORIGINAL_HINT =
  "You're on mobile data. Tap to load the full-size photo.";

/** The settings row's label and explanation, shared so both phones agree. */
export const WIFI_ONLY_LABEL = "Full-size photos on Wi-Fi only";
export const WIFI_ONLY_DESCRIPTION =
  "Threads and galleries always load. Only full-size photos and downloads " +
  "wait for Wi-Fi — tap one to load it anyway.";

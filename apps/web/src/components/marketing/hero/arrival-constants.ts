/**
 * The Arrival Field's DOM contract, apart from its words. arrival-script.ts
 * reads the home catalogue, so a client module importing these from there
 * ships the whole home page, in both languages, to the browser.
 */

/**
 * The dock event (P5-SPEC §"Coupling to the real DOM"): the sketch dispatches
 * this (bubbling) CustomEvent with `detail: { scriptIndex }` when a particle
 * docks; the hero inbox listens and prepends the matching row.
 */
export const HERO_ARRIVAL_EVENT = "loonext:arrival";

/** The dock target marker: the sketch steers particles toward the element
 *  carrying this attribute (the hero inbox card). */
export const ARRIVAL_DOCK_ATTR = "data-arrival-dock";

/** The inbox shows at most this many rows (P5-SPEC: "cap at 4 rows"). */
export const INBOX_ROW_CAP = 4;

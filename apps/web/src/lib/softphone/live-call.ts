/**
 * Whether this tab is on a phone call right now, readable outside React.
 *
 * The softphone provider owns the calls and keeps this current. Code that
 * would tear the page down on its own schedule (the stale-build reload) reads
 * it first, because reloading the tab hangs up the call it is carrying.
 */
let live = false;

/** True while any browser call in this tab is ringing, connecting, active or held. */
export function hasLiveBrowserCall(): boolean {
  return live;
}

/** Set by the softphone provider whenever its calls change. */
export function setLiveBrowserCall(next: boolean): void {
  live = next;
}

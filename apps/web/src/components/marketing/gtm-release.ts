/**
 * The window property the GTM loader script and <GtmBoot> meet on. The script
 * leaves its download function there; the boot calls it once the page has
 * settled, or leaves "go" if it gets there first. The download leaves "done".
 */
export const GTM_RELEASE = "__loonextGtm";

/**
 * The home usage-meter embed. Previously a byte-identical copy of the /pricing
 * embed (#85 dedup, gap 1) — now a single source: re-exported from the pricing
 * component so the home and /pricing demos can never drift.
 */
export { UsageMeterEmbed } from "../pricing/usage-meter-embed";

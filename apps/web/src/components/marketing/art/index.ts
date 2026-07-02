/**
 * JobText marketing art system (VISUALS §1C/§1D/§2/§4). A cohesive set of inline
 * SVG spot illustrations + data-real infographics sharing ONE visual grammar
 * (grammar.ts: 1.75 stroke, 10px radius, bounded petrol + stone + amber palette),
 * themeable in both light and dark, reduced-motion-aware, zero-network.
 *
 * See docs/marketing/art-inventory.md for each component's intended use.
 */

// Grammar + shells (for authors/consumers building new art or wrapping motion).
export { ArtRoot } from "./art-root";
export { ArtReveal } from "./art-reveal";
export {
  STROKE,
  RADIUS,
  RADIUS_SM,
  ART_VAR,
  ART_VARS,
  ink,
  type ArtProps,
} from "./grammar";

// Spot illustrations (concepts a screenshot can't show).
export { OneNumberManyPeople } from "./spot/one-number-many-people";
export { FieldWorkerTruck } from "./spot/field-worker-truck";
export { CarrierPaperworkShield } from "./spot/carrier-paperwork-shield";
export { CanadaMotif } from "./spot/canada-motif";
export { TextBecomesTask } from "./spot/text-becomes-task";
export { MissedCallToText } from "./spot/missed-call-to-text";

// Infographics (real information, drawn).
export { MissedTextMoney } from "./info/missed-text-money";
export type { MissedTextMoneyProps } from "./info/missed-text-money";
export { FirstWeekTimeline } from "./info/first-week-timeline";
export { HowItWorksFlow } from "./info/how-it-works-flow";
export { CoverageMapNA } from "./info/coverage-map-na";
export { FlatVsPerSeatChart } from "./info/flat-vs-per-seat-chart";

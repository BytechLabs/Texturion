/**
 * #354 — the pipeline the marketing sells, given something to stand on.
 *
 * # The name stops being load-bearing
 *
 * Four tags are seeded into every workspace at creation — "Quote sent",
 * "Scheduled", "Won", "Lost" — and `/for/plumbers` sells the ritual built on
 * them: "tag a conversation 'Quote sent' and it stays visible until someone
 * closes it. Monday morning, open the Quote sent list."
 *
 * #354's worry is that any member can rename one and silently break that for
 * the whole crew. The obvious fix is to protect the name, and it is wrong
 * twice: it turns a deliberately lightweight convention into rigid
 * configuration, which the issue's own devil's advocate warns against, and it
 * does not work anyway, because the crew that wants "Quoted" will rename it and
 * be right to.
 *
 * So the name is not what anything reads. A seeded tag carries a STAGE, a key
 * the product owns, and the saved view, the conversion report and the marketing
 * claim all read the stage. Rename it to "Quoted" to "Estimate out" and nothing
 * breaks, because nothing was ever looking at the name.
 *
 * # What is still worth stopping
 *
 * DELETING a stage tag throws the key away, and with it every conversion that
 * tag ever recorded. That is the one act that needed a gate, and it is the only
 * one that has one.
 */

/** The stages, in the order a job moves through them. */
export const PIPELINE_STAGES = ["quote_sent", "scheduled", "won", "lost"] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export function isPipelineStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

/**
 * The name each stage is SEEDED with.
 *
 * Only ever used at creation and for the one-time backfill. Nothing reads this
 * to find a tag afterwards — that is the whole point of the stage key.
 */
export const PIPELINE_SEED_NAMES: Record<PipelineStage, string> = {
  quote_sent: "Quote sent",
  scheduled: "Scheduled",
  won: "Won",
  lost: "Lost",
};

/**
 * What to tell somebody about to delete one, on every client.
 *
 * Names the consequence rather than forbidding the act. #354 is explicit that a
 * crew should be able to change their stages deliberately; what they should not
 * do is lose their win rate by accident on a Tuesday.
 */
export function pipelineDeleteWarning(stage: PipelineStage): string {
  const label = PIPELINE_SEED_NAMES[stage];
  return (
    `"${label}" is one of the four stages your pipeline report counts. ` +
    `Deleting it removes that tag from every conversation it is on, and those ` +
    `jobs stop counting. Renaming it is safe if you just want it called ` +
    `something else.`
  );
}

/** One period's pipeline, as `api_pipeline_report` returns it. */
export interface PipelineReport {
  /** Conversations first tagged as quoted inside the window. */
  quoted: number;
  won: number;
  lost: number;
  /** Quoted, and neither won nor lost yet. The money still outstanding. */
  open: number;
  /** Median days from quote to win. Null until something has been won. */
  median_days_to_win: number | null;
}

/**
 * Win rate as a percentage, or null when there is nothing to divide.
 *
 * Denominator is DECIDED jobs, not every quote. A quote sent last week that
 * nobody has answered is not a loss, and counting it as one makes a crew's win
 * rate drop every time they do more work — which would make the number worse
 * than useless, because it would punish the behaviour it exists to encourage.
 */
export function pipelineWinRate(report: PipelineReport): number | null {
  const decided = report.won + report.lost;
  if (decided === 0) return null;
  return Math.round((report.won / decided) * 100);
}

/**
 * One sentence an owner can act on, or null when there is not enough to say.
 *
 * #354 asks for the conversion to be "reportable"; a bare percentage on a card
 * is a statistic, and the dashboards rule in the design manual is that a number
 * without an insight beside it is decoration. Deliberately silent below a
 * handful of decided jobs: a 100% win rate off two quotes is noise presented as
 * an achievement, and an owner who acts on it has been misled by us.
 */
export function pipelineInsight(report: PipelineReport): string | null {
  /*
   * #228 — the ENGLISH the wire still sends, and it stays until the app builds
   * that only understand a sentence are gone.
   *
   * `pipelineInsightKeys` below is what a current client reads. This one is
   * kept in step with the catalogue by a test rather than by care: see
   * pipeline.test.ts, which resolves the same keys and asserts the two agree
   * word for word. Same arrangement the payout states got (#339).
   */
  const rate = pipelineWinRate(report);
  const decided = report.won + report.lost;
  if (rate === null || decided < 5) return null;
  if (report.open > 0) {
    return `You win ${rate}% of the quotes that get an answer. ${report.open} ${
      report.open === 1 ? "quote is" : "quotes are"
    } still waiting on one.`;
  }
  return `You win ${rate}% of the quotes that get an answer.`;
}

/** Every catalogue key the insight can name. */
export type PipelineInsightKey =
  | "inbox.pipelineWinRate"
  | "inbox.pipelineWinRateOneOpen"
  | "inbox.pipelineWinRateManyOpen";

/** A key and what to substitute into it — resolved by whoever renders it. */
export interface PipelineInsightMessage {
  key: PipelineInsightKey;
  vars: Record<string, string>;
}

/**
 * The same insight as a KEY, for a client that can translate it.
 *
 * THE SERVER CANNOT RESOLVE THE LANGUAGE ITSELF, which is what forces a key
 * rather than a translated sentence. `profiles.locale` is nullable and its
 * null means "ask the device, then the workspace" — the device half only
 * exists on the client, and no client sends it. A server that translated here
 * would answer in the company's language to somebody whose phone is set to the
 * other one.
 *
 * Null on exactly the same terms as [pipelineInsight]: below five decided jobs
 * there is nothing honest to say, and a 100% win rate off two quotes is noise
 * presented as an achievement.
 *
 * One open quote and many are SEPARATE KEYS. French agrees the noun, the
 * article and the verb with the count, so "quote is"/"quotes are" cannot be a
 * substitution — the card beside this one already splits
 * `pipelineTooEarlyOne`/`Many` for the same reason.
 */
export function pipelineInsightKeys(
  report: PipelineReport,
): PipelineInsightMessage | null {
  const rate = pipelineWinRate(report);
  const decided = report.won + report.lost;
  if (rate === null || decided < 5) return null;
  if (report.open === 0) {
    return { key: "inbox.pipelineWinRate", vars: { rate: String(rate) } };
  }
  return {
    key:
      report.open === 1
        ? "inbox.pipelineWinRateOneOpen"
        : "inbox.pipelineWinRateManyOpen",
    vars: { rate: String(rate), open: String(report.open) },
  };
}

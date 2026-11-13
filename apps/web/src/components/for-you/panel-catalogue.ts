import type { LayoutPanelId, PanelSize } from "@loonext/shared";

import type { MessageKey } from "@/i18n/translate";

/** #736: each panel's heading, the same words as on the panel itself. */
export const PANEL_LABEL_KEYS: Record<LayoutPanelId, MessageKey> = {
  follow_ups: "inbox.forYouSectionChaseThese",
  unassigned: "inbox.forYouSectionUnassigned",
  waiting: "inbox.forYouSectionWaiting",
  tasks: "inbox.forYouSectionTasks",
  unread: "inbox.forYouSectionUnread",
  outstanding_quotes: "quotes.outstandingTitle",
  recent_calls: "domain.panelRecentCalls",
  response_time: "domain.panelResponseTime",
  pipeline: "domain.panelPipeline",
  satisfaction: "domain.panelSatisfaction",
  lead_sources: "domain.panelLeadSources",
};

/** #736: what each panel answers, shown where a member chooses one to add. */
export const PANEL_NOTE_KEYS: Record<LayoutPanelId, MessageKey> = {
  follow_ups: "inbox.forYouPanelNoteFollowUps",
  unassigned: "inbox.forYouPanelNoteUnassigned",
  waiting: "inbox.forYouPanelNoteWaiting",
  tasks: "inbox.forYouPanelNoteTasks",
  unread: "inbox.forYouPanelNoteUnread",
  outstanding_quotes: "inbox.forYouPanelNoteQuotes",
  recent_calls: "domain.panelRecentCallsNote",
  response_time: "domain.panelResponseTimeNote",
  pipeline: "domain.panelPipelineNote",
  satisfaction: "domain.panelSatisfactionNote",
  lead_sources: "domain.panelLeadSourcesNote",
};

export const PANEL_SIZE_KEYS: Record<PanelSize, MessageKey> = {
  third: "inbox.forYouSizeThird",
  two_thirds: "inbox.forYouSizeTwoThirds",
  full: "inbox.forYouSizeFull",
};

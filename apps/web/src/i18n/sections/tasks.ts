/**
 * #228 — the words jobs and scheduled sends says, in both languages.
 *
 * One file per surface so the extraction can run in parallel without every
 * change colliding in one catalogue, and so a translator working through a
 * screen sees its strings adjacent rather than sorted by concept.
 *
 * `fr` is typed as `en`'s exact shape: a key added to one and forgotten in the
 * other fails `tsc`. That is the whole reason this is TypeScript rather than
 * the JSON a library would want — a missing key in a JSON message file is a
 * runtime fallback nobody sees until a French reader does.
 *
 * Grouped by the screen a translator would be looking at, not alphabetically:
 * the shared task vocabulary first (it is the reason "Done" is one word here
 * and three keys — a status pill, a button that marks one done, and a board
 * column of finished ones are three different French words), then each surface.
 */
import type { Translated } from "../translated";

export const tasksEn = {
  // -------------------------------------------------------------------------
  // Shared task vocabulary — read by more than one of the four views.
  // -------------------------------------------------------------------------
  unassigned: "Unassigned",
  teammate: "Teammate",
  aTeammate: "A teammate",
  assignee: "Assignee",
  due: "Due",
  statusOpen: "Open",
  statusDone: "Done",
  overdue: "Overdue",
  /** Read aloud before the date, so overdue is not colour-only (WCAG 1.4.1). */
  overdueSrPrefix: "Overdue: ",
  today: "Today",
  tomorrow: "Tomorrow",
  markDone: "Mark done",
  markNotDone: "Mark not done",
  /** Appended to the signed-in member's own name in a picker. */
  youSuffix: " (you)",
  openConversation: "Open conversation",
  tasksLoadFailed:
    "We couldn't load your tasks. Check your connection and try again.",

  // -------------------------------------------------------------------------
  // The calm empty state.
  // -------------------------------------------------------------------------
  emptyFiltered: "Nothing on this list.",
  /** #718: your own list is empty; the workspace may not be. */
  emptyMine: "Nothing open is assigned to you.",
  emptyMineDone: "You have not finished any tasks yet.",
  emptyMineAny: "No tasks are assigned to you.",
  emptySeeAll: "See all tasks",
  emptyTitle: "No tasks yet.",
  emptyBody:
    "Add one with New task, or promote a message from its ⋯ menu in a " +
    "conversation.",

  // -------------------------------------------------------------------------
  // New task (#689): a task with no text or call behind it.
  // -------------------------------------------------------------------------
  newTask: "New task",
  newTaskDescription: "Only the title is required.",
  newTaskTitleLabel: "What needs doing?",
  newTaskTitlePlaceholder: "Order a furnace filter",
  newTaskMore: "More",
  newTaskDueZone: "Time in {zone}, your workspace's time zone.",
  newTaskDueInvalid: "That time does not exist in the workspace time zone. Pick another.",
  calendarCreateDay: "New task on {date}",
  calendarCreateSlot: "New task on {date} at {time}",
  newTaskNotesLabel: "Notes",
  newTaskFor: "For {name}",
  newTaskInThisConversation: "Linked to this conversation",
  newTaskCreate: "Create task",
  newTaskCreated: "Task created.",
  newTaskFailed: "Couldn't create the task. Try again.",
  newTaskTitleRequired: "Give the task a title.",
  noSourceAria: "Source",
  noSource: "No source",
  noSourceHint: "Created on its own, not from a text or a call.",
  linkedContact: "Contact",
  linkedConversation: "Open the conversation",

  // -------------------------------------------------------------------------
  // The /tasks page and its view switcher.
  // -------------------------------------------------------------------------
  pageTitle: "Tasks",
  viewAria: "Task view",
  viewList: "List",
  viewBoard: "Board",
  viewCalendar: "Calendar",
  viewMap: "Map",

  // -------------------------------------------------------------------------
  // The filter bar: tabs, search, chips, the `+ Filter` popover.
  // -------------------------------------------------------------------------
  statusTabsAria: "Task status",
  tabOpen: "Open",
  tabMine: "Mine",
  tabAll: "All",
  tabDone: "Done",
  searchPlaceholder: "Search tasks",
  searchAria: "Search tasks by title",
  clearSearch: "Clear search",
  /** The chip label when a member has no display name of their own. */
  assigneeChipFallback: "Assignee",
  dueToday: "Due today",
  dueThisWeek: "Due this week",
  removeFilterAria: "Remove {label} filter",
  addFilterAria: "Add filter",
  filter: "Filter",
  filterPlaceholder: "Filter by…",
  noFilters: "No filters.",
  /** A second word somebody might type to find the unassigned filter. */
  keywordNobody: "nobody",

  // -------------------------------------------------------------------------
  // The selection bar over the list (#478).
  // -------------------------------------------------------------------------
  bulkSelectThese: "Select these {count}",
  bulkSelectAllMatching: "Select all matching",
  bulkAssign: "Assign",
  bulkMore: "More",
  bulkVerbMarkedDone: "Marked done",
  bulkVerbMarkedNotDone: "Marked not done",
  bulkVerbAssigned: "Assigned",
  bulkVerbDeleted: "Deleted",
  bulkNounOne: "task",
  bulkNounMany: "tasks",
  bulkFailed: "That didn't go through. Nothing was changed.",

  // -------------------------------------------------------------------------
  // The List view.
  // -------------------------------------------------------------------------
  columnTask: "Task",
  columnStatus: "Status",
  selectRowAria: "Select {title}",
  statusChangeAria: "Status of {title}: {status}. Change status",
  statusChangedDone: "Task marked done",
  statusChangedOpen: "Task reopened",
  loadingMore: "Loading…",
  loadMore: "Load more",

  // -------------------------------------------------------------------------
  // The Board view.
  // -------------------------------------------------------------------------
  boardColumnToDo: "To do",
  boardColumnDone: "Done",
  boardColumnAria: "{title} column, {count} tasks",
  boardNothingDone: "Nothing done yet.",
  boardNothingToDo: "Nothing to do.",
  boardMoveToToDo: "Move to To do",
  boardMoveToDone: "Move to Done",

  // -------------------------------------------------------------------------
  // The Calendar view.
  // -------------------------------------------------------------------------
  calendarPreviousWeek: "Previous week",
  calendarPreviousMonth: "Previous month",
  calendarNextWeek: "Next week",
  calendarNextMonth: "Next month",
  calendarRangeAria: "Calendar range",
  calendarRangeMonth: "Month",
  calendarRangeWeek: "Week",
  dowSun: "Sun",
  dowMon: "Mon",
  dowTue: "Tue",
  dowWed: "Wed",
  dowThu: "Thu",
  dowFri: "Fri",
  dowSat: "Sat",
  calendarLoadFailed:
    "We couldn't load your scheduled tasks. Check your connection and try " +
    "again.",
  /**
   * Three keys because the middle one is emphasised in the markup. Split at the
   * emphasis rather than at a clause, so the French can put "date d'échéance"
   * where French puts it.
   */
  calendarEmptyBefore:
    "No tasks are scheduled in this range. A task appears here once it has a ",
  calendarEmptyDueDate: "due date",
  calendarEmptyAfter:
    ". Set one on a task from its row, the checklist, or its detail drawer, " +
    "then drag it between days to reschedule.",
  rescheduleDayEarlier: "A day earlier",
  rescheduleDayLater: "A day later",
  rescheduleWeekLater: "A week later",
  rescheduleAria: "Reschedule {title}",

  // -------------------------------------------------------------------------
  // The Map view and its lazy Leaflet island.
  // -------------------------------------------------------------------------
  mapGeoUnsupported: "Your browser can't share a location.",
  mapGeoFailed:
    "We couldn't get your location. Check your browser's permission.",
  mapLoadFailed: "We couldn't load the map. Check your connection and try again.",
  mapOnTheMap: "on the map",
  mapWithoutLocation: "without a location",
  /** Reads "Still locating 240 addresses." with the count between the two. */
  mapStillLocating: "Still locating",
  mapAddressOne: "address",
  mapAddressMany: "addresses",
  mapGeocodeBacklogNote:
    "Addresses are looked up a few hundred at a time, so a big import can " +
    "take a few hours to finish plotting.",
  mapLocating: "Locating…",
  mapNearMe: "Near me",
  mapNoMappedAddress: "None of these tasks has an address yet",
  mapUnlocatedOne: "1 task has no address.",
  mapUnlocatedMany: "{count} tasks have no address.",
  mapAddAddressHow:
    "Open a task and add an address, or add one to its contact. It appears here once located.",
  mapYouAreHere: "You are here",
  mapTilesFailing:
    "The street background isn't loading right now. Job pins are still exact, " +
    "and we're looking at it.",
  mapOpenTask: "Open task",
  mapDirections: "Directions",
  mapTasksHere: "{count} tasks here",
  mapMoreZoomIn: "+{count} more, zoom in",
  mapZoomIn: "Zoom in",

  // -------------------------------------------------------------------------
  // The task detail panel — the drawer and the /tasks/[id] route.
  // -------------------------------------------------------------------------
  detailNotFound: "This task doesn't exist or was removed.",
  detailLoadFailed: "We couldn't load this task.",
  titleAria: "Task title",
  actionsAria: "Task actions",
  /** The menu item that marks the task done, as a verb. */
  markDoneAction: "Done",
  /** #689 D: follow a task to hear when it changes. */
  followAria: "Follow this task",
  unfollowAria: "Unfollow this task",
  followedToast: "You'll hear when this task changes.",
  unfollowedToast: "You won't get updates on this task.",
  followFailed: "Couldn't change that. Try again.",
  deleteTask: "Delete task",
  doneNeedsAccessTitle:
    "Marking this done needs access to the conversation it came from",
  accessNoticeAria: "Access notice",
  noAccessNotice:
    "This task is linked to a number you don't have access to. You can see " +
    "the task, but not its messages, files, or discussion — ask an owner or " +
    "admin for access.",
  sourceMessageAria: "Source message",
  fromThisMessage: "From this message",
  /** Stands in for the body of a source message that was only a picture. */
  sourcePhotoOnly: "A photo",
  viewInConversation: "View in conversation",
  /** #718: names where a task came from; shown only when there is a source. */
  linkFromText: "From a text from {name}",
  linkFromTextUnnamed: "From a text",
  linkFromCall: "From a call with {name}",
  linkNote: "Mentioned in a note",
  /** The source section of a task that was promoted from a call (D64). */
  sourceCallAria: "Source call",
  fromThisCall: "From this call",
  /** The name of a call's source: who rang. */
  callFrom: "Call from {name}",
  /** Talk time of the call the task came from, e.g. "Talked for 3m 12s". */
  callTalkTime: "Talked for {duration}",
  clearDue: "Clear",
  remindCustomer: "Remind this customer",
  remindCustomerAria: "Remind this customer about this job",
  remindersOffForJob: "Off for this job. Nothing goes out about it.",
  remindersFromWorkspace: "Uses your workspace reminders.",
  confirmedByCustomer: "They confirmed they'll be there.",
  confirmedByCrew: "Marked confirmed by your crew.",
  description: "Description",
  descriptionPlaceholder: "Add details for your crew…",
  attachments: "Attachments",
  activity: "Activity",
  noActivity: "No activity yet. Post a note below to start a discussion.",
  taskUpdated: "Task updated",
  deleteConfirmTitle: "Delete this task?",
  deleteConfirmBody:
    "This task has {summary}. Deleting it removes the task and its activity " +
    "for everyone. This can't be undone.",
  attachFilesAria: "Attach files to this note",
  notePlaceholder: "Add a note to the discussion…",
  noteAria: "Task discussion note",
  notePost: "Post",
  noteFilesAllFailed:
    "The note posted, but its files didn't upload. Re-attach them from the " +
    "note's Files section in the conversation.",
  noteFilesSomeFailed:
    "The note posted, but {failed} of {total} files didn't upload. Re-attach " +
    "them from the note's Files section in the conversation.",
  address: "Address",
  addrStreet: "Street",
  addrUnit: "Unit / suite",
  addrCity: "City",
  addrState: "State / province",
  addrPostalCode: "Postal code",
  addrCountry: "Country",
  addrFromMessage: "From the message",
  addrFromContact: "From the contact",
  addrFromAreaCode: "Inferred from area code",
  renameFailed: "Couldn't rename this task.",
  descriptionSaveFailed: "Couldn't save the description.",
  reassignFailed: "Couldn't reassign this task.",
  assigneesAria: "Assigned to {names}",
  assigneeMoreChip: "+{count}",
  assigneesNameAndMore: "{name} and {count} more",
  assigneesMax: "A task can have up to {max} people.",
  bulkAssignApply: "Add to tasks",
  bulkAssignHint: "People you pick are added to every selected task. Nobody is taken off.",
  dueChangeFailed: "Couldn't change the due date.",
  dueClearFailed: "Couldn't clear the due date.",
  deleted: "Task deleted.",
  deleteFailed: "Couldn't delete this task.",
  updateFailed: "Couldn't update this task.",
  addressSaveFailed: "Couldn't save the address.",
  notePostFailed: "Couldn't post your note.",

  // -------------------------------------------------------------------------
  // The drawer shell and the standalone /tasks/[id] frame.
  // -------------------------------------------------------------------------
  drawerTitle: "Task details",
  drawerDescription: "Edit the task, review its activity, and add a note.",
  backToTasks: "Back to tasks",

  // -------------------------------------------------------------------------
  // The inline row quick-edits.
  // -------------------------------------------------------------------------
  setDue: "Set due",
  changeDueAria: "Change due date",
  changeDueOverdueAria: "Change due date (overdue)",
  setDueAria: "Set due date",
  dueDateTimeAria: "Due date and time",
  clearDueDate: "Clear due date",

  // -------------------------------------------------------------------------
  // Sharing a job's photos with the customer (#294).
  // -------------------------------------------------------------------------
  shareLinkFailed: "Couldn't make that link. Try again.",
  shareLinkCopied: "Link copied. Paste it into the conversation.",
  shareLinkSelectToCopy: "Select the link and copy it.",
  shareLinkOff: "That link no longer opens.",
  shareLinkOffFailed: "Couldn't turn that link off. Try again.",
  shareMakingLink: "Making a link…",
  sharePhotos: "Share these photos",
  shareExpiryNote: "Anyone with this link can see the photos until {when}.",
  shareCopied: "Copied",
  shareCopy: "Copy",
  shareTurningOff: "Turning it off…",
  shareTurnOff: "Turn this link off",

  // -------------------------------------------------------------------------
  // Taking the work away as a file (#304).
  // -------------------------------------------------------------------------
  exportOutstanding: "Export outstanding work",
  exportFinished: "Export finished work",
  exportAll: "Export all work",
  exportNote:
    "A file of this work for your records. It covers the whole workspace, not " +
    "just your own jobs, and it is put together in the background.",
  exportAlreadyBuilding:
    "One is already being put together. It will appear in Settings › Data " +
    "export.",
  exportStarted:
    "Being put together now. It will appear in Settings › Data export.",
  exportFailed: "That could not be started.",
  exportList: "Export this list",
  exportListNote:
    "Downloads a spreadsheet of the tasks in this view, with the filters you have set.",
  exportDownloadFailed: "The export could not be downloaded. Try again.",

  // -------------------------------------------------------------------------
  // What the write paths say when they roll back.
  // -------------------------------------------------------------------------
  doneNeedsAccessToast:
    "Marking this done needs access to the conversation it came from.",
  moveFailed: "Couldn't move that task. Try again.",
  rescheduleFailed: "Couldn't reschedule that task. Try again.",
  remindersOffToast:
    "Reminders off for this job. Anything queued has been cancelled.",
  remindersOnToast: "Reminders back on for this job.",
  remindersChangeFailed: "Couldn't change that. Try again.",

  // -------------------------------------------------------------------------
  // What a task carries, named in the delete confirmation (#89).
  // -------------------------------------------------------------------------
  deleteSummaryANote: "a note",
  deleteSummaryNotes: "{count} notes",
  deleteSummaryAFile: "a file",
  deleteSummaryFiles: "{count} files",
  deleteSummaryAnd: "{first} and {second}",

  // -------------------------------------------------------------------------
  // The task_* activity sentences (shared with the thread's system lines).
  // -------------------------------------------------------------------------
  eventCreated: "{by} turned this into a task",
  eventUnassigned: "{by} unassigned this task",
  eventAssigned: "{by} assigned this to {name}",
  eventReassigned: "{by} reassigned this task",
  eventDueCleared: "{by} cleared the due date",
  eventDueSet: "{by} set the due date to {due}",
  eventDeleted: "{by} removed this task",
  eventAttachmentAdded: "{by} attached a file",
  eventAttachmentRemoved: "{by} removed a file",
  /** The due instant inside `eventDueSet`, when it falls on the current day. */
  eventDueToday: "today {time}",

  // -------------------------------------------------------------------------
  // A task's own history and comments (#689).
  // -------------------------------------------------------------------------
  histCreated: "{by} created this task",
  histTitle: "{by} renamed this task to {title}",
  histDescription: "{by} changed the notes",
  histAddress: "{by} changed the address",
  histAddressCleared: "{by} cleared the address",
  histAssigned: "{by} assigned this to {name}",
  histUnassigned: "{by} unassigned this task",
  histReassigned: "{by} reassigned this task",
  histAssigneeAdded: "{by} added {name} to this task",
  histAssigneeRemoved: "{by} removed {name} from this task",
  histDue: "{by} changed the due time to {due}",
  histDueCleared: "{by} cleared the due time",
  histRemindersOff: "{by} turned reminders off",
  histRemindersOn: "{by} turned reminders on",
  histConfirmed: "{by} confirmed this job",
  histConfirmationCleared: "{by} cleared the confirmation",
  histDone: "{by} marked this done",
  histReopened: "{by} reopened this task",
  histDeleted: "{by} removed this task",
  histUpdated: "{by} updated this task",
  commentPlaceholder: "Write a comment…",
  commentAria: "Comment on this task",
  commentPost: "Comment",
  commentPostFailed: "Couldn't post your comment. Try again.",
  commentFilesAllFailed: "Your comment posted, but its files didn't upload.",
  commentFilesSomeFailed:
    "Your comment posted, but {failed} of {total} files didn't upload.",
  commentEdited: "edited",
  commentEdit: "Edit",
  commentDelete: "Delete",
  commentSave: "Save",
  commentActionsAria: "Comment actions",
  commentSaveFailed: "Couldn't save your change.",
  commentDeleteFailed: "Couldn't delete the comment.",
  activityEmpty: "Nothing yet. Add a comment below.",
  activityEarlier: "Show earlier",
  activityLoadFailed: "Couldn't load the activity.",

  // -------------------------------------------------------------------------
  // /scheduled — everything the workspace has queued (#233).
  // -------------------------------------------------------------------------
  scheduledTitle: "Scheduled",
  scheduledOneWaiting: "1 text waiting",
  scheduledManyWaiting: "{count} texts waiting",
  scheduledLoadFailed: "Couldn't load what's scheduled.",
  scheduledLoadFailedHint: "Check your connection and try again.",
  scheduledNeedsYou: "Needs you",
  scheduledGoingOut: "Going out",
  scheduledWaiting: "Waiting",
  // #693 priority, labels and repeating tasks.
  priority: "Priority",
  priorityUrgent: "Urgent",
  priorityHigh: "High",
  priorityNormal: "Normal",
  priorityLow: "Low",
  priorityNone: "None",
  priorityMany: "Priority · {count}",
  setPriority: "Set priority",
  sortHeading: "Sort",
  sortCreated: "Newest",
  sortDue: "Due date",
  sortPriority: "Priority",
  sortedBy: "Sort: {sort}",
  labels: "Tags",
  label: "Tag",
  addLabel: "Add tag",
  addOrCreateLabel: "Add or create a tag",
  createLabelNamed: "Create “{name}”",
  noLabels: "None",
  noLabelsYet: "No tags yet. Type a name below to make the first.",
  labelMore: "+{count}",
  labelRemoveAria: "Remove tag {name}",
  labelAddFailed: "Couldn't add that tag. Try again.",
  labelRemoveFailed: "Couldn't remove that tag. Try again.",
  bulkSetPriority: "Set priority",
  bulkVerbUpdated: "Updated",
  repeat: "Repeat",
  repeats: "Repeats",
  repeatNone: "Never",
  repeatDays: "Days",
  repeatAfterDone: "Repeats {count} {unit} after it's done",
  repeatApply: "Apply",
  repeatEnded: "Repeat ended",
  repeatEnds: "Ends",
  repeatEndsAfter: "After a number of times",
  repeatEndsNever: "Never",
  repeatEndsOn: "On a date",
  repeatEvery1: "Repeats every {unit}",
  repeatEveryN: "Repeats every {count} {unit}",
  repeatEveryLabel: "Every",
  repeatEveryMin: "Every must be at least 1.",
  repeatKindAfterDone: "After it's done",
  repeatKindAfterDoneHint: "The next one is made once you mark this done, counted from that day.",
  repeatKindSchedule: "On a schedule",
  repeatKindScheduleHint: "Fixed dates on the calendar, counted from the due date.",
  repeatMonthDay: "Repeats on day {date} of every month",
  repeatMonthDayEvery: "Repeats on day {date} every {count} months",
  repeatNeedsDue: "A schedule needs a due date. Set one first, or choose After it's done.",
  repeatNeedsEndDate: "Pick an end date.",
  repeatNoYearly: "After it's done can't repeat yearly.",
  repeatNthMonthly: "Repeats on the {nth} {day} of every month",
  repeatNthMonthlyEvery: "Repeats on the {nth} {day} every {count} months",
  repeatOnDay: "On day {date}",
  repeatOnNth: "On the {nth} {day}",
  repeatPause: "Pause",
  repeatResume: "Resume",
  repeatPausedTag: "Paused",
  repeatPickEndDate: "Set end date",
  repeatStop: "Stop repeating",
  repeatTimes: "{count} times",
  repeatTimesLabel: "times",
  repeatUntil: "until {date}",
  repeatWeekdays: "Repeats every {days}",
  repeatWeekdaysEvery: "Repeats every {count} weeks on {days}",
  repeatSaveFailed: "Couldn't save that repeat. Try again.",
  nthFirst: "first",
  nthSecond: "second",
  nthThird: "third",
  nthFourth: "fourth",
  nthLast: "last",
  scopeBody: "This task repeats. Which ones should this apply to?",
  scopeTitle: "Repeating task",
  scopeThis: "This one",
  scopeFuture: "This and future",
  deleteScopeTitle: "Delete a repeating task",
  deleteScopeThis: "Delete this one",
  deleteScopeFuture: "Delete this and future",
  histLabelAdded: "{by} added the tag {name}",
  histLabelRemoved: "{by} removed the tag {name}",
  histPriority: "{by} set the priority to {priority}",
  histRepeat: "{by} set this to repeat: {rule}",
  histRepeatCleared: "{by} stopped this repeating",
  unitDay1: "day",
  unitDayN: "days",
  unitWeek1: "week",
  unitWeekN: "weeks",
  unitMonth1: "month",
  unitMonthN: "months",
  unitYear1: "year",
  unitYearN: "years",

  // #690 / #689 A, G: task numbers, references, links, views, quick add.
  refPickTitle: "Link to…",
  refPickDescription: "Pick a task, a customer or a conversation to refer to.",
  refSearch: "Search tasks, customers, conversations",
  refSearchTasks: "Search tasks by number or title",
  refLoading: "Searching…",
  refNothing: "Nothing found.",
  refTasks: "Tasks",
  refContacts: "Customers",
  refConversations: "Conversations",
  aCustomer: "a customer",
  refInNote: "{by} referred to this in a note on the conversation with {customer}",
  refInTask: "{by} referred to this from {task}",
  refInComment: "{by} referred to this in a comment",
  refOutContact: "Linked to customer {customer}",
  refOutConversation: "Linked to the conversation with {customer}",
  refOutTask: "Linked to {task}",
  customer: "Customer",
  createdBy: "Made by",
  createdByMe: "Me",
  chipCreatedBy: "Made by {name}",
  source: "Source",
  sourceText: "A text",
  sourceCall: "A call",
  sourceNone: "Neither",
  chipSource: "From {source}",
  carries: "Carries",
  hasFiles: "Has files",
  hasLinks: "Referenced",
  dueRange: "Due range",
  dueFrom: "Due from",
  dueTo: "Due until",
  chipDueRange: "Due {from} to {to}",
  chipDueFrom: "Due from {date}",
  chipDueUntil: "Due until {date}",
  groupHeading: "Group the board",
  groupStatus: "Status",
  groupAssignee: "Person",
  groupPriority: "Priority",
  chipGroupedBy: "Grouped by {group}",
  sortUpdated: "Recently changed",
  views: "Views",
  viewsAria: "Saved views",
  viewsNone: "No saved views yet.",
  viewDelete: "Delete “{name}”",
  viewSaveDescription: "Keeps the filters, the sort and the board grouping you have on screen.",
  viewShareNote: "Everyone in the workspace sees it in their Views menu.",
  links: "Links",
  linksAria: "Linked tasks",
  linkAdd: "Add link",
  linkAddAria: "Add a link to another task",
  linksEmpty: "Not linked to any other task.",
  linkRemoveAria: "Remove link to {task}",
  linkFailed: "Could not change that link. Try again in a moment.",
  relBlockedBy: "Blocked by",
  relBlocks: "Blocks",
  relParent: "Part of",
  relSubTask: "Sub-tasks",
  histAddBlockedBy: "{by} marked this as blocked by {task}",
  histAddBlocks: "{by} marked this as blocking {task}",
  histAddParent: "{by} made this part of {task}",
  histAddSubTask: "{by} added {task} as a sub-task",
  histRemoveBlockedBy: "{by} removed the block by {task}",
  histRemoveBlocks: "{by} stopped this blocking {task}",
  histRemoveParent: "{by} took this out of {task}",
  histRemoveSubTask: "{by} removed sub-task {task}",
  linkedTasks: "Linked tasks",
  linkedTasksEmpty: "No tasks linked yet.",
  linkedHowMentioned: "Mentioned in a note",
  linkedHowPointsAt: "Refers to this",
  quickAdd: "Quick add",
  quickAddPlaceholder: "Fix furnace @rehman tomorrow 9am #urgent",
  quickAddHint: "Write it the way you would say it. Days and times are read in English: tomorrow 9am, friday, in 2 days.",
  quickAddAria: "Describe the task in one line",
  quickUnderstood: "What I understood",
  quickNothing: "Just a title so far.",
  quickTitle: "Title",
  quickAssignee: "Assigned to",
  quickDue: "Due",
  quickPriority: "Priority",
  quickLabels: "Tags",
  quickStays: "{words} stays in the title",
  quickNeedsTitle: "Add a title to save.",
  quickAdd_confirm: "Add task",
  quickMore: "More options",
} as const;

/**
 * Quebec French, vouvoiement throughout — the product speaks to the crew the
 * way a business speaks to a professional. Accents are spelled normally: the
 * GSM-7 restriction in packages/shared/src/locale.ts governs SMS bodies, which
 * are billed by the segment, and nothing on a web page is.
 *
 * A task is `une tâche`, so its adjectives are feminine throughout — "Ouverte",
 * "Terminée", "Non assignée". The board columns are plural because they name a
 * pile of them.
 */
export const tasksFr: Translated<typeof tasksEn> = {
  // -------------------------------------------------------------------------
  // Shared task vocabulary.
  // -------------------------------------------------------------------------
  unassigned: "Non assignée",
  teammate: "Collègue",
  aTeammate: "Un collègue",
  assignee: "Responsable",
  due: "Échéance",
  statusOpen: "Ouverte",
  statusDone: "Terminée",
  overdue: "En retard",
  overdueSrPrefix: "En retard : ",
  today: "Aujourd'hui",
  tomorrow: "Demain",
  markDone: "Marquer comme terminée",
  markNotDone: "Marquer comme non terminée",
  youSuffix: " (vous)",
  openConversation: "Ouvrir la conversation",
  tasksLoadFailed:
    "Impossible de charger vos tâches. Vérifiez votre connexion et réessayez.",

  // -------------------------------------------------------------------------
  // La liste vide.
  // -------------------------------------------------------------------------
  emptyFiltered: "Rien dans cette liste.",
  emptyMine: "Aucune tâche ouverte ne vous est assignée.",
  emptyMineDone: "Vous n'avez encore terminé aucune tâche.",
  emptyMineAny: "Aucune tâche ne vous est assignée.",
  emptySeeAll: "Voir toutes les tâches",
  emptyTitle: "Aucune tâche pour le moment.",
  emptyBody:
    "Ajoutez-en une avec Nouvelle tâche, ou promouvez un message depuis son " +
    "menu ⋯ dans une conversation.",

  // -------------------------------------------------------------------------
  // Nouvelle tâche (#689) : une tâche sans texto ni appel derrière.
  // -------------------------------------------------------------------------
  newTask: "Nouvelle tâche",
  newTaskDescription: "Seul le titre est obligatoire.",
  newTaskTitleLabel: "Que faut-il faire ?",
  newTaskTitlePlaceholder: "Commander un filtre de fournaise",
  newTaskMore: "Plus",
  newTaskDueZone: "Heure de {zone}, le fuseau horaire de votre espace de travail.",
  newTaskDueInvalid: "Cette heure n'existe pas dans le fuseau horaire de l'espace de travail. Choisissez-en une autre.",
  calendarCreateDay: "Nouvelle tâche le {date}",
  calendarCreateSlot: "Nouvelle tâche le {date} à {time}",
  newTaskNotesLabel: "Notes",
  newTaskFor: "Pour {name}",
  newTaskInThisConversation: "Liée à cette conversation",
  newTaskCreate: "Créer la tâche",
  newTaskCreated: "Tâche créée.",
  newTaskFailed: "Impossible de créer la tâche. Réessayez.",
  newTaskTitleRequired: "Donnez un titre à la tâche.",
  noSourceAria: "Origine",
  noSource: "Aucune origine",
  noSourceHint: "Créée seule, sans texto ni appel.",
  linkedContact: "Contact",
  linkedConversation: "Ouvrir la conversation",

  // -------------------------------------------------------------------------
  // La page /tasks et son sélecteur de vue.
  // -------------------------------------------------------------------------
  pageTitle: "Tâches",
  viewAria: "Vue des tâches",
  viewList: "Liste",
  viewBoard: "Tableau",
  viewCalendar: "Calendrier",
  viewMap: "Carte",

  // -------------------------------------------------------------------------
  // La barre de filtres.
  // -------------------------------------------------------------------------
  statusTabsAria: "Statut des tâches",
  tabOpen: "Ouvertes",
  tabMine: "Les miennes",
  tabAll: "Toutes",
  tabDone: "Terminées",
  searchPlaceholder: "Rechercher des tâches",
  searchAria: "Rechercher des tâches par titre",
  clearSearch: "Effacer la recherche",
  assigneeChipFallback: "Responsable",
  dueToday: "Échéance aujourd'hui",
  dueThisWeek: "Échéance cette semaine",
  removeFilterAria: "Retirer le filtre {label}",
  addFilterAria: "Ajouter un filtre",
  filter: "Filtrer",
  filterPlaceholder: "Filtrer par…",
  noFilters: "Aucun filtre.",
  keywordNobody: "personne",

  // -------------------------------------------------------------------------
  // La barre de sélection.
  // -------------------------------------------------------------------------
  bulkSelectThese: "Sélectionner ces {count}",
  bulkSelectAllMatching: "Sélectionner tout ce qui correspond",
  bulkAssign: "Assigner",
  bulkMore: "Plus",
  bulkVerbMarkedDone: "Marquées comme terminées",
  bulkVerbMarkedNotDone: "Marquées comme non terminées",
  bulkVerbAssigned: "Assignées",
  bulkVerbDeleted: "Supprimées",
  bulkNounOne: "tâche",
  bulkNounMany: "tâches",
  bulkFailed: "L'opération n'a pas abouti. Rien n'a été modifié.",

  // -------------------------------------------------------------------------
  // La vue Liste.
  // -------------------------------------------------------------------------
  columnTask: "Tâche",
  columnStatus: "Statut",
  selectRowAria: "Sélectionner {title}",
  statusChangeAria: "Statut de {title} : {status}. Changer le statut",
  statusChangedDone: "Tâche marquée comme terminée",
  statusChangedOpen: "Tâche rouverte",
  loadingMore: "Chargement…",
  loadMore: "Afficher plus",

  // -------------------------------------------------------------------------
  // La vue Tableau.
  // -------------------------------------------------------------------------
  boardColumnToDo: "À faire",
  boardColumnDone: "Terminées",
  boardColumnAria: "Colonne {title}, {count} tâches",
  boardNothingDone: "Rien de terminé pour le moment.",
  boardNothingToDo: "Rien à faire.",
  boardMoveToToDo: "Déplacer vers À faire",
  boardMoveToDone: "Déplacer vers Terminées",

  // -------------------------------------------------------------------------
  // La vue Calendrier.
  // -------------------------------------------------------------------------
  calendarPreviousWeek: "Semaine précédente",
  calendarPreviousMonth: "Mois précédent",
  calendarNextWeek: "Semaine suivante",
  calendarNextMonth: "Mois suivant",
  calendarRangeAria: "Période du calendrier",
  calendarRangeMonth: "Mois",
  calendarRangeWeek: "Semaine",
  dowSun: "dim",
  dowMon: "lun",
  dowTue: "mar",
  dowWed: "mer",
  dowThu: "jeu",
  dowFri: "ven",
  dowSat: "sam",
  calendarLoadFailed:
    "Impossible de charger vos tâches planifiées. Vérifiez votre connexion et " +
    "réessayez.",
  calendarEmptyBefore:
    "Aucune tâche n'est planifiée dans cette période. Une tâche apparaît ici " +
    "dès qu'elle a une ",
  calendarEmptyDueDate: "date d'échéance",
  calendarEmptyAfter:
    ". Ajoutez-en une depuis la ligne de la tâche, la liste de la conversation " +
    "ou son panneau de détails, puis faites-la glisser d'un jour à l'autre " +
    "pour la replanifier.",
  rescheduleDayEarlier: "Un jour plus tôt",
  rescheduleDayLater: "Un jour plus tard",
  rescheduleWeekLater: "Une semaine plus tard",
  rescheduleAria: "Replanifier {title}",

  // -------------------------------------------------------------------------
  // La vue Carte.
  // -------------------------------------------------------------------------
  mapGeoUnsupported: "Votre navigateur ne peut pas partager de position.",
  mapGeoFailed:
    "Impossible d'obtenir votre position. Vérifiez l'autorisation de votre " +
    "navigateur.",
  mapLoadFailed:
    "Impossible de charger la carte. Vérifiez votre connexion et réessayez.",
  mapOnTheMap: "sur la carte",
  mapWithoutLocation: "sans emplacement",
  mapStillLocating: "Localisation de",
  mapAddressOne: "adresse",
  mapAddressMany: "adresses",
  mapGeocodeBacklogNote:
    "Les adresses sont recherchées par quelques centaines à la fois, alors " +
    "une grande importation peut prendre quelques heures avant d'être " +
    "entièrement affichée.",
  mapLocating: "Localisation…",
  mapNearMe: "Près de moi",
  mapNoMappedAddress: "Aucune de ces tâches n'a encore d'adresse",
  mapUnlocatedOne: "1 tâche n'a pas d'adresse.",
  mapUnlocatedMany: "{count} tâches n'ont pas d'adresse.",
  mapAddAddressHow:
    "Ouvrez une tâche et ajoutez-lui une adresse, ou ajoutez-en une à son client. Elle apparaît ici une fois localisée.",
  mapYouAreHere: "Vous êtes ici",
  mapTilesFailing:
    "Le fond de carte ne se charge pas en ce moment. Les repères des tâches " +
    "restent exacts et nous examinons la situation.",
  mapOpenTask: "Ouvrir la tâche",
  mapDirections: "Itinéraire",
  mapTasksHere: "{count} tâches ici",
  mapMoreZoomIn: "+{count} autres, zoomer",
  mapZoomIn: "Zoomer",

  // -------------------------------------------------------------------------
  // Le panneau de détails.
  // -------------------------------------------------------------------------
  detailNotFound: "Cette tâche n'existe pas ou a été supprimée.",
  detailLoadFailed: "Impossible de charger cette tâche.",
  titleAria: "Titre de la tâche",
  actionsAria: "Actions de la tâche",
  markDoneAction: "Terminer",
  followAria: "Suivre cette tâche",
  unfollowAria: "Ne plus suivre cette tâche",
  followedToast: "Vous saurez quand cette tâche change.",
  unfollowedToast: "Vous ne recevrez plus de mises à jour sur cette tâche.",
  followFailed: "Impossible de modifier. Réessayez.",
  deleteTask: "Supprimer la tâche",
  doneNeedsAccessTitle:
    "Marquer cette tâche comme terminée exige l'accès à la conversation " +
    "d'origine",
  accessNoticeAria: "Avis d'accès",
  noAccessNotice:
    "Cette tâche est liée à un numéro auquel vous n'avez pas accès. Vous " +
    "voyez la tâche, mais pas ses messages, ses fichiers ni sa discussion — " +
    "demandez l'accès à un propriétaire ou à un administrateur.",
  sourceMessageAria: "Message d'origine",
  fromThisMessage: "À partir de ce message",
  sourcePhotoOnly: "Une photo",
  viewInConversation: "Voir dans la conversation",
  linkFromText: "À partir d'un texto de {name}",
  linkFromTextUnnamed: "À partir d'un texto",
  linkFromCall: "À partir d'un appel avec {name}",
  linkNote: "Mentionnée dans une note",
  sourceCallAria: "Appel d'origine",
  fromThisCall: "À partir de cet appel",
  callFrom: "Appel de {name}",
  callTalkTime: "Appel de {duration}",
  clearDue: "Effacer",
  remindCustomer: "Rappeler au client",
  remindCustomerAria: "Rappeler cette tâche au client",
  remindersOffForJob:
    "Désactivés pour cette tâche. Rien ne sera envoyé à son sujet.",
  remindersFromWorkspace: "Utilise les rappels de votre espace de travail.",
  confirmedByCustomer: "Le client a confirmé sa présence.",
  confirmedByCrew: "Confirmée par votre équipe.",
  description: "Description",
  descriptionPlaceholder: "Ajoutez des détails pour votre équipe…",
  attachments: "Pièces jointes",
  activity: "Activité",
  noActivity:
    "Aucune activité pour le moment. Publiez une note ci-dessous pour lancer " +
    "une discussion.",
  taskUpdated: "Tâche mise à jour",
  deleteConfirmTitle: "Supprimer cette tâche ?",
  deleteConfirmBody:
    "Cette tâche contient {summary}. La supprimer retire la tâche et son " +
    "activité pour tout le monde. Cette action est irréversible.",
  attachFilesAria: "Joindre des fichiers à cette note",
  notePlaceholder: "Ajoutez une note à la discussion…",
  noteAria: "Note de discussion de la tâche",
  notePost: "Publier",
  noteFilesAllFailed:
    "La note a été publiée, mais ses fichiers n'ont pas été téléversés. " +
    "Rattachez-les depuis la section Fichiers de la note dans la conversation.",
  noteFilesSomeFailed:
    "La note a été publiée, mais {failed} fichiers sur {total} n'ont pas été " +
    "téléversés. Rattachez-les depuis la section Fichiers de la note dans la " +
    "conversation.",
  address: "Adresse",
  addrStreet: "Rue",
  addrUnit: "Unité / bureau",
  addrCity: "Ville",
  addrState: "État / province",
  addrPostalCode: "Code postal",
  addrCountry: "Pays",
  addrFromMessage: "D'après le message",
  addrFromContact: "D'après le client",
  addrFromAreaCode: "Déduite de l'indicatif régional",
  renameFailed: "Impossible de renommer cette tâche.",
  descriptionSaveFailed: "Impossible d'enregistrer la description.",
  reassignFailed: "Impossible de réassigner cette tâche.",
  assigneesAria: "Assignée à {names}",
  assigneeMoreChip: "+{count}",
  assigneesNameAndMore: "{name} et {count} de plus",
  assigneesMax: "Une tâche peut avoir jusqu'à {max} personnes.",
  bulkAssignApply: "Ajouter aux tâches",
  bulkAssignHint: "Les personnes choisies sont ajoutées à chaque tâche sélectionnée. Personne n'est retiré.",
  dueChangeFailed: "Impossible de modifier la date d'échéance.",
  dueClearFailed: "Impossible d'effacer la date d'échéance.",
  deleted: "Tâche supprimée.",
  deleteFailed: "Impossible de supprimer cette tâche.",
  updateFailed: "Impossible de mettre à jour cette tâche.",
  addressSaveFailed: "Impossible d'enregistrer l'adresse.",
  notePostFailed: "Impossible de publier votre note.",

  // -------------------------------------------------------------------------
  // Le tiroir et la page autonome.
  // -------------------------------------------------------------------------
  drawerTitle: "Détails de la tâche",
  drawerDescription:
    "Modifiez la tâche, consultez son activité et ajoutez une note.",
  backToTasks: "Retour aux tâches",

  // -------------------------------------------------------------------------
  // Les modifications rapides sur une ligne.
  // -------------------------------------------------------------------------
  setDue: "Définir l'échéance",
  changeDueAria: "Modifier la date d'échéance",
  changeDueOverdueAria: "Modifier la date d'échéance (en retard)",
  setDueAria: "Définir la date d'échéance",
  dueDateTimeAria: "Date et heure d'échéance",
  clearDueDate: "Effacer la date d'échéance",

  // -------------------------------------------------------------------------
  // Partager les photos d'une tâche.
  // -------------------------------------------------------------------------
  shareLinkFailed: "Impossible de créer ce lien. Réessayez.",
  shareLinkCopied: "Lien copié. Collez-le dans la conversation.",
  shareLinkSelectToCopy: "Sélectionnez le lien et copiez-le.",
  shareLinkOff: "Ce lien ne s'ouvre plus.",
  shareLinkOffFailed: "Impossible de désactiver ce lien. Réessayez.",
  shareMakingLink: "Création du lien…",
  sharePhotos: "Partager ces photos",
  shareExpiryNote:
    "Toute personne possédant ce lien peut voir les photos jusqu'au {when}.",
  shareCopied: "Copié",
  shareCopy: "Copier",
  shareTurningOff: "Désactivation…",
  shareTurnOff: "Désactiver ce lien",

  // -------------------------------------------------------------------------
  // Exporter le travail.
  // -------------------------------------------------------------------------
  exportOutstanding: "Exporter le travail en cours",
  exportFinished: "Exporter le travail terminé",
  exportAll: "Exporter tout le travail",
  exportNote:
    "Un fichier de ce travail pour vos dossiers. Il couvre tout l'espace de " +
    "travail, pas seulement vos propres tâches, et il est préparé en " +
    "arrière-plan.",
  exportAlreadyBuilding:
    "Un export est déjà en préparation. Il apparaîtra dans Paramètres › " +
    "Exportation des données.",
  exportStarted:
    "En cours de préparation. Il apparaîtra dans Paramètres › Exportation des " +
    "données.",
  exportFailed: "Impossible de démarrer l'opération.",
  exportList: "Exporter cette liste",
  exportListNote:
    "Télécharge un tableur des tâches de cette vue, avec les filtres que vous avez réglés.",
  exportDownloadFailed: "L'export n'a pas pu être téléchargé. Réessayez.",

  // -------------------------------------------------------------------------
  // Ce que disent les écritures quand elles reculent.
  // -------------------------------------------------------------------------
  doneNeedsAccessToast:
    "Marquer cette tâche comme terminée exige l'accès à la conversation " +
    "d'origine.",
  moveFailed: "Impossible de déplacer cette tâche. Réessayez.",
  rescheduleFailed: "Impossible de replanifier cette tâche. Réessayez.",
  remindersOffToast:
    "Rappels désactivés pour cette tâche. Tout ce qui était en file d'attente " +
    "a été annulé.",
  remindersOnToast: "Rappels réactivés pour cette tâche.",
  remindersChangeFailed: "Impossible de modifier cela. Réessayez.",

  // -------------------------------------------------------------------------
  // Ce que porte une tâche, nommé dans la confirmation de suppression.
  // -------------------------------------------------------------------------
  deleteSummaryANote: "une note",
  deleteSummaryNotes: "{count} notes",
  deleteSummaryAFile: "un fichier",
  deleteSummaryFiles: "{count} fichiers",
  deleteSummaryAnd: "{first} et {second}",

  // -------------------------------------------------------------------------
  // Les phrases d'activité task_*.
  // -------------------------------------------------------------------------
  eventCreated: "{by} a transformé ceci en tâche",
  eventUnassigned: "{by} a retiré l'assignation de cette tâche",
  eventAssigned: "{by} a assigné ceci à {name}",
  eventReassigned: "{by} a réassigné cette tâche",
  eventDueCleared: "{by} a effacé la date d'échéance",
  eventDueSet: "{by} a fixé la date d'échéance au {due}",
  eventDeleted: "{by} a supprimé cette tâche",
  eventAttachmentAdded: "{by} a joint un fichier",
  eventAttachmentRemoved: "{by} a retiré un fichier",
  eventDueToday: "aujourd'hui {time}",

  // -------------------------------------------------------------------------
  // L'historique et les commentaires d'une tâche (#689).
  // -------------------------------------------------------------------------
  histCreated: "{by} a créé cette tâche",
  histTitle: "{by} a renommé cette tâche en {title}",
  histDescription: "{by} a modifié les notes",
  histAddress: "{by} a modifié l'adresse",
  histAddressCleared: "{by} a effacé l'adresse",
  histAssigned: "{by} a assigné ceci à {name}",
  histUnassigned: "{by} a retiré l'assignation de cette tâche",
  histReassigned: "{by} a réassigné cette tâche",
  histAssigneeAdded: "{by} a ajouté {name} à cette tâche",
  histAssigneeRemoved: "{by} a retiré {name} de cette tâche",
  histDue: "{by} a changé l'heure d'échéance pour {due}",
  histDueCleared: "{by} a effacé l'heure d'échéance",
  histRemindersOff: "{by} a désactivé les rappels",
  histRemindersOn: "{by} a activé les rappels",
  histConfirmed: "{by} a confirmé ce travail",
  histConfirmationCleared: "{by} a effacé la confirmation",
  histDone: "{by} a marqué ceci comme terminé",
  histReopened: "{by} a rouvert cette tâche",
  histDeleted: "{by} a supprimé cette tâche",
  histUpdated: "{by} a modifié cette tâche",
  commentPlaceholder: "Écrivez un commentaire…",
  commentAria: "Commenter cette tâche",
  commentPost: "Commenter",
  commentPostFailed: "Impossible de publier votre commentaire. Réessayez.",
  commentFilesAllFailed:
    "Votre commentaire est publié, mais ses fichiers n'ont pas été téléversés.",
  commentFilesSomeFailed:
    "Votre commentaire est publié, mais {failed} fichiers sur {total} n'ont pas été téléversés.",
  commentEdited: "modifié",
  commentEdit: "Modifier",
  commentDelete: "Supprimer",
  commentSave: "Enregistrer",
  commentActionsAria: "Actions du commentaire",
  commentSaveFailed: "Impossible d'enregistrer votre modification.",
  commentDeleteFailed: "Impossible de supprimer le commentaire.",
  activityEmpty: "Rien pour l'instant. Ajoutez un commentaire ci-dessous.",
  activityEarlier: "Afficher les plus anciens",
  activityLoadFailed: "Impossible de charger l'activité.",

  // -------------------------------------------------------------------------
  // /scheduled — tout ce que l'espace de travail a mis en file.
  // -------------------------------------------------------------------------
  scheduledTitle: "Planifiés",
  scheduledOneWaiting: "1 texto en attente",
  scheduledManyWaiting: "{count} textos en attente",
  scheduledLoadFailed: "Impossible de charger ce qui est planifié.",
  scheduledLoadFailedHint: "Vérifiez votre connexion et réessayez.",
  scheduledNeedsYou: "Nécessite votre attention",
  scheduledGoingOut: "À envoyer",
  scheduledWaiting: "En attente",
  // #693 priority, labels and repeating tasks.
  priority: "Priorité",
  priorityUrgent: "Urgente",
  priorityHigh: "Élevée",
  priorityNormal: "Normale",
  priorityLow: "Basse",
  priorityNone: "Aucune",
  priorityMany: "Priorité · {count}",
  setPriority: "Définir la priorité",
  sortHeading: "Trier",
  sortCreated: "Plus récentes",
  sortDue: "Échéance",
  sortPriority: "Priorité",
  sortedBy: "Tri : {sort}",
  labels: "Étiquettes",
  label: "Étiquette",
  addLabel: "Ajouter une étiquette",
  addOrCreateLabel: "Ajouter ou créer une étiquette",
  createLabelNamed: "Créer « {name} »",
  noLabels: "Aucune",
  noLabelsYet: "Aucune étiquette pour l'instant. Écrivez un nom ci-dessous pour créer la première.",
  labelMore: "+{count}",
  labelRemoveAria: "Retirer l'étiquette {name}",
  labelAddFailed: "Impossible d'ajouter cette étiquette. Réessayez.",
  labelRemoveFailed: "Impossible de retirer cette étiquette. Réessayez.",
  bulkSetPriority: "Définir la priorité",
  bulkVerbUpdated: "Mises à jour",
  repeat: "Répéter",
  repeats: "Se répète",
  repeatNone: "Jamais",
  repeatDays: "Jours",
  repeatAfterDone: "Se répète {count} {unit} après avoir été terminée",
  repeatApply: "Appliquer",
  repeatEnded: "Récurrence terminée",
  repeatEnds: "Fin",
  repeatEndsAfter: "Après un nombre de fois",
  repeatEndsNever: "Jamais",
  repeatEndsOn: "À une date",
  repeatEvery1: "Se répète chaque {unit}",
  repeatEveryN: "Se répète aux {count} {unit}",
  repeatEveryLabel: "Intervalle",
  repeatEveryMin: "Le nombre doit être d'au moins 1.",
  repeatKindAfterDone: "Après sa fin",
  repeatKindAfterDoneHint: "La suivante est créée une fois celle-ci terminée, en comptant à partir de ce jour-là.",
  repeatKindSchedule: "Selon un horaire",
  repeatKindScheduleHint: "Des dates fixes au calendrier, à partir de l'échéance.",
  repeatMonthDay: "Se répète le {date} de chaque mois",
  repeatMonthDayEvery: "Se répète le {date} aux {count} mois",
  repeatNeedsDue: "Un horaire exige une échéance. Fixez-en une d'abord, ou choisissez « Après sa fin ».",
  repeatNeedsEndDate: "Choisissez une date de fin.",
  repeatNoYearly: "« Après sa fin » ne peut pas se répéter chaque année.",
  repeatNthMonthly: "Se répète le {nth} {day} de chaque mois",
  repeatNthMonthlyEvery: "Se répète le {nth} {day} aux {count} mois",
  repeatOnDay: "Le {date}",
  repeatOnNth: "Le {nth} {day}",
  repeatPause: "Mettre en pause",
  repeatResume: "Reprendre",
  repeatPausedTag: "En pause",
  repeatPickEndDate: "Fixer la date de fin",
  repeatStop: "Arrêter la récurrence",
  repeatTimes: "{count} fois",
  repeatTimesLabel: "fois",
  repeatUntil: "jusqu'au {date}",
  repeatWeekdays: "Se répète chaque {days}",
  repeatWeekdaysEvery: "Se répète aux {count} semaines, {days}",
  repeatSaveFailed: "Impossible d'enregistrer cette récurrence. Réessayez.",
  nthFirst: "premier",
  nthSecond: "deuxième",
  nthThird: "troisième",
  nthFourth: "quatrième",
  nthLast: "dernier",
  scopeBody: "Cette tâche se répète. À lesquelles cela s'applique-t-il ?",
  scopeTitle: "Tâche récurrente",
  scopeThis: "Celle-ci seulement",
  scopeFuture: "Celle-ci et les suivantes",
  deleteScopeTitle: "Supprimer une tâche récurrente",
  deleteScopeThis: "Supprimer celle-ci",
  deleteScopeFuture: "Supprimer celle-ci et les suivantes",
  histLabelAdded: "{by} a ajouté l'étiquette {name}",
  histLabelRemoved: "{by} a retiré l'étiquette {name}",
  histPriority: "{by} a réglé la priorité à {priority}",
  histRepeat: "{by} a rendu cette tâche récurrente : {rule}",
  histRepeatCleared: "{by} a arrêté la récurrence de cette tâche",
  unitDay1: "jour",
  unitDayN: "jours",
  unitWeek1: "semaine",
  unitWeekN: "semaines",
  unitMonth1: "mois",
  unitMonthN: "mois",
  unitYear1: "an",
  unitYearN: "ans",

  // #690 / #689 A, G: task numbers, references, links, views, quick add.
  refPickTitle: "Lier à…",
  refPickDescription: "Choisissez une tâche, un client ou une conversation.",
  refSearch: "Chercher tâches, clients, conversations",
  refSearchTasks: "Chercher une tâche par numéro ou titre",
  refLoading: "Recherche…",
  refNothing: "Aucun résultat.",
  refTasks: "Tâches",
  refContacts: "Clients",
  refConversations: "Conversations",
  aCustomer: "un client",
  refInNote: "{by} y a fait référence dans une note de la conversation avec {customer}",
  refInTask: "{by} y a fait référence depuis {task}",
  refInComment: "{by} y a fait référence dans un commentaire",
  refOutContact: "Lié au client {customer}",
  refOutConversation: "Lié à la conversation avec {customer}",
  refOutTask: "Lié à {task}",
  customer: "Client",
  createdBy: "Créée par",
  createdByMe: "Moi",
  chipCreatedBy: "Créée par {name}",
  source: "Origine",
  sourceText: "Un texto",
  sourceCall: "Un appel",
  sourceNone: "Aucune",
  chipSource: "Origine : {source}",
  carries: "Contient",
  hasFiles: "Avec fichiers",
  hasLinks: "Référencée",
  dueRange: "Période d'échéance",
  dueFrom: "Échéance du",
  dueTo: "Échéance jusqu'au",
  chipDueRange: "Échéance du {from} au {to}",
  chipDueFrom: "Échéance dès le {date}",
  chipDueUntil: "Échéance jusqu'au {date}",
  groupHeading: "Grouper le tableau",
  groupStatus: "Statut",
  groupAssignee: "Personne",
  groupPriority: "Priorité",
  chipGroupedBy: "Groupé par {group}",
  sortUpdated: "Modifiées récemment",
  views: "Vues",
  viewsAria: "Vues enregistrées",
  viewsNone: "Aucune vue enregistrée.",
  viewDelete: "Supprimer « {name} »",
  viewSaveDescription: "Garde les filtres, le tri et le groupement du tableau affichés.",
  viewShareNote: "Tout le monde dans l'espace de travail la voit dans son menu Vues.",
  links: "Liens",
  linksAria: "Tâches liées",
  linkAdd: "Ajouter un lien",
  linkAddAria: "Lier à une autre tâche",
  linksEmpty: "Aucun lien avec une autre tâche.",
  linkRemoveAria: "Retirer le lien avec {task}",
  linkFailed: "Impossible de modifier ce lien. Réessayez dans un moment.",
  relBlockedBy: "Bloquée par",
  relBlocks: "Bloque",
  relParent: "Fait partie de",
  relSubTask: "Sous-tâches",
  histAddBlockedBy: "{by} a indiqué que cette tâche est bloquée par {task}",
  histAddBlocks: "{by} a indiqué que cette tâche bloque {task}",
  histAddParent: "{by} a rattaché cette tâche à {task}",
  histAddSubTask: "{by} a ajouté {task} comme sous-tâche",
  histRemoveBlockedBy: "{by} a retiré le blocage par {task}",
  histRemoveBlocks: "{by} a retiré le blocage de {task}",
  histRemoveParent: "{by} a détaché cette tâche de {task}",
  histRemoveSubTask: "{by} a retiré la sous-tâche {task}",
  linkedTasks: "Tâches liées",
  linkedTasksEmpty: "Aucune tâche liée.",
  linkedHowMentioned: "Mentionnée dans une note",
  linkedHowPointsAt: "Y fait référence",
  quickAdd: "Ajout rapide",
  quickAddPlaceholder: "Fix furnace @rehman tomorrow 9am #urgent",
  quickAddHint: "Écrivez-le comme vous le diriez. Les jours et heures se lisent en anglais : tomorrow 9am, friday, in 2 days.",
  quickAddAria: "Décrivez la tâche en une ligne",
  quickUnderstood: "Ce que j'ai compris",
  quickNothing: "Seulement un titre pour l'instant.",
  quickTitle: "Titre",
  quickAssignee: "Assignée à",
  quickDue: "Échéance",
  quickPriority: "Priorité",
  quickLabels: "Étiquettes",
  quickStays: "{words} reste dans le titre",
  quickNeedsTitle: "Ajoutez un titre pour enregistrer.",
  quickAdd_confirm: "Ajouter la tâche",
  quickMore: "Plus d'options",
};

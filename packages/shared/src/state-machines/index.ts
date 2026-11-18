/**
 * #722 phase 1: every lifecycle in the product as data. See docs/STATE-MACHINES.md.
 *
 * Nothing at runtime imports these yet; the tests in this folder prove each
 * definition against the migrations and against production data.
 */
import { callMachine } from "./call";
import { callLegMachine } from "./call-leg";
import { scheduledMessageMachine } from "./scheduled-message";
import { calendarConnectionMachine } from "./calendar-connection";
import { calendarOutboxMachine } from "./calendar-outbox";
import { calendarReminderReplanMachine } from "./calendar-reminder-replan";
import { calendarLinkMachine } from "./calendar-link";
import { calendarPushSubscriptionMachine } from "./calendar-push-subscription";
import { webhookDeliveryMachine } from "./webhook-delivery";
import { subscriptionMachine } from "./subscription";
import { conversationMachine } from "./conversation";
import { conversationVisibilityMachine } from "./conversation-visibility";
import { messageMachine } from "./message";
import { registrationMachine } from "./registration";
import { numberHealthMachine } from "./number-health";
import { paymentRequestMachine } from "./payment-request";
import { phoneNumberMachine } from "./phone-number";
import { portMachine } from "./port";
import { portMessagingMachine } from "./port-messaging";
import { quoteMachine } from "./quote";
import { textEnablementMachine } from "./text-enablement";
import { dataExportMachine } from "./data-export";
import { consentMachine } from "./consent";
import { geocodeMachine } from "./geocode";
import { billingDisputeMachine } from "./billing-dispute";
import { taskMachine } from "./task";
import { inviteMachine } from "./invite";
import { workspaceMachine } from "./workspace";

export {
  allowedActions,
  canTransition,
  capabilityActions,
  defineMachine,
  entryEffectsFor,
  isTerminalState,
  nextStates,
  type Authority,
  type Machine,
  type MachineDb,
  type MachineDefinition,
} from "./define-machine";

export { callMachine, type CallState } from "./call";
export { callLegMachine, type CallLegState } from "./call-leg";
export { scheduledMessageMachine, type ScheduledMessageState } from "./scheduled-message";
export { calendarConnectionMachine, type CalendarConnectionState } from "./calendar-connection";
export { calendarOutboxMachine, type CalendarOutboxState } from "./calendar-outbox";
export { calendarReminderReplanMachine, type CalendarReminderReplanState } from "./calendar-reminder-replan";
export { calendarLinkMachine, type CalendarLinkState } from "./calendar-link";
export { calendarPushSubscriptionMachine, type CalendarPushSubscriptionState } from "./calendar-push-subscription";
export { webhookDeliveryMachine, type WebhookDeliveryState } from "./webhook-delivery";
export { subscriptionMachine, type SubscriptionState } from "./subscription";
export { conversationMachine, type ConversationState } from "./conversation";
export { conversationVisibilityMachine, type ConversationVisibilityState } from "./conversation-visibility";
export { messageMachine, type MessageState } from "./message";
export { registrationMachine, type RegistrationState } from "./registration";
export { numberHealthMachine, type NumberHealthState } from "./number-health";
export { paymentRequestMachine, type PaymentRequestState } from "./payment-request";
export { phoneNumberMachine, type PhoneNumberState } from "./phone-number";
export { portMachine, type PortState } from "./port";
export { portMessagingMachine, type PortMessagingState } from "./port-messaging";
export { quoteMachine, type QuoteState } from "./quote";
export { textEnablementMachine, type TextEnablementState } from "./text-enablement";
export { dataExportMachine, type DataExportState } from "./data-export";
export { consentMachine, type ConsentState } from "./consent";
export { geocodeMachine, type GeocodeState } from "./geocode";
export { billingDisputeMachine, type BillingDisputeState } from "./billing-dispute";
export { taskMachine, type TaskState } from "./task";
export { inviteMachine, type InviteState } from "./invite";
export { workspaceMachine, workspaceState, type WorkspaceState } from "./workspace";

/** Every machine, for tests and for anything that needs to enumerate them. */
export const ALL_MACHINES = [
  callMachine,
  callLegMachine,
  scheduledMessageMachine,
  calendarConnectionMachine,
  calendarOutboxMachine,
  calendarReminderReplanMachine,
  calendarLinkMachine,
  calendarPushSubscriptionMachine,
  webhookDeliveryMachine,
  subscriptionMachine,
  conversationMachine,
  conversationVisibilityMachine,
  messageMachine,
  registrationMachine,
  numberHealthMachine,
  paymentRequestMachine,
  phoneNumberMachine,
  portMachine,
  portMessagingMachine,
  quoteMachine,
  textEnablementMachine,
  dataExportMachine,
  consentMachine,
  geocodeMachine,
  billingDisputeMachine,
  taskMachine,
  inviteMachine,
  workspaceMachine,
] as const;

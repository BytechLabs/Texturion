/**
 * #722 phase 1: every lifecycle in the product as data. See docs/STATE-MACHINES.md.
 *
 * Nothing at runtime imports these yet; the tests in this folder prove each
 * definition against the migrations and against production data.
 */
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

import { callMachine } from "./call";
export { callMachine, type CallState } from "./call";
import { callLegMachine } from "./call-leg";
export { callLegMachine, type CallLegState } from "./call-leg";
import { scheduledMessageMachine } from "./scheduled-message";
export { scheduledMessageMachine, type ScheduledMessageState } from "./scheduled-message";
import { calendarConnectionMachine } from "./calendar-connection";
export { calendarConnectionMachine, type CalendarConnectionState } from "./calendar-connection";
import { calendarOutboxMachine } from "./calendar-outbox";
export { calendarOutboxMachine, type CalendarOutboxState } from "./calendar-outbox";
import { calendarReminderReplanMachine } from "./calendar-reminder-replan";
export { calendarReminderReplanMachine, type CalendarReminderReplanState } from "./calendar-reminder-replan";
import { calendarLinkMachine } from "./calendar-link";
export { calendarLinkMachine, type CalendarLinkState } from "./calendar-link";
import { calendarPushSubscriptionMachine } from "./calendar-push-subscription";
export { calendarPushSubscriptionMachine, type CalendarPushSubscriptionState } from "./calendar-push-subscription";
import { webhookDeliveryMachine } from "./webhook-delivery";
export { webhookDeliveryMachine, type WebhookDeliveryState } from "./webhook-delivery";
import { subscriptionMachine } from "./subscription";
export { subscriptionMachine, type SubscriptionState } from "./subscription";
import { conversationMachine } from "./conversation";
export { conversationMachine, type ConversationState } from "./conversation";
import { conversationVisibilityMachine } from "./conversation-visibility";
export { conversationVisibilityMachine, type ConversationVisibilityState } from "./conversation-visibility";
import { messageMachine } from "./message";
export { messageMachine, type MessageState } from "./message";
import { registrationMachine } from "./registration";
export { registrationMachine, type RegistrationState } from "./registration";
import { numberHealthMachine } from "./number-health";
export { numberHealthMachine, type NumberHealthState } from "./number-health";
import { paymentRequestMachine } from "./payment-request";
export { paymentRequestMachine, type PaymentRequestState } from "./payment-request";
import { phoneNumberMachine } from "./phone-number";
export { phoneNumberMachine, type PhoneNumberState } from "./phone-number";
import { portMachine } from "./port";
export { portMachine, type PortState } from "./port";
import { portMessagingMachine } from "./port-messaging";
export { portMessagingMachine, type PortMessagingState } from "./port-messaging";
import { quoteMachine } from "./quote";
export { quoteMachine, type QuoteState } from "./quote";
import { textEnablementMachine } from "./text-enablement";
export { textEnablementMachine, type TextEnablementState } from "./text-enablement";
import { dataExportMachine } from "./data-export";
export { dataExportMachine, type DataExportState } from "./data-export";
import { consentMachine } from "./consent";
export { consentMachine, type ConsentState } from "./consent";
import { geocodeMachine } from "./geocode";
export { geocodeMachine, type GeocodeState } from "./geocode";
import { billingDisputeMachine } from "./billing-dispute";
export { billingDisputeMachine, type BillingDisputeState } from "./billing-dispute";
import { taskMachine } from "./task";
export { taskMachine, type TaskState } from "./task";
import { inviteMachine } from "./invite";
export { inviteMachine, type InviteState } from "./invite";
import { workspaceMachine } from "./workspace";
export { workspaceMachine, type WorkspaceState } from "./workspace";

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

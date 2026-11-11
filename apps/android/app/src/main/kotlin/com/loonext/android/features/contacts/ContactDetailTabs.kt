package com.loonext.android.features.contacts

import com.loonext.android.core.model.Contact

/**
 * #740: what the contact screen shows at a time. A phone has room for one
 * thing, so the screen is a header and actions, then a segmented control
 * switching Details, Activity and Files. Conversations, Calls and Tasks are one
 * tap inside Activity, beside the timeline. The web twin is
 * `apps/web/src/components/contacts/contact-tabs.ts`.
 */
internal enum class ContactTab(val labelKey: String) {
    Details("contactsTasks.tabDetails"),
    Activity("contactsTasks.tabActivity"),
    Files("contactsTasks.tabFiles"),
}

/** The lists inside the Activity tab. */
internal enum class ContactActivityPane(val labelKey: String) {
    Timeline("contactsTasks.tabTimeline"),
    Conversations("contactsTasks.tabConversations"),
    Calls("contactsTasks.tabCalls"),
    Tasks("contactsTasks.tabTasks"),
}

/** Every block the screen can draw under the controls. */
internal enum class ContactBlock { Details, Timeline, Conversations, Calls, Tasks, Files }

/** The one block a tab (and, under Activity, a pane) puts on screen. */
internal fun blockOnScreen(tab: ContactTab, pane: ContactActivityPane): ContactBlock = when (tab) {
    ContactTab.Details -> ContactBlock.Details
    ContactTab.Files -> ContactBlock.Files
    ContactTab.Activity -> when (pane) {
        ContactActivityPane.Timeline -> ContactBlock.Timeline
        ContactActivityPane.Conversations -> ContactBlock.Conversations
        ContactActivityPane.Calls -> ContactBlock.Calls
        ContactActivityPane.Tasks -> ContactBlock.Tasks
    }
}

/** The detail fields that can be empty, and so sit behind "Add details". */
internal enum class ContactDetailField { Business, Address, Email, Notes }

/**
 * The fields nobody has filled in. The name and the numbers always show, since
 * they are what the record is.
 */
internal fun emptyDetailFields(contact: Contact): List<ContactDetailField> = buildList {
    if (contact.business_name.isNullOrBlank()) add(ContactDetailField.Business)
    if (contact.address.isNullOrBlank() && contact.addresses.isEmpty()) {
        add(ContactDetailField.Address)
    }
    if (contact.email.isNullOrBlank()) add(ContactDetailField.Email)
    if (contact.notes.isNullOrBlank()) add(ContactDetailField.Notes)
}

/**
 * The fields still folded away. A field is decided empty when the screen opens,
 * so clearing the one you are typing in does not make it vanish; one that
 * somebody else fills in meanwhile appears; "Add details" opens them all.
 */
internal fun hiddenDetailFields(
    initiallyEmpty: List<ContactDetailField>,
    emptyNow: List<ContactDetailField>,
    adding: Boolean,
): Set<ContactDetailField> =
    if (adding) emptySet() else initiallyEmpty.filter { it in emptyNow }.toSet()

/** Rows a list shows before "Show all". */
internal const val CONTACT_LIST_CAP = 5

/** The first [CONTACT_LIST_CAP] rows, or all of them once "Show all" is tapped. */
internal fun <T> cappedRows(rows: List<T>, showAll: Boolean): List<T> =
    if (showAll) rows else rows.take(CONTACT_LIST_CAP)

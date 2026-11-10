package com.loonext.android.features.thread

/** A row of the conversation sheet's action cards (#710). */
internal enum class ConversationMenuItem {
    ASSIGN,
    PINNED,
    NEW_TASK,
    SNOOZE,
    MUTE,
    FOLLOW,
    ATTACHMENTS,
    SPAM,
    BLOCK,
    DELETE,
    OPT_OUT,
}

/**
 * #710: the sheet's action cards, in the order the web menu uses. Everyday
 * actions, then deferral, then alerts, then the gallery, with the destructive
 * ones last in a card of their own. Delete comes before Opt out, never in the
 * middle. Each inner list is one card, so a card break is the divider.
 */
internal fun conversationMenuGroups(canDelete: Boolean): List<List<ConversationMenuItem>> = listOf(
    listOf(ConversationMenuItem.ASSIGN, ConversationMenuItem.PINNED, ConversationMenuItem.NEW_TASK),
    listOf(ConversationMenuItem.SNOOZE),
    listOf(ConversationMenuItem.MUTE, ConversationMenuItem.FOLLOW),
    listOf(ConversationMenuItem.ATTACHMENTS),
    listOfNotNull(
        ConversationMenuItem.SPAM,
        ConversationMenuItem.BLOCK,
        ConversationMenuItem.DELETE.takeIf { canDelete },
        ConversationMenuItem.OPT_OUT,
    ),
)

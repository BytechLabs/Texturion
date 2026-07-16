package com.loonext.android.features.shell

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Me
import com.loonext.android.features.contacts.ContactsTab
import com.loonext.android.features.foryou.ForYouTab
import com.loonext.android.features.inbox.InboxTab
import com.loonext.android.features.tasks.TasksTab
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.initialsOf

enum class ShellTab(val label: String) {
    ForYou("For you"),
    Inbox("Inbox"),
    Tasks("Tasks"),
    Contacts("Contacts"),
    You("You"),
}

/**
 * The mobile shell: 5-cell labeled bottom tab bar (For you · Inbox · Tasks ·
 * Contacts · You-avatar) + the single app-wide compose FAB (#100/G11).
 */
@Composable
fun MainShell(
    me: Me,
    counts: ShellCounts,
    tab: ShellTab,
    onTabChange: (ShellTab) -> Unit,
    onCompose: () -> Unit,
    onOpenAccountSheet: () -> Unit,
    content: @Composable (ShellTab, Modifier) -> Unit,
) {
    Scaffold(
        bottomBar = {
            NavigationBar {
                ShellTab.entries.forEach { item ->
                    NavigationBarItem(
                        selected = tab == item,
                        onClick = {
                            if (item == ShellTab.You) onOpenAccountSheet() else onTabChange(item)
                        },
                        icon = {
                            when (item) {
                                ShellTab.ForYou -> CountBadge(counts.forYou) {
                                    Icon(Icons.Filled.Bolt, contentDescription = null)
                                }

                                ShellTab.Inbox -> CountBadge(counts.unreadConversations) {
                                    Icon(Icons.Filled.Inbox, contentDescription = null)
                                }

                                ShellTab.Tasks -> CountBadge(counts.openTasks) {
                                    Icon(Icons.Filled.Checklist, contentDescription = null)
                                }

                                ShellTab.Contacts ->
                                    Icon(Icons.Filled.People, contentDescription = null)

                                ShellTab.You -> CountBadge(
                                    if (counts.unreadNotifications > 0) -1 else 0,
                                ) {
                                    InitialsAvatar(
                                        me.display_name.ifBlank { null },
                                        size = 26.dp,
                                    )
                                }
                            }
                        },
                        label = { Text(item.label) },
                    )
                }
            }
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onCompose) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "New message")
            }
        },
    ) { padding ->
        content(tab, Modifier.padding(padding))
    }
}

/** Live nav counts (accent-rationed: quiet numerals capped at 9+). */
data class ShellCounts(
    val forYou: Int = 0,
    val unreadConversations: Int = 0,
    val openTasks: Int = 0,
    val unreadNotifications: Int = 0,
)

/** count > 0 = numeral badge capped 9+; count < 0 = plain dot; 0 = none. */
@Composable
private fun CountBadge(count: Int, content: @Composable () -> Unit) {
    if (count == 0) {
        content()
        return
    }
    BadgedBox(
        badge = {
            if (count < 0) Badge()
            else Badge { Text(if (count > 9) "9+" else count.toString()) }
        },
    ) { content() }
}

/** Routes the active tab to its feature entry. */
@Composable
fun ShellContent(
    tab: ShellTab,
    graph: AppGraph,
    me: Me,
    companyId: String,
    modifier: Modifier = Modifier,
    onOpenThread: (conversationId: String) -> Unit,
    onComposeNew: (prefillContactId: String?) -> Unit,
) {
    when (tab) {
        ShellTab.ForYou -> ForYouTab(graph, companyId, me, modifier)
        ShellTab.Inbox -> InboxTab(graph, companyId, me, modifier)
        ShellTab.Tasks -> TasksTab(
            graph, companyId, me, modifier,
            onOpenConversation = { conversationId, _ -> onOpenThread(conversationId) },
        )

        ShellTab.Contacts -> ContactsTab(
            graph, companyId, modifier,
            me = me,
            onOpenConversation = onOpenThread,
            onComposeNew = { contactId -> onComposeNew(contactId) },
        )

        ShellTab.You -> Unit // handled by the account sheet
    }
}

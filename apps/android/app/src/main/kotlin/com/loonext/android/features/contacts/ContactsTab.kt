package com.loonext.android.features.contacts

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Contact
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.delay

/** Contacts list with debounced name/phone search + opted-out badges. */
@Composable
fun ContactsTab(graph: AppGraph, companyId: String, modifier: Modifier = Modifier) {
    var query by rememberSaveable { mutableStateOf("") }
    var state by remember(companyId) {
        mutableStateOf<LoadState<List<Contact>>>(LoadState.Loading)
    }
    var refreshKey by remember { mutableStateOf(0) }

    LaunchedEffect(companyId, query, refreshKey) {
        if (query.isNotEmpty()) delay(250) // debounce typing
        state = try {
            LoadState.Ready(
                graph.contactsRepo.contacts(
                    companyId,
                    q = query.trim().ifEmpty { null },
                ).data,
            )
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }

    Column(modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("Search name or number") },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
        )
        when (val current = state) {
            is LoadState.Loading -> CenteredLoading()
            is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ })
            is LoadState.Ready -> {
                if (current.value.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            if (query.isBlank()) "No contacts yet."
                            else "No matches for \"$query\".",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    LazyColumn(Modifier.fillMaxSize()) {
                        items(current.value, key = { it.id }) { contact ->
                            ContactRow(contact)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ContactRow(contact: Contact) {
    val name = contact.name ?: formatPhone(contact.phone_e164)
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialsAvatar(name)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.bodyLarge)
            Text(
                formatPhone(contact.phone_e164),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            contact.last_activity_at?.let {
                Text(
                    relativeTime(it),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (contact.opted_out) {
                SuggestionChip(onClick = {}, label = { Text("Opted out") })
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

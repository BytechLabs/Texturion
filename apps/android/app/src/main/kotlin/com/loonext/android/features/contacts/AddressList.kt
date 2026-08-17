package com.loonext.android.features.contacts

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ContactAddress

/**
 * #291 — the other places this customer is.
 *
 * Design notes, and the principles behind them:
 *
 * - **It is absent until it has something to say.** Most contacts have one
 *   address, which the row above already holds; an empty "other addresses"
 *   list on every record would be a permanent question mark to serve the
 *   property manager with forty. *Applying: Zen of Clarity, and Prioritize
 *   Intent — complexity expands with the user's intent, not ahead of it.*
 * - **The primary one is NAMED, not just first.** "Which address" is the
 *   question this list exists to answer, and ordering answers it only for
 *   somebody who knows the ordering means something.
 * - **Removing takes one tap.** It is reversible by typing it again and
 *   nothing has been sent anywhere. *Applying: Ethical Friction, on the
 *   irreversible edge only.*
 *
 * Mirrors the web and iOS lists; `ContactAddressCopyTest` keeps the words the
 * same.
 */
@Composable
fun AddressList(
    addresses: List<ContactAddress>,
    onAdd: (label: String?, address: String) -> Unit,
    onMakePrimary: (String) -> Unit,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var adding by remember { mutableStateOf(false) }
    var draftLabel by remember { mutableStateOf("") }
    var draftAddress by remember { mutableStateOf("") }

    Column(modifier.fillMaxWidth().padding(top = 6.dp)) {
        for (entry in addresses) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 3.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Outlined.LocationOn,
                    contentDescription = null,
                    modifier = Modifier.size(15.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    buildString {
                        entry.label?.let {
                            append(it)
                            append(" · ")
                        }
                        append(entry.address)
                    },
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                )
                if (entry.is_primary) {
                    Text(
                        t("contactsTasks.addressPrimary"),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.SemiBold,
                        ),
                        color = MaterialTheme.colorScheme.secondary,
                    )
                } else {
                    TextButton(onClick = { onMakePrimary(entry.id) }) {
                        Text(
                            t("contactsTasks.addressMakePrimary"),
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                }
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = t(
                        "contactsTasks.removeNamed",
                        "name" to entry.address,
                    ),
                    modifier = Modifier
                        .size(15.dp)
                        .minimumInteractiveComponentSize()
                        .clickable { onRemove(entry.id) },
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (adding) {
            OutlinedTextField(
                value = draftLabel,
                onValueChange = { draftLabel = it.take(80) },
                label = { Text(t("contactsTasks.labelField")) },
                // #291/#228: this placeholder is pinned VERBATIM in
                // apps/web/src/components/contacts/address-parity.test.ts, which
                // reads this file's bytes. Extracting it fails that test from
                // the web tree, so it moves when all three clients move.
                placeholder = { Text(t("contactsTasks.addressLabelPlaceholder")) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            )
            OutlinedTextField(
                value = draftAddress,
                onValueChange = { draftAddress = it.take(CONTACT_ADDRESS_MAX) },
                label = { Text(t("contactsTasks.address")) },
                // Pinned verbatim by address-parity.test.ts — see above.
                placeholder = { Text(t("contactsTasks.addressPlaceholder")) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(
                    onClick = {
                        val address = draftAddress.trim()
                        if (address.isEmpty()) return@TextButton
                        onAdd(draftLabel.trim().ifEmpty { null }, address)
                        draftLabel = ""
                        draftAddress = ""
                        adding = false
                    },
                    enabled = draftAddress.isNotBlank(),
                ) { Text(t("contactsTasks.add")) }
                TextButton(
                    onClick = {
                        adding = false
                        draftLabel = ""
                        draftAddress = ""
                    },
                ) { Text(t("common.cancel")) }
            }
        } else {
            Row(
                Modifier
                    .minimumInteractiveComponentSize()
                    .clickable { adding = true }
                    .padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Outlined.Add,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    t("contactsTasks.addressAddAnother"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 4.dp),
                )
            }
        }
    }
}

/*
 * #228: the three labels that used to live here as `const val`s now live in
 * the catalogue, in both languages, under the same keys iOS uses.
 *
 * They were constants so the screen and its tests could name one string. That
 * is still true — the name is now the KEY, which is the thing the parity guard
 * and both phones agree on, rather than an English sentence one client happened
 * to hold.
 */

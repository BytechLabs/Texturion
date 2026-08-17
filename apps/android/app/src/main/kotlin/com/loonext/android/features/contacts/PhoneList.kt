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
import androidx.compose.material.icons.outlined.Phone
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ContactPhone

/**
 * #291 — the other numbers this customer answers.
 *
 * Design notes, and the principles behind them:
 *
 * - **Absent until it has something to say.** Nearly every customer has one
 *   line, which the row above already holds. An empty "other numbers" list on
 *   every record would be a permanent question mark to serve the household
 *   with two people in it. *Applying: Zen of Clarity, and Prioritize Intent.*
 * - **It says what adding one DOES.** This is not a notes field: a number
 *   recorded here is matched against every inbound text and call. Said where
 *   the decision is made, because otherwise the first time anyone learns it is
 *   when a message arrives under a name they did not expect.
 * - **A label is optional and free text.** A fixed vocabulary is wrong for the
 *   second trade that uses it — a household labels by person, a business by
 *   which line it is.
 * - **Removing takes one tap.** It is reversible by typing it again, and the
 *   conversations held with that number stay. *Applying: Ethical Friction, on
 *   the irreversible edge only — and this edge is not one.*
 *
 * Mirrors the web and iOS lists; `phone-parity.test.ts` keeps the words the
 * same.
 */
@Composable
fun PhoneList(
    phones: List<ContactPhone>,
    onAdd: (label: String?, phone: String) -> Unit,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var adding by remember { mutableStateOf(false) }
    var draftLabel by remember { mutableStateOf("") }
    var draftPhone by remember { mutableStateOf("") }

    Column(modifier.fillMaxWidth().padding(top = 6.dp)) {
        for (entry in phones) {
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
                    Icons.Outlined.Phone,
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
                        append(entry.phone_e164)
                    },
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                )
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = t(
                        "contactsTasks.phoneRemove",
                        "number" to entry.phone_e164,
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
                placeholder = { Text(t("contactsTasks.phoneLabelPlaceholder")) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            )
            OutlinedTextField(
                value = draftPhone,
                onValueChange = { draftPhone = it.take(32) },
                label = { Text(t("contactsTasks.numberField")) },
                placeholder = { Text(t("contactsTasks.phonePlaceholder")) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            )
            // What this actually does, said before it is done.
            Text(
                t("contactsTasks.phoneMatchNote"),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(
                    onClick = {
                        val phone = draftPhone.trim()
                        if (phone.isEmpty()) return@TextButton
                        onAdd(draftLabel.trim().ifEmpty { null }, phone)
                        draftLabel = ""
                        draftPhone = ""
                        adding = false
                    },
                    enabled = draftPhone.isNotBlank(),
                ) { Text(t("contactsTasks.add")) }
                TextButton(
                    onClick = {
                        adding = false
                        draftLabel = ""
                        draftPhone = ""
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
                    t("contactsTasks.phoneAddAnother"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.Normal,
                    modifier = Modifier.padding(start = 6.dp),
                )
            }
        }
    }
}

/**
 * The sentences this surface owns, kept where the parity test can read them.
 *
 * #228: these four sentences have MOVED to `ContactsTasksStrings`, under the
 * same keys iOS uses, in both languages.
 *
 * The note that used to sit here said they were deliberately held back because
 * `apps/web/src/components/contacts/phone-parity.test.ts` reads this file's
 * bytes, and that "they move when all three clients do". All three do now, and
 * that guard moved with them in the same commit: it reads Android's catalogue
 * alongside this screen, the way it already read iOS's.
 */

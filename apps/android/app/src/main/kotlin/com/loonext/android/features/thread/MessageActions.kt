package com.loonext.android.features.thread

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddTask
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection

/**
 * Long-press actions for one message: copy, done toggle, pin/unpin, retry
 * (failed sends only, honoring the retry rule), and Make a task.
 */
@Composable
fun MessageActionsSheet(
    message: Message,
    onToggleDone: () -> Unit,
    onTogglePin: () -> Unit,
    onRetry: () -> Unit,
    onMakeTask: () -> Unit,
    onCopied: () -> Unit,
    onDismiss: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth()) {
            if (message.body.isNotBlank()) {
                ActionRow(Icons.Filled.ContentCopy, "Copy text") {
                    clipboard.setText(AnnotatedString(message.body))
                    onCopied()
                    onDismiss()
                }
            }
            ActionRow(
                icon = if (message.done_at == null) Icons.Filled.RadioButtonUnchecked
                else Icons.Filled.CheckCircle,
                label = if (message.done_at == null) "Mark done" else "Mark not done",
            ) {
                onToggleDone()
                onDismiss()
            }
            ActionRow(
                icon = Icons.Filled.PushPin,
                label = if (message.pinned_at == null) "Pin message" else "Unpin message",
            ) {
                onTogglePin()
                onDismiss()
            }
            if (message.retryable) {
                ActionRow(Icons.Filled.Refresh, "Retry send") {
                    onRetry()
                    onDismiss()
                }
            }
            if (!message.has_task && message.promoted_task == null &&
                message.direction != MessageDirection.NOTE
            ) {
                ActionRow(Icons.Filled.AddTask, "Make a task") {
                    onMakeTask()
                    // The sheet closes; the title dialog opens from the screen.
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun ActionRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(16.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge)
    }
}

/** "Make a task" — title form prefilled from the message body. */
@Composable
fun MakeTaskDialog(
    message: Message,
    onCreate: (title: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var title by remember {
        mutableStateOf(message.body.trim().take(120).ifBlank { "Follow up" })
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Make a task") },
        text = {
            OutlinedTextField(
                value = title,
                onValueChange = { title = it.take(200) },
                label = { Text("Task title") },
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(title.trim()) },
                enabled = title.isNotBlank(),
            ) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

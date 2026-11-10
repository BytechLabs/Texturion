package com.loonext.android.ui.common

import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics

/** `Surface(onClick)` and a bare `clickable` set no role, so TalkBack never says "button". */
fun Modifier.asButton(): Modifier = semantics { role = Role.Button }

/** A button that is one of a set, so the reader hears "Selected" or "Not selected" with it. */
fun Modifier.asToggleButton(selected: Boolean): Modifier = semantics {
    role = Role.Button
    this.selected = selected
}

/** A segment of a tab strip: "Tab", and which one is on. */
fun Modifier.asTab(selected: Boolean): Modifier = semantics {
    role = Role.Tab
    this.selected = selected
}

package com.loonext.android.features.shell

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Membership
import com.loonext.android.ui.common.SelectField
import com.loonext.android.ui.common.SelectOption

@Composable
internal fun WorkspaceMenu(
    memberships: List<Membership>,
    companyId: String,
    modifier: Modifier = Modifier,
    onSwitchWorkspace: (String) -> Unit,
) {
    if (memberships.size < 2) return
    SelectField(
        options = memberships.map { SelectOption(it.company_id, it.name, enabled = it.company_id != companyId) },
        selected = companyId,
        onSelect = onSwitchWorkspace,
        modifier = modifier,
        label = t("shell.workspaces"),
        fillWidth = true,
    )
}

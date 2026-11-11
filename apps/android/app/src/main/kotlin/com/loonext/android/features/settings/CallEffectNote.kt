package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.CallEffects
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.MemberRole
import com.loonext.android.features.calls.CallsRepository
import com.loonext.android.features.calls.callEffectCount

/**
 * #725: a setting that ends or redirects calls says how many it touched, and
 * links to exactly those calls. Silent at zero, and silent for a role that
 * cannot manage settings (the server refuses them the counts anyway).
 *
 * One read serves every card on the screen: the counts sit in the store cache
 * under one key, so six notes cost one request.
 */
@Composable
fun CallEffectNote(scope: SettingsScope, reason: String, modifier: Modifier = Modifier) {
    val allowed = MemberRole.has(scope.role, Capability.SETTINGS_MANAGE)
    val key = CacheKeys.callEffects(scope.companyId)
    val effects by remember(key) {
        scope.graph.storeCache.flowOf<CallEffects>(key)
    }.collectAsStateWithLifecycle()
    LaunchedEffect(key, allowed) {
        if (allowed && effects == null) {
            runCatching { CallsRepository(scope.graph.api).effects(scope.companyId) }
                .onSuccess { scope.graph.storeCache.put(key, it) }
        }
    }
    val count = if (allowed) callEffectCount(effects, reason) else 0
    if (count == 0) return
    Column(modifier.padding(top = 4.dp)) {
        Text(
            t(
                if (count == 1) "settingsMore.callEffectOne" else "settingsMore.callEffectOther",
                "count" to "$count",
                "days" to "${effects?.days ?: 30}",
            ),
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TextButton(
            onClick = { scope.graph.pendingCallReason.value = reason },
            modifier = Modifier.heightIn(min = 48.dp),
        ) { Text(t("settingsMore.callEffectView")) }
    }
}

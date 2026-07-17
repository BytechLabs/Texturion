package com.loonext.android.features.calls

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import com.loonext.android.push.PushPrefs

/**
 * One-shot POST_NOTIFICATIONS runtime prompt at shell-ready (#167). Android
 * 13+ only (older platforms have no runtime permission). Fires the system
 * prompt AT MOST ONCE per install — persisted through [PushPrefs]'s
 * asked-before flag, the same flag the settings notifications card reads to
 * tell "not asked yet" from "denied → blocked", so both surfaces stay
 * consistent. Already granted, or already asked = silent no-op; the settings
 * card remains the recovery path after a denial.
 *
 * Mounted from [CallsOverlay] (which the shell always hosts at Ready), so no
 * shell wiring is required; safe to also call directly from the shell —
 * every guard is idempotent.
 */
@Composable
fun EnsureNotificationPermission() {
    if (Build.VERSION.SDK_INT < 33) return
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* Either way the user decided; settings offers the recovery path. */ }
    LaunchedEffect(Unit) {
        val granted = context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (granted || PushPrefs.permissionRequested(context)) return@LaunchedEffect
        PushPrefs.setPermissionRequested(context)
        launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}

package com.loonext.android.telephony

import android.content.Context
import android.telecom.TelecomManager
import androidx.core.telecom.CallsManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TelecomRegistrationTest {
    @Test
    fun `the phone account can reject requests after registration expires`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val telecom = context.getSystemService(TelecomManager::class.java)!!

        CallsManager(context).registerLoonextPhoneAccount()

        val handle = shadowOf(telecom).selfManagedPhoneAccounts.single()
        assertEquals(context.packageName, handle.componentName.packageName)
        assertEquals("androidx.core.telecom.internal.JetpackConnectionService", handle.componentName.className)
    }
}

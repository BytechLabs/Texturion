package com.loonext.android.features.security

import android.app.Activity
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.core.auth.AppPrefs
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowActivity

/**
 * #581 — the app switcher does not get a photograph of somebody's customers.
 *
 * The finding this pins: the lock only ever ticked on the way IN (RESUMED), and
 * the recents card is taken on the way OUT, while the app is still unlocked and
 * still composing a thread. Anybody holding the phone could swipe up and read a
 * contact name and the last message without the lock being asked once.
 *
 * ## Why a shadow rather than an assertion on the screen
 *
 * `Activity.setRecentsScreenshotEnabled` is a one-way binder call: Robolectric
 * lets it through without recording it, so there is nothing to read back. The
 * shadow below is the smallest way to make the REAL production call observable —
 * the alternative was asserting on a pure function and hoping the composable was
 * wired to it, which is exactly the half that was broken.
 */
@RunWith(RobolectricTestRunner::class)
// 34, matching every other Robolectric suite here: the target SDK is ahead of
// what Robolectric ships an image for. The pre-33 branch is reached through
// [hideFromRecents]'s `sdkInt` parameter instead of a second image, which is what
// that parameter exists for.
@Config(sdk = [34], shadows = [RecordingRecentsActivity::class])
class AppLockGateTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val prefs = AppPrefs(ApplicationProvider.getApplicationContext())

    @Before
    fun forgetLastCall() {
        RecordingRecentsActivity.snapshotAllowed = null
    }

    /** Mounts the real gate over a stand-in for the inbox. */
    private fun mountGate() {
        compose.setContent {
            MaterialTheme {
                AppLockGate(prefs) { Text("the inbox") }
            }
        }
    }

    private fun waitForSnapshotAllowed(expected: Boolean) {
        compose.waitUntil(timeoutMillis = 5_000) {
            RecordingRecentsActivity.snapshotAllowed == expected
        }
    }

    private val Activity.windowIsSecure: Boolean
        get() = window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

    @Test
    fun `a phone with the lock on is not photographed for the switcher`() {
        runBlocking { prefs.setAppLockEnabled(true) }

        mountGate()

        // The assertion is on the SETTING being on, not on the app being locked:
        // when the card is taken the app is unlocked by definition.
        waitForSnapshotAllowed(false)
        assertEquals(false, RecordingRecentsActivity.snapshotAllowed)
    }

    @Test
    fun `the switcher card survives for everybody who never asked for a lock`() {
        // The other half of the finding, and the reason this is not one
        // unconditional line: a sole operator who left the switch alone should
        // still recognise their own app in the switcher.
        runBlocking { prefs.setAppLockEnabled(false) }

        mountGate()
        compose.waitForIdle()

        assertNotEquals(
            "the card must not be turned off for somebody with the lock off",
            false,
            RecordingRecentsActivity.snapshotAllowed,
        )
        assertFalse(
            "and their screenshots must not be taken away either",
            compose.activity.windowIsSecure,
        )
    }

    @Test
    fun `turning the lock back off gives the card back`() {
        runBlocking { prefs.setAppLockEnabled(true) }
        mountGate()
        waitForSnapshotAllowed(false)

        runBlocking { prefs.setAppLockEnabled(false) }

        // Not merely "stops being re-applied" — a suppression that outlived the
        // setting would be a switcher card that stays blank forever, with nothing
        // in the app to explain why.
        waitForSnapshotAllowed(true)
        assertEquals(true, RecordingRecentsActivity.snapshotAllowed)
    }

    @Test
    fun `an old truck phone is covered rather than quietly skipped`() {
        // API 32 has no recents-only switch and `minSdk` is 28, so this band is
        // most of the spare handsets the feature was named for. The failure this
        // catches is the API-33-only fix that ships a no-op to them.
        val activity = compose.activity
        assertFalse("the fixture itself must start clean", activity.windowIsSecure)

        hideFromRecents(activity, hide = true, sdkInt = 32)

        assertTrue(activity.windowIsSecure)
        assertEquals(
            "and it must not have reached for an API that phone does not have",
            null,
            RecordingRecentsActivity.snapshotAllowed,
        )
    }

    @Test
    fun `an old truck phone gets its screenshots back when the lock goes off`() {
        val activity = compose.activity
        hideFromRecents(activity, hide = true, sdkInt = 32)

        hideFromRecents(activity, hide = false, sdkInt = 32)

        assertFalse(activity.windowIsSecure)
    }

    @Test
    fun `a modern phone keeps its screenshots`() {
        // The whole reason the two branches are not one FLAG_SECURE call:
        // photographing a thread to send a colleague is something people do with
        // this app, and API 33 can blank the card without touching it.
        val activity = compose.activity

        hideFromRecents(activity, hide = true, sdkInt = 33)

        assertEquals(false, RecordingRecentsActivity.snapshotAllowed)
        assertFalse(activity.windowIsSecure)
    }

    @Test
    fun `every supported phone gets one of the two mechanisms`() {
        // minSdk is 28, so the bands are 28..32 and 33 up. Nothing may fall
        // between them, which is the drift a single call-site version check
        // invites.
        for (sdk in 28..32) {
            assertEquals("api $sdk", RecentsCover.WHOLE_WINDOW, recentsCoverFor(sdk))
        }
        for (sdk in 33..40) {
            assertEquals("api $sdk", RecentsCover.RECENTS_CARD_ONLY, recentsCoverFor(sdk))
        }
    }
}

/**
 * Records what the production code asked the framework for.
 *
 * Extends Robolectric's own [ShadowActivity] rather than replacing it so the
 * compose test rule's host activity keeps working; the only method added is the
 * one Robolectric does not model. Static because Robolectric owns the instance.
 */
@Implements(Activity::class)
class RecordingRecentsActivity : ShadowActivity() {

    @Implementation
    fun setRecentsScreenshotEnabled(enabled: Boolean) {
        snapshotAllowed = enabled
    }

    companion object {
        /** Null until the production code says anything at all. */
        @JvmStatic
        var snapshotAllowed: Boolean? = null
    }
}

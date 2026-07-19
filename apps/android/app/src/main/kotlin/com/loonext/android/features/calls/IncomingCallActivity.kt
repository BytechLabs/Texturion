package com.loonext.android.features.calls

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.loonext.android.LoonextApp
import com.loonext.android.telephony.CallNotifier
import com.loonext.android.telephony.SoftphoneManager

/**
 * The full-screen incoming-call surface (#171). Jetpack Telecom registers a
 * SELF-MANAGED call, for which Android draws NO system incoming UI — so this is
 * the app's own over-the-keyguard ring, launched by the [CallNotifier]
 * `CallStyle` notification's `fullScreenIntent`. It shows the caller and
 * Answer / Decline, both of which DRIVE the Telecom call through
 * [SoftphoneManager] (Telecom keeps owning the mic FGS / audio once answered).
 *
 * Deliberately thin: no in-call controls, no Compose, no tab shell. It shows
 * over the lock screen (`showWhenLocked` + `turnScreenOn`), answers with an
 * explicit keyguard dismissal (a locked answer needs device verification), and
 * finishes the moment the user acts. The registry's ring-window / server
 * `call_end` still tear the call down if the user never acts.
 */
class IncomingCallActivity : Activity() {

    companion object {
        private const val EXTRA_SESSION = "session"
        private const val EXTRA_CALLER_NAME = "caller_name"
        private const val EXTRA_CALLER_NUMBER = "caller_number"

        fun intent(
            context: Context,
            session: String?,
            callerName: String,
            callerNumber: String,
        ): Intent = Intent(context, IncomingCallActivity::class.java).apply {
            putExtra(EXTRA_SESSION, session)
            putExtra(EXTRA_CALLER_NAME, callerName)
            putExtra(EXTRA_CALLER_NUMBER, callerNumber)
            // One task/instance: a re-fired fullScreenIntent reuses this activity
            // rather than stacking a second ring screen.
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }

    private val session: String? get() = intent.getStringExtra(EXTRA_SESSION)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverKeyguard()
        setContentView(buildView())
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        setContentView(buildView())
    }

    private fun showOverKeyguard() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            )
        }
    }

    private fun buildView(): ViewGroup {
        val name = intent.getStringExtra(EXTRA_CALLER_NAME).orEmpty()
        val number = intent.getStringExtra(EXTRA_CALLER_NUMBER).orEmpty()
        val title = name.ifBlank { number.ifBlank { "Incoming call" } }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#101114"))
            setPadding(64, 128, 64, 128)
        }
        root.addView(
            TextView(this).apply {
                text = "Incoming call"
                setTextColor(Color.parseColor("#9AA0A6"))
                textSize = 16f
                gravity = Gravity.CENTER
            },
        )
        root.addView(
            TextView(this).apply {
                text = title
                setTextColor(Color.WHITE)
                textSize = 28f
                gravity = Gravity.CENTER
                setPadding(0, 32, 0, 96)
            },
        )
        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        buttons.addView(
            Button(this).apply {
                text = "Decline"
                setBackgroundColor(Color.parseColor("#D93025"))
                setTextColor(Color.WHITE)
                setOnClickListener { onDecline() }
            },
            lp(),
        )
        buttons.addView(
            Button(this).apply {
                text = "Answer"
                setBackgroundColor(Color.parseColor("#1E8E3E"))
                setTextColor(Color.WHITE)
                setOnClickListener { onAnswer() }
            },
            lp(),
        )
        root.addView(buttons)
        return root
    }

    private fun lp() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        .apply { setMargins(24, 0, 24, 0) }

    private fun onAnswer() {
        val s = session
        // Verify the device on a locked answer (WhatsApp-style: the OS prompts).
        if (Build.VERSION.SDK_INT >= 26) {
            runCatching {
                (getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)
                    ?.requestDismissKeyguard(this, null)
            }
        }
        if (s != null) {
            runCatching { softphone()?.answerIncoming(s) }
            runCatching { CallNotifier.cancelIncomingForSession(this, s) }
        }
        finish()
    }

    private fun onDecline() {
        val s = session
        if (s != null) {
            runCatching { softphone()?.declineIncoming(s) }
            runCatching { CallNotifier.cancelIncomingForSession(this, s) }
        }
        finish()
    }

    private fun softphone(): SoftphoneManager? = runCatching {
        val app = applicationContext as? LoonextApp ?: return null
        SoftphoneManager.get(applicationContext, app.graph.api)
    }.getOrNull()
}

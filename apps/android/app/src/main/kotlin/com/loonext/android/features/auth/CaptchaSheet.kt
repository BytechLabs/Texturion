package com.loonext.android.features.auth

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.loonext.android.core.net.ApiException
import com.loonext.android.ui.common.CenteredLoading
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The captcha bridge page (#166): app.loonext.com hosts the Turnstile widget
 * (site-key hostname validation forces it onto that domain) and posts the
 * minted token to `window.LoonextCaptcha.postToken`.
 */
private const val CAPTCHA_URL = "https://app.loonext.com/native-captcha"
private const val CAPTCHA_HOST = "app.loonext.com"

/**
 * True when a GoTrue failure is the captcha gate — the signal to mint a token
 * and retry the SAME call. Structural first (`captcha_failed` is the stable
 * error_code on current GoTrue), message sniff second because older versions
 * ship the gate as a bare 500/400 "captcha protection: request disallowed".
 */
fun isCaptchaRejection(cause: Throwable): Boolean {
    val api = cause as? ApiException ?: return false
    return api.code == "captcha_failed" || api.message.contains("captcha", ignoreCase = true)
}

/**
 * Bottom sheet hosting the Turnstile bridge page in a WebView. Delivers the
 * minted token via [onResult] exactly once; dismissing without a token
 * delivers null (= the user declined the security check).
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun CaptchaSheet(onResult: (String?) -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val currentOnResult by rememberUpdatedState(onResult)
    // Turnstile can re-mint on its own refresh timer — deliver only the first.
    val delivered = remember { AtomicBoolean(false) }
    var loading by remember { mutableStateOf(true) }
    var loadFailed by remember { mutableStateOf(false) }
    var retryKey by remember { mutableStateOf(0) }

    fun deliver(token: String?) {
        if (delivered.compareAndSet(false, true)) currentOnResult(token)
    }

    ModalBottomSheet(
        onDismissRequest = { deliver(null) },
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp)) {
            Text(
                "Quick security check",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                "Confirm you're human, then we'll finish signing you in.",
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
            )
        }
        // #180: the widget height derives from the space the sheet actually
        // has (360dp when it fits, less on short viewports). Never wrap a
        // WebView in a scroll container; Turnstile lays itself out inside.
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val checkHeight = min(360.dp, maxHeight)
            Box(Modifier.fillMaxWidth().height(checkHeight)) {
                if (loadFailed) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(24.dp),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            "Couldn't load the security check. Check your connection.",
                            style = MaterialTheme.typography.bodyMedium,
                            textAlign = TextAlign.Center,
                        )
                        Button(
                            onClick = {
                                loadFailed = false
                                loading = true
                                retryKey++
                            },
                            modifier = Modifier.padding(top = 16.dp),
                        ) { Text("Try again") }
                    }
                } else {
                    // retryKey remounts the WebView for a clean reload after an error.
                    androidx.compose.runtime.key(retryKey) {
                        AndroidView(
                            modifier = Modifier.fillMaxSize(),
                            factory = { context ->
                                WebView(context).apply {
                                    settings.javaScriptEnabled = true
                                    settings.allowFileAccess = false
                                    settings.allowContentAccess = false
                                    // Turnstile's challenge iframe needs storage.
                                    settings.domStorageEnabled = true
                                    webViewClient = object : WebViewClient() {
                                        override fun shouldOverrideUrlLoading(
                                            view: WebView,
                                            request: WebResourceRequest,
                                        ): Boolean {
                                            // The Turnstile challenge itself is a
                                            // cloudflare.com SUBFRAME — only the
                                            // main frame is pinned to our page.
                                            if (!request.isForMainFrame) return false
                                            return request.url.host != CAPTCHA_HOST
                                        }

                                        override fun onPageStarted(
                                            view: WebView,
                                            url: String?,
                                            favicon: Bitmap?,
                                        ) {
                                            loading = true
                                        }

                                        override fun onPageFinished(view: WebView, url: String?) {
                                            loading = false
                                        }

                                        override fun onReceivedError(
                                            view: WebView,
                                            request: WebResourceRequest,
                                            error: WebResourceError,
                                        ) {
                                            if (request.isForMainFrame) {
                                                loading = false
                                                loadFailed = true
                                            }
                                        }
                                    }
                                    addJavascriptInterface(
                                        CaptchaBridge { token ->
                                            // JS-thread callback — hop to main.
                                            post { deliver(token) }
                                        },
                                        "LoonextCaptcha",
                                    )
                                    loadUrl(CAPTCHA_URL)
                                }
                            },
                            onRelease = { webView ->
                                webView.stopLoading()
                                webView.destroy()
                            },
                        )
                    }
                    if (loading) CenteredLoading()
                }
            }
        }
    }
}

/**
 * The `window.LoonextCaptcha` object the bridge page calls. Named class (not
 * anonymous) so the default @JavascriptInterface keep rules apply cleanly
 * under R8.
 */
private class CaptchaBridge(private val onToken: (String) -> Unit) {
    @JavascriptInterface
    fun postToken(token: String) {
        onToken(token)
    }
}

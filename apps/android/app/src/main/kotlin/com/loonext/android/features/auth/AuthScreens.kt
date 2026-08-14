package com.loonext.android.features.auth

import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.loonext.android.core.auth.AuthManager
import com.loonext.android.core.i18n.t
import com.loonext.android.ui.common.PreviewHarness
import com.loonext.android.ui.common.ResponsivePreviews
import com.loonext.android.ui.common.contentMaxWidth
import com.loonext.android.ui.common.isCompactHeight
import com.loonext.android.ui.common.loonextWordmark
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class AuthUiState(
    val busy: Boolean = false,
    val error: AuthError? = null,
    /** Signup ended with "check your email" instead of a session. */
    val confirmationSent: Boolean = false,
    /** Password-reset email fired. */
    val resetSent: Boolean = false,
    /** Supabase demanded a captcha — the sheet is up minting a token (#166). */
    val awaitingCaptcha: Boolean = false,
    /** Preflighted Google authorize URL waiting for a browser launch (#166). */
    val googleLaunchUrl: String? = null,
)

/**
 * The password call to replay once the captcha sheet delivers a token —
 * tokens are single-use, so every retry re-runs the ORIGINAL call with a
 * freshly minted token (sign-up keeps its display name through the loop).
 */
private sealed interface PendingAuthAction {
    /**
     * #228: a KEY, not a sentence.
     *
     * This is a plain interface property and `t()` is `@Composable`, so a
     * sentence written here could only ever be written in one language. The
     * key travels to the screen, which has a reader and therefore a language.
     */
    val fallbackKey: String

    data class SignIn(val email: String, val password: String) : PendingAuthAction {
        override val fallbackKey get() = "auth.signInFailed"
    }

    data class SignUp(
        val name: String,
        val email: String,
        val password: String,
    ) : PendingAuthAction {
        override val fallbackKey get() = "auth.signUpFailed"
    }

    data class Reset(val email: String) : PendingAuthAction {
        override val fallbackKey get() = "auth.resetEmailFailed"
    }
}

/**
 * #228 — why the screen is showing a red line, in a form that can be translated
 * at the point somebody reads it.
 *
 * Two shapes, because there are two AUTHORS. [Server] is a sentence the API
 * wrote and has already phrased for a person; we would be re-translating
 * somebody else's words to touch it. [Ours] is a key, because the ViewModel
 * that decides it runs outside composition and has no reader — the language
 * only exists on the screen.
 *
 * A single `String?` held both and could distinguish neither, which is why
 * every auth error on this phone was English regardless of the reader.
 */
sealed interface AuthError {
    data class Server(val text: String) : AuthError

    data class Ours(val key: String) : AuthError
}

/**
 * The server's sentence when it wrote one, otherwise our own key.
 *
 * `userMessage()` returns a blank string when the failure carried nothing a
 * person could read — a network drop, a parse error — which is exactly when a
 * screen showing nothing at all is the worst outcome.
 */
private fun authError(serverMessage: String, fallbackKey: String): AuthError =
    if (serverMessage.isBlank()) {
        AuthError.Ours(fallbackKey)
    } else {
        AuthError.Server(serverMessage)
    }

class AuthViewModel(private val authManager: AuthManager) : ViewModel() {
    private val _state = MutableStateFlow(AuthUiState())
    val state: StateFlow<AuthUiState> = _state

    private val google = GoogleSignIn(authManager)

    /** The call awaiting a captcha token (null = no captcha loop running). */
    private var pendingAction: PendingAuthAction? = null

    fun signIn(email: String, password: String) =
        attempt(PendingAuthAction.SignIn(email.trim(), password), captchaToken = null)

    fun signUp(name: String, email: String, password: String) =
        attempt(PendingAuthAction.SignUp(name.trim(), email.trim(), password), captchaToken = null)

    fun sendReset(email: String) =
        attempt(PendingAuthAction.Reset(email.trim()), captchaToken = null)

    /** Token from the captcha sheet; null = the user dismissed it. */
    fun onCaptchaResult(token: String?) {
        _state.value = _state.value.copy(awaitingCaptcha = false)
        val action = pendingAction
        if (token == null) {
            pendingAction = null
            _state.value =
                _state.value.copy(error = AuthError.Ours("auth.captchaNeeded"))
            return
        }
        if (action != null) attempt(action, token)
    }

    fun signInWithGoogle() {
        if (_state.value.busy) return
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                val url = google.begin()
                _state.value = _state.value.copy(busy = false, googleLaunchUrl = url)
            } catch (cause: Exception) {
                _state.value = _state.value.copy(
                    busy = false,
                    error = authError(cause.userMessage(), "auth.googleFailed"),
                )
            }
        }
    }

    /** The UI consumed [AuthUiState.googleLaunchUrl] (or found no browser). */
    fun onGoogleLaunched(launched: Boolean) {
        _state.value = _state.value.copy(
            googleLaunchUrl = null,
            error = if (launched) {
                _state.value.error
            } else {
                AuthError.Ours("auth.googleNoBrowser")
            },
        )
    }

    /**
     * Resume-time stranded-handoff check: a pending browser handoff that is
     * >10s old with no redirect delivered means the user is back without a
     * result (cancel, or a redirect that stranded in the browser). The 2s
     * grace lets an in-flight buffered redirect win the race (onNewIntent
     * runs before onResume on singleTask, but delivery hops coroutines).
     */
    fun onAuthScreenResumed() {
        viewModelScope.launch {
            kotlinx.coroutines.delay(2_000)
            if (_state.value.busy || _state.value.googleLaunchUrl != null) return@launch
            val pending = authManager.peekPendingOAuth() ?: return@launch
            if (System.currentTimeMillis() - pending.createdAtMillis > 10_000) {
                authManager.clearPendingOAuth()
                _state.value = _state.value.copy(
                    error = AuthError.Ours("auth.googleUnfinished"),
                )
            }
        }
    }

    /** The com.loonext.android://auth-callback redirect (via AuthCallbacks). */
    fun onOAuthRedirect(uri: Uri) {
        if (_state.value.busy) return
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            val failure = google.complete(
                code = uri.getQueryParameter("code"),
                state = uri.getQueryParameter("state"),
                error = uri.getQueryParameter("error"),
                errorDescription = uri.getQueryParameter("error_description"),
            )
            // Success saves the session — Root observes it and unmounts us.
            // The provider's own words when it refuses, so they are shown as
            // written rather than re-phrased by us.
            _state.value = _state.value.copy(
                busy = false,
                error = failure?.let(AuthError::Server),
            )
        }
    }

    /**
     * Runs a password-path call. First attempt goes without a token; the
     * structural captcha rejection parks the call in [pendingAction] and
     * raises the sheet. A rejection WITH a token means it expired mid-flight —
     * re-mint (the sheet comes back) rather than failing the user.
     */
    private fun attempt(action: PendingAuthAction, captchaToken: String?) {
        if (_state.value.busy) return
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                when (action) {
                    is PendingAuthAction.SignIn ->
                        authManager.signIn(action.email, action.password, captchaToken)

                    is PendingAuthAction.SignUp -> {
                        val signedIn = authManager.signUp(
                            action.email, action.password, action.name, captchaToken,
                        )
                        if (!signedIn) {
                            _state.value = _state.value.copy(confirmationSent = true)
                        }
                    }

                    is PendingAuthAction.Reset -> {
                        authManager.sendPasswordReset(action.email, captchaToken)
                        _state.value = _state.value.copy(resetSent = true)
                    }
                }
                pendingAction = null
                _state.value = _state.value.copy(busy = false)
            } catch (cause: Exception) {
                if (isCaptchaRejection(cause)) {
                    pendingAction = action
                    _state.value = _state.value.copy(busy = false, awaitingCaptcha = true)
                } else {
                    pendingAction = null
                    _state.value = _state.value.copy(
                        busy = false,
                        error = authError(cause.userMessage(), action.fallbackKey),
                    )
                }
            }
        }
    }
}

/** `internal` so [AuthFrontDoorPreviewBody] can be asked for one of the three. */
internal enum class AuthScreen { Login, SignUp, Forgot }

/**
 * The signed-out surface: login / signup / forgot-password, one calm column
 * in the paper-&-olive front-door grammar (screens 10–12).
 * Session appearance is observed upstream (Root) — success needs no callback.
 */
@Composable
fun AuthFlow(viewModel: AuthViewModel) {
    var screen by rememberSaveable { mutableStateOf(AuthScreen.Login) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // OAuth redirects (buffered across process death by AuthCallbacks) land
    // in the ViewModel while this signed-out surface is mounted.
    DisposableEffect(viewModel) {
        AuthCallbacks.onOAuthRedirect = viewModel::onOAuthRedirect
        onDispose { AuthCallbacks.onOAuthRedirect = null }
    }

    // Hand the preflighted authorize URL to the system browser.
    LaunchedEffect(state.googleLaunchUrl) {
        val url = state.googleLaunchUrl ?: return@LaunchedEffect
        val launched = runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
        }.isSuccess
        viewModel.onGoogleLaunched(launched)
    }

    // Stranded-handoff guard: the user came back from the browser but no
    // redirect arrived (canceled, or a misconfigured redirect stranded the
    // browser on the website). Surface honest copy instead of silence.
    LifecycleResumeEffect(viewModel) {
        viewModel.onAuthScreenResumed()
        onPauseOrDispose { }
    }

    if (state.awaitingCaptcha) {
        CaptchaSheet(onResult = viewModel::onCaptchaResult)
    }

    // Keyboard: MainActivity's PreShellHost pads the ime for EVERY signed-out
    // surface (#199) - no local imePadding here. The scroll plus foundation's
    // focus relocation brings the focused field above the keyboard.
    // #180: the front door already scrolls at any height; additionally cap +
    // centre the column on wide viewports (tablets, foldables) so the form
    // doesn't stretch, and trim the top gap on short/landscape viewports.
    val compact = isCompactHeight()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .contentMaxWidth(460.dp)
            .statusBarsPadding()
            .padding(horizontal = 24.dp)
            .padding(top = if (compact) 8.dp else 18.dp, bottom = 24.dp),
    ) {
        when (screen) {
            AuthScreen.Login -> LoginForm(
                busy = state.busy,
                error = state.error,
                onSubmit = viewModel::signIn,
                onGoogle = viewModel::signInWithGoogle,
                onForgot = { screen = AuthScreen.Forgot },
                onSignUp = { screen = AuthScreen.SignUp },
            )

            AuthScreen.SignUp -> SignUpForm(
                busy = state.busy,
                error = state.error,
                confirmationSent = state.confirmationSent,
                onSubmit = viewModel::signUp,
                onGoogle = viewModel::signInWithGoogle,
                onLogin = { screen = AuthScreen.Login },
            )

            AuthScreen.Forgot -> ForgotForm(
                busy = state.busy,
                error = state.error,
                resetSent = state.resetSent,
                onSubmit = viewModel::sendReset,
                onLogin = { screen = AuthScreen.Login },
            )
        }
    }
}

/** Text wordmark (#206): 'Loonext' with the second o in the accent. */
@Composable
private fun Wordmark() {
    Text(
        loonextWordmark(),
        style = MaterialTheme.typography.titleLarge.copy(
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-0.02).em,
        ),
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/** The Bricolage front-door headline + one muted supporting line. */
@Composable
private fun Headline(title: String, body: String?) {
    Text(
        title,
        style = MaterialTheme.typography.headlineMedium.copy(
            fontSize = 28.sp,
            lineHeight = 34.sp,
        ),
        color = MaterialTheme.colorScheme.onBackground,
    )
    if (body != null) {
        Text(
            body,
            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp, lineHeight = 19.5.sp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

/** 44dp paper circle back button (auth sub-screens). */
@Composable
private fun BackCircle(contentDescription: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
        modifier = Modifier.size(44.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = contentDescription,
                modifier = Modifier.size(17.dp),
            )
        }
    }
}

/** SSO above the email form (mirrors the web's §1.7 front-door layout). */
@Composable
private fun SsoBlock(busy: Boolean, onGoogle: () -> Unit) {
    GoogleSignInButton(busy = busy, onClick = onGoogle)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp),
    ) {
        HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outlineVariant)
        Text(
            t("auth.or"),
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
            ),
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.padding(horizontal = 10.dp),
        )
        HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outlineVariant)
    }
}

/** Paper-pill input: tracked uppercase micro-label over a rounded-16 field. */
@Composable
private fun AuthField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    isPassword: Boolean = false,
    helper: String? = null,
) {
    var showPassword by rememberSaveable { mutableStateOf(false) }
    Column(modifier.fillMaxWidth()) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 10.5.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.1.em,
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, end = 4.dp, bottom = 6.dp),
        )
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.5.dp, MaterialTheme.colorScheme.surfaceContainerHigh),
        ) {
            Row(
                Modifier.padding(horizontal = 15.dp, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium.copy(
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
                    keyboardOptions = keyboardOptions,
                    visualTransformation = if (isPassword && !showPassword) {
                        PasswordVisualTransformation()
                    } else {
                        VisualTransformation.None
                    },
                    modifier = Modifier.weight(1f),
                )
                if (isPassword) {
                    Icon(
                        if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                        contentDescription =
                            if (showPassword) t("auth.hidePassword") else t("auth.showPassword"),
                        tint = MaterialTheme.colorScheme.outline,
                        modifier = Modifier
                            .size(16.dp)
                            .clickable { showPassword = !showPassword },
                    )
                }
            }
        }
        if (helper != null) {
            Text(
                helper,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(start = 4.dp, top = 5.dp),
            )
        }
    }
}

/** Ink pill primary button with the lime arrow puck. */
@Composable
private fun InkPillButton(
    text: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
        modifier = modifier
            .fillMaxWidth()
            .alpha(if (enabled) 1f else 0.55f),
    ) {
        Row(
            Modifier.padding(start = 22.dp, top = 8.dp, bottom = 8.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text,
                style = MaterialTheme.typography.titleMedium.copy(
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                modifier = Modifier.weight(1f),
            )
            Box(
                Modifier
                    .size(42.dp)
                    .background(MaterialTheme.colorScheme.tertiary, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Outlined.ArrowForward,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onTertiary,
                    modifier = Modifier.size(17.dp),
                )
            }
        }
    }
}

/** Lime-check inset banner ("Link sent to …"). */
@Composable
private fun SuccessBanner(text: String) {
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(horizontal = 15.dp, vertical = 13.dp)) {
            Box(
                Modifier
                    .size(22.dp)
                    .background(MaterialTheme.colorScheme.tertiary, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.Check,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onTertiary,
                    modifier = Modifier.size(12.dp),
                )
            }
            Text(
                text,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 12.5.sp,
                    lineHeight = 18.75.sp,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 10.dp),
            )
        }
    }
}

/** Bottom footer link: muted lead-in + bold ink action. */
@Composable
private fun FooterLink(prefix: String, action: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
    ) {
        Text(
            "$prefix ",
            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            action,
            style = MaterialTheme.typography.bodySmall.copy(
                fontSize = 12.5.sp,
                fontWeight = FontWeight.Bold,
            ),
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Composable
private fun LoginForm(
    busy: Boolean,
    error: AuthError?,
    onSubmit: (String, String) -> Unit,
    onGoogle: () -> Unit,
    onForgot: () -> Unit,
    onSignUp: () -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    Wordmark()
    Spacer(Modifier.height(18.dp))
    Headline(
        title = t("auth.loginTitle"),
        body = t("auth.loginBody"),
    )
    Spacer(Modifier.height(26.dp))
    SsoBlock(busy = busy, onGoogle = onGoogle)
    AuthField(
        label = t("auth.workEmail"),
        value = email,
        onValueChange = { email = it },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
    )
    Spacer(Modifier.height(12.dp))
    AuthField(
        label = t("auth.password"),
        value = password,
        onValueChange = { password = it },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        isPassword = true,
    )
    ErrorLine(error)
    Spacer(Modifier.height(14.dp))
    InkPillButton(
        text = if (busy) t("auth.signingIn") else t("auth.signIn"),
        enabled = !busy && email.isNotBlank() && password.isNotBlank(),
        onClick = { onSubmit(email, password) },
    )
    Spacer(Modifier.height(10.dp))
    Text(
        t("auth.forgotPassword"),
        style = MaterialTheme.typography.labelMedium.copy(
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
        ),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onForgot)
            .padding(vertical = 8.dp),
    )
    Spacer(Modifier.height(18.dp))
    FooterLink(
        t("auth.newToLoonext"),
        t("auth.createYourAccount"),
        onClick = onSignUp,
    )
}

@Composable
private fun SignUpForm(
    busy: Boolean,
    error: AuthError?,
    confirmationSent: Boolean,
    onSubmit: (String, String, String) -> Unit,
    onGoogle: () -> Unit,
    onLogin: () -> Unit,
) {
    BackCircle(contentDescription = t("auth.backToSignIn"), onClick = onLogin)
    Spacer(Modifier.height(26.dp))

    if (confirmationSent) {
        Headline(title = t("auth.confirmTitle"), body = null)
        Spacer(Modifier.height(16.dp))
        SuccessBanner(t("auth.confirmBody"))
        Spacer(Modifier.height(18.dp))
        FooterLink(t("auth.doneConfirming"), t("auth.backToSignIn"), onClick = onLogin)
        return
    }
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    Headline(
        title = t("auth.signUpTitle"),
        body = t("auth.signUpBody"),
    )
    Spacer(Modifier.height(24.dp))
    SsoBlock(busy = busy, onGoogle = onGoogle)
    AuthField(
        label = t("auth.yourName"),
        value = name,
        onValueChange = { name = it },
    )
    Spacer(Modifier.height(12.dp))
    AuthField(
        label = t("auth.workEmail"),
        value = email,
        onValueChange = { email = it },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
    )
    Spacer(Modifier.height(12.dp))
    AuthField(
        label = t("auth.password"),
        value = password,
        onValueChange = { password = it },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        isPassword = true,
        helper = t("auth.passwordHelper"),
    )
    ErrorLine(error)
    Spacer(Modifier.height(14.dp))
    InkPillButton(
        text = if (busy) t("auth.creatingAccount") else t("auth.createAccount"),
        enabled = !busy && name.isNotBlank() && email.isNotBlank() && password.length >= 8,
        onClick = { onSubmit(name, email, password) },
    )
    Spacer(Modifier.height(12.dp))
    Text(
        t("auth.legal"),
        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, lineHeight = 16.5.sp),
        color = MaterialTheme.colorScheme.outline,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(14.dp))
    FooterLink(t("auth.alreadyHaveAccount"), t("auth.signIn"), onClick = onLogin)
}

@Composable
private fun ForgotForm(
    busy: Boolean,
    error: AuthError?,
    resetSent: Boolean,
    onSubmit: (String) -> Unit,
    onLogin: () -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }

    BackCircle(contentDescription = t("auth.backToSignIn"), onClick = onLogin)
    Spacer(Modifier.height(26.dp))
    Headline(
        title = t("auth.resetTitle"),
        body = t("auth.resetBody"),
    )
    Spacer(Modifier.height(24.dp))
    AuthField(
        label = t("auth.workEmail"),
        value = email,
        onValueChange = { email = it },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
    )
    ErrorLine(error)
    Spacer(Modifier.height(14.dp))
    InkPillButton(
        text = if (busy) t("auth.sending") else t("auth.sendResetLink"),
        enabled = !busy && email.isNotBlank(),
        onClick = { onSubmit(email) },
    )
    if (resetSent) {
        Spacer(Modifier.height(12.dp))
        SuccessBanner(
            if (email.isBlank()) {
                t("auth.resetSentGeneric")
            } else {
                t("auth.resetSentTo", "email" to email)
            },
        )
    }
    Spacer(Modifier.height(18.dp))
    FooterLink(t("auth.rememberedIt"), t("auth.backToSignIn"), onClick = onLogin)
}

@Composable
private fun ErrorLine(error: AuthError?) {
    if (error != null) {
        Spacer(Modifier.height(10.dp))
        Text(
            // Resolved HERE, which is the whole point of the type: this is the
            // first place in the flow that knows who is reading.
            when (error) {
                is AuthError.Server -> error.text
                is AuthError.Ours -> t(error.key)
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
        )
    }
}

/**
 * #180 responsive proof: the real sign-in front door laid out at every ratio
 * (square cover display, small phone, tall 21:9, landscape, tablet). The scroll
 * keeps every control reachable; the max-width cap centres it on wide screens.
 */
@ResponsivePreviews
@Composable
private fun AuthFlowPreview() {
    PreviewHarness { AuthFrontDoorPreviewBody() }
}

/**
 * #218 contrast proof: the signed-out front door in BOTH themes. The founder
 * saw dark ink text on a dark background in light mode because the pre-shell
 * host painted no background of its own (fixed in MainActivity's PreShellHost).
 * PreviewHarness paints the themed background the same way, so a regression in
 * either scheme's text-on-background contrast is visible here at a glance.
 */
@Preview(name = "Auth · light", uiMode = Configuration.UI_MODE_NIGHT_NO, showBackground = true, heightDp = 900)
@Preview(name = "Auth · dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true, heightDp = 900)
@Composable
private fun AuthFlowThemePreview() {
    PreviewHarness { AuthFrontDoorPreviewBody() }
}

/**
 * The front door with no ViewModel behind it — one of the three screens, in the
 * same column [AuthFlow] puts them in.
 *
 * `internal` rather than private so `AuthFrenchRenderTest` can photograph
 * exactly what the IDE preview draws. A test that built its own column would be
 * a second arrangement of this screen, free to agree with the real one on the
 * day it was written and drift after — and the thing being checked here is
 * whether the words FIT, which is a property of the arrangement.
 */
@Composable
internal fun AuthFrontDoorPreviewBody(screen: AuthScreen = AuthScreen.Login) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .contentMaxWidth(460.dp)
            .statusBarsPadding()
            .padding(horizontal = 24.dp)
            .padding(top = 18.dp, bottom = 24.dp),
    ) {
        when (screen) {
            AuthScreen.Login -> LoginForm(
                busy = false,
                error = null,
                onSubmit = { _, _ -> },
                onGoogle = {},
                onForgot = {},
                onSignUp = {},
            )

            AuthScreen.SignUp -> SignUpForm(
                busy = false,
                error = null,
                confirmationSent = false,
                onSubmit = { _, _, _ -> },
                onGoogle = {},
                onLogin = {},
            )

            AuthScreen.Forgot -> ForgotForm(
                busy = false,
                error = null,
                resetSent = false,
                onSubmit = {},
                onLogin = {},
            )
        }
    }
}

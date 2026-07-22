package com.loonext.android.features.auth

import android.content.Intent
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
import androidx.compose.foundation.layout.imePadding
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.loonext.android.core.auth.AuthManager
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class AuthUiState(
    val busy: Boolean = false,
    val error: String? = null,
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
    val fallback: String

    data class SignIn(val email: String, val password: String) : PendingAuthAction {
        override val fallback get() = "Sign-in failed."
    }

    data class SignUp(
        val name: String,
        val email: String,
        val password: String,
    ) : PendingAuthAction {
        override val fallback get() = "Sign-up failed."
    }

    data class Reset(val email: String) : PendingAuthAction {
        override val fallback get() = "Couldn't send the reset email."
    }
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
            _state.value = _state.value.copy(error = "Sign-in needs the security check.")
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
                    error = cause.userMessage().ifBlank { "Google sign-in failed. Try again." },
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
                "No browser is available for Google sign-in."
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
                    error = "Google sign-in didn't finish. Try again.",
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
            _state.value = _state.value.copy(busy = false, error = failure)
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
                        error = cause.userMessage().ifBlank { action.fallback },
                    )
                }
            }
        }
    }
}

private enum class AuthScreen { Login, SignUp, Forgot }

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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .imePadding()
            .padding(horizontal = 24.dp)
            .padding(top = 18.dp, bottom = 24.dp),
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

/** Text wordmark: 'Loonext' with the 'ext' half in olive (no logo glyph). */
@Composable
private fun Wordmark() {
    Row {
        val style = MaterialTheme.typography.titleLarge.copy(
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.02).em,
        )
        Text("Loon", style = style, color = MaterialTheme.colorScheme.onBackground)
        Text("ext", style = style, color = MaterialTheme.colorScheme.secondary)
    }
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
            "or",
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
                        contentDescription = if (showPassword) "Hide password" else "Show password",
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
    error: String?,
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
        title = "Your number. One inbox.\nThe whole crew.",
        body = "Texts, calls, and the jobs that come from them, together in one inbox.",
    )
    Spacer(Modifier.height(26.dp))
    SsoBlock(busy = busy, onGoogle = onGoogle)
    AuthField(
        label = "Work email",
        value = email,
        onValueChange = { email = it },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
    )
    Spacer(Modifier.height(12.dp))
    AuthField(
        label = "Password",
        value = password,
        onValueChange = { password = it },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        isPassword = true,
    )
    ErrorLine(error)
    Spacer(Modifier.height(14.dp))
    InkPillButton(
        text = if (busy) "Signing in…" else "Sign in",
        enabled = !busy && email.isNotBlank() && password.isNotBlank(),
        onClick = { onSubmit(email, password) },
    )
    Spacer(Modifier.height(10.dp))
    Text(
        "Forgot password?",
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
    FooterLink("New to Loonext?", "Create your account", onClick = onSignUp)
}

@Composable
private fun SignUpForm(
    busy: Boolean,
    error: String?,
    confirmationSent: Boolean,
    onSubmit: (String, String, String) -> Unit,
    onGoogle: () -> Unit,
    onLogin: () -> Unit,
) {
    BackCircle(contentDescription = "Back to sign in", onClick = onLogin)
    Spacer(Modifier.height(26.dp))

    if (confirmationSent) {
        Headline(title = "Check your email", body = null)
        Spacer(Modifier.height(16.dp))
        SuccessBanner("Confirm your account from the email we just sent, then sign in.")
        Spacer(Modifier.height(18.dp))
        FooterLink("Done confirming?", "Back to sign in", onClick = onLogin)
        return
    }
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    Headline(
        title = "Create your account",
        body = "Your business number in minutes.",
    )
    Spacer(Modifier.height(24.dp))
    SsoBlock(busy = busy, onGoogle = onGoogle)
    AuthField(
        label = "Your name",
        value = name,
        onValueChange = { name = it },
    )
    Spacer(Modifier.height(12.dp))
    AuthField(
        label = "Work email",
        value = email,
        onValueChange = { email = it },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
    )
    Spacer(Modifier.height(12.dp))
    AuthField(
        label = "Password",
        value = password,
        onValueChange = { password = it },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        isPassword = true,
        helper = "At least 8 characters.",
    )
    ErrorLine(error)
    Spacer(Modifier.height(14.dp))
    InkPillButton(
        text = if (busy) "Creating account…" else "Create account",
        enabled = !busy && name.isNotBlank() && email.isNotBlank() && password.length >= 8,
        onClick = { onSubmit(name, email, password) },
    )
    Spacer(Modifier.height(12.dp))
    Text(
        "By continuing you agree to the Terms and the Acceptable Use Policy.",
        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, lineHeight = 16.5.sp),
        color = MaterialTheme.colorScheme.outline,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(14.dp))
    FooterLink("Already have an account?", "Sign in", onClick = onLogin)
}

@Composable
private fun ForgotForm(
    busy: Boolean,
    error: String?,
    resetSent: Boolean,
    onSubmit: (String) -> Unit,
    onLogin: () -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }

    BackCircle(contentDescription = "Back to sign in", onClick = onLogin)
    Spacer(Modifier.height(26.dp))
    Headline(
        title = "Reset your password",
        body = "We'll email you a reset link. It works for an hour.",
    )
    Spacer(Modifier.height(24.dp))
    AuthField(
        label = "Work email",
        value = email,
        onValueChange = { email = it },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
    )
    ErrorLine(error)
    Spacer(Modifier.height(14.dp))
    InkPillButton(
        text = if (busy) "Sending…" else "Send reset link",
        enabled = !busy && email.isNotBlank(),
        onClick = { onSubmit(email) },
    )
    if (resetSent) {
        Spacer(Modifier.height(12.dp))
        SuccessBanner(
            if (email.isBlank()) {
                "If that email has an account, a reset link is on its way. Didn't get it? Check spam."
            } else {
                "Link sent to $email (if it has an account). Didn't get it? Check spam."
            },
        )
    }
    Spacer(Modifier.height(18.dp))
    FooterLink("Remembered it?", "Back to sign in", onClick = onLogin)
}

@Composable
private fun ErrorLine(error: String?) {
    if (error != null) {
        Spacer(Modifier.height(10.dp))
        Text(
            error,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
        )
    }
}

package com.loonext.android.features.auth

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
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
 * The signed-out surface: login / signup / forgot-password, one calm column.
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

    if (state.awaitingCaptcha) {
        CaptchaSheet(onResult = viewModel::onCaptchaResult)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(horizontal = 28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Wordmark()
        Spacer(Modifier.height(32.dp))
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

/** Text wordmark: 'Loonext' with the 'ext' half in petrol (no logo glyph). */
@Composable
private fun Wordmark() {
    Row {
        Text(
            "Loon",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            "ext",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

/** SSO above the email form (mirrors the web's §1.7 front-door layout). */
@Composable
private fun SsoBlock(busy: Boolean, onGoogle: () -> Unit) {
    GoogleSignInButton(busy = busy, onClick = onGoogle)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
    ) {
        HorizontalDivider(Modifier.weight(1f))
        Text(
            "or",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        HorizontalDivider(Modifier.weight(1f))
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

    SsoBlock(busy = busy, onGoogle = onGoogle)
    OutlinedTextField(
        value = email,
        onValueChange = { email = it },
        label = { Text("Email") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(
        value = password,
        onValueChange = { password = it },
        label = { Text("Password") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth(),
    )
    ErrorLine(error)
    Spacer(Modifier.height(16.dp))
    Button(
        onClick = { onSubmit(email, password) },
        enabled = !busy && email.isNotBlank() && password.isNotBlank(),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(if (busy) "Signing in…" else "Sign in")
    }
    TextButton(onClick = onForgot) { Text("Forgot password?") }
    TextButton(onClick = onSignUp) { Text("New to Loonext? Create an account") }
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
    if (confirmationSent) {
        Text(
            "Check your email to confirm your account, then sign in.",
            style = MaterialTheme.typography.bodyLarge,
        )
        TextButton(onClick = onLogin) { Text("Back to sign in") }
        return
    }
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    SsoBlock(busy = busy, onGoogle = onGoogle)
    OutlinedTextField(
        value = name,
        onValueChange = { name = it },
        label = { Text("Your name") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(
        value = email,
        onValueChange = { email = it },
        label = { Text("Email") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(
        value = password,
        onValueChange = { password = it },
        label = { Text("Password (8+ characters)") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth(),
    )
    ErrorLine(error)
    Spacer(Modifier.height(16.dp))
    Button(
        onClick = { onSubmit(name, email, password) },
        enabled = !busy && name.isNotBlank() && email.isNotBlank() && password.length >= 8,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(if (busy) "Creating account…" else "Create account")
    }
    TextButton(onClick = onLogin) { Text("Already have an account? Sign in") }
}

@Composable
private fun ForgotForm(
    busy: Boolean,
    error: String?,
    resetSent: Boolean,
    onSubmit: (String) -> Unit,
    onLogin: () -> Unit,
) {
    if (resetSent) {
        Text(
            "If that email has an account, a reset link is on its way.",
            style = MaterialTheme.typography.bodyLarge,
        )
        TextButton(onClick = onLogin) { Text("Back to sign in") }
        return
    }
    var email by rememberSaveable { mutableStateOf("") }
    OutlinedTextField(
        value = email,
        onValueChange = { email = it },
        label = { Text("Email") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        modifier = Modifier.fillMaxWidth(),
    )
    ErrorLine(error)
    Spacer(Modifier.height(16.dp))
    Button(
        onClick = { onSubmit(email) },
        enabled = !busy && email.isNotBlank(),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(if (busy) "Sending…" else "Send reset link")
    }
    TextButton(onClick = onLogin) { Text("Back to sign in") }
}

@Composable
private fun ErrorLine(error: String?) {
    if (error != null) {
        Spacer(Modifier.height(8.dp))
        Text(
            error,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
        )
    }
}

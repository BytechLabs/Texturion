package com.loonext.android.features.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
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
)

class AuthViewModel(private val authManager: AuthManager) : ViewModel() {
    private val _state = MutableStateFlow(AuthUiState())
    val state: StateFlow<AuthUiState> = _state

    fun signIn(email: String, password: String) = run("Sign-in failed.") {
        authManager.signIn(email.trim(), password)
    }

    fun signUp(name: String, email: String, password: String) = run("Sign-up failed.") {
        val signedIn = authManager.signUp(email.trim(), password, name.trim())
        if (!signedIn) _state.value = _state.value.copy(confirmationSent = true)
    }

    fun sendReset(email: String) = run("Couldn't send the reset email.") {
        authManager.sendPasswordReset(email.trim())
        _state.value = _state.value.copy(resetSent = true)
    }

    private fun run(fallback: String, block: suspend () -> Unit) {
        if (_state.value.busy) return
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                block()
                _state.value = _state.value.copy(busy = false)
            } catch (cause: Exception) {
                _state.value = _state.value.copy(
                    busy = false,
                    error = cause.userMessage().ifBlank { fallback },
                )
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
                onForgot = { screen = AuthScreen.Forgot },
                onSignUp = { screen = AuthScreen.SignUp },
            )

            AuthScreen.SignUp -> SignUpForm(
                busy = state.busy,
                error = state.error,
                confirmationSent = state.confirmationSent,
                onSubmit = viewModel::signUp,
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
    androidx.compose.foundation.layout.Row {
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

@Composable
private fun LoginForm(
    busy: Boolean,
    error: String?,
    onSubmit: (String, String) -> Unit,
    onForgot: () -> Unit,
    onSignUp: () -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

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

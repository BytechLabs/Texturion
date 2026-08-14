package com.loonext.android.core.i18n

/**
 * #228 — the FRONT DOOR, in both languages: sign in, create an account, reset a
 * password, and every way those three can fail.
 *
 * This is the one screen in the app that a person meets before they have told us
 * anything, including which language they read. It is therefore the screen with
 * the least excuse for being English-only and, until this file existed, the only
 * one that was entirely so — a Montreal owner's first minute with the product was
 * 43 English words, and then a French app.
 *
 * ## Where the French came from
 *
 * Web translated this same door first. Its French is copied here CHARACTER FOR
 * CHARACTER from `apps/web/src/i18n/sections/onboarding.ts` wherever the two
 * clients say the same thing — "Mot de passe oublié ?", "Créer le compte",
 * "Vérifiez vos courriels", "Envoyer le lien de réinitialisation". Two clients
 * each having a go at "Forgot password?" is how a product ends up with two names
 * for one link, and the person who notices is the one using both.
 *
 * The handful of sentences web has no counterpart for — the phone's own headline,
 * the browser-launch failures that only exist because Android hands OAuth to an
 * external browser — are written in the same register: Quebec French,
 * VOUVOIEMENT, accents spelled normally.
 *
 * ## The headline
 *
 * `auth.loginTitle` is the product's tagline, and it is load-bearing in a way the
 * others are not: the crew can run SEVERAL numbers, so the claim is "one INBOX",
 * never "one number". The French keeps the inbox singular and leaves the number
 * possessive for the same reason. Product names (Loonext, Google) are never
 * translated.
 */
object AuthStrings : AppStrings.Section {
    override val en = mapOf(
        // ── Sign in ──────────────────────────────────────────────────────────
        "auth.loginTitle" to "Your number. One inbox.\nThe whole crew.",
        "auth.loginBody" to
            "Texts, calls, and the jobs that come from them, together in one inbox.",
        "auth.workEmail" to "Work email",
        "auth.password" to "Password",
        "auth.signIn" to "Sign in",
        "auth.signingIn" to "Signing in…",
        "auth.forgotPassword" to "Forgot password?",
        "auth.newToLoonext" to "New to Loonext?",
        "auth.createYourAccount" to "Create your account",
        "auth.continueWithGoogle" to "Continue with Google",
        "auth.or" to "or",
        "auth.showPassword" to "Show password",
        "auth.hidePassword" to "Hide password",
        "auth.backToSignIn" to "Back to sign in",

        // ── Sign up ──────────────────────────────────────────────────────────
        "auth.signUpTitle" to "Create your account",
        "auth.signUpBody" to "Your business number in minutes.",
        "auth.yourName" to "Your name",
        "auth.passwordHelper" to "At least 8 characters.",
        "auth.createAccount" to "Create account",
        "auth.creatingAccount" to "Creating account…",
        "auth.legal" to
            "By continuing you agree to the Terms and the Acceptable Use Policy.",
        "auth.alreadyHaveAccount" to "Already have an account?",

        // The screen after a successful sign-up, which is the whole reason the
        // account does not exist yet as far as the reader can tell.
        "auth.confirmTitle" to "Check your email",
        "auth.confirmBody" to
            "Confirm your account from the email we just sent, then sign in.",
        "auth.doneConfirming" to "Done confirming?",

        // ── Password reset ───────────────────────────────────────────────────
        "auth.resetTitle" to "Reset your password",
        "auth.resetBody" to "We'll email you a reset link. It works for an hour.",
        "auth.sendResetLink" to "Send reset link",
        "auth.sending" to "Sending…",
        "auth.rememberedIt" to "Remembered it?",
        // Two shapes because the address is only known when the person typed it
        // on this screen — arriving from a deep link, it is not ours to guess.
        "auth.resetSentGeneric" to
            "If that email has an account, a reset link is on its way. " +
            "Didn't get it? Check spam.",
        "auth.resetSentTo" to
            "Link sent to {email} (if it has an account). Didn't get it? Check spam.",

        // ── When it fails ────────────────────────────────────────────────────
        // Reached only when the server sent nothing a person could read; if it
        // sent a sentence, that sentence wins. See `AuthError` in AuthScreens.kt.
        "auth.signInFailed" to "Sign-in failed.",
        "auth.signUpFailed" to "Sign-up failed.",
        "auth.resetEmailFailed" to "Couldn't send the reset email.",
        "auth.captchaNeeded" to "Sign-in needs the security check.",
        "auth.googleFailed" to "Google sign-in failed. Try again.",
        "auth.googleUnfinished" to "Google sign-in didn't finish. Try again.",
        "auth.googleNoBrowser" to "No browser is available for Google sign-in.",
    )

    override val frCA = mapOf(
        // ── Sign in ──────────────────────────────────────────────────────────
        // The tagline. "Une boîte de réception" is the singular claim we make;
        // the number stays possessive, never counted.
        "auth.loginTitle" to "Votre numéro. Une boîte de réception.\nToute l'équipe.",
        "auth.loginBody" to
            "Les textos, les appels et les contrats qui en découlent, réunis " +
            "dans une seule boîte de réception.",
        "auth.workEmail" to "Courriel professionnel",
        "auth.password" to "Mot de passe",
        "auth.signIn" to "Se connecter",
        "auth.signingIn" to "Connexion…",
        "auth.forgotPassword" to "Mot de passe oublié ?",
        "auth.newToLoonext" to "Nouveau sur Loonext ?",
        "auth.createYourAccount" to "Créez votre compte",
        "auth.continueWithGoogle" to "Continuer avec Google",
        "auth.or" to "ou",
        "auth.showPassword" to "Afficher le mot de passe",
        "auth.hidePassword" to "Masquer le mot de passe",
        "auth.backToSignIn" to "Retour à la connexion",

        // ── Sign up ──────────────────────────────────────────────────────────
        "auth.signUpTitle" to "Créez votre compte",
        "auth.signUpBody" to "Votre numéro d'affaires en quelques minutes.",
        "auth.yourName" to "Votre nom",
        "auth.passwordHelper" to "Au moins 8 caractères.",
        "auth.createAccount" to "Créer le compte",
        "auth.creatingAccount" to "Création du compte…",
        "auth.legal" to
            "En continuant, vous acceptez les Conditions et la Politique " +
            "d'utilisation acceptable.",
        "auth.alreadyHaveAccount" to "Vous avez déjà un compte ?",

        "auth.confirmTitle" to "Vérifiez vos courriels",
        "auth.confirmBody" to
            "Confirmez votre compte à partir du courriel que nous venons " +
            "d'envoyer, puis connectez-vous.",
        "auth.doneConfirming" to "C'est confirmé ?",

        // ── Password reset ───────────────────────────────────────────────────
        "auth.resetTitle" to "Réinitialisez votre mot de passe",
        "auth.resetBody" to
            "Nous vous enverrons un lien de réinitialisation par courriel. " +
            "Il est valide pendant une heure.",
        "auth.sendResetLink" to "Envoyer le lien de réinitialisation",
        "auth.sending" to "Envoi…",
        "auth.rememberedIt" to "Vous vous en souvenez ?",
        "auth.resetSentGeneric" to
            "Si un compte existe pour ce courriel, un lien de réinitialisation " +
            "est en route. Vous ne l'avez pas reçu ? Vérifiez vos pourriels.",
        "auth.resetSentTo" to
            "Lien envoyé à {email} (si un compte existe). Vous ne l'avez pas " +
            "reçu ? Vérifiez vos pourriels.",

        // ── When it fails ────────────────────────────────────────────────────
        "auth.signInFailed" to "La connexion a échoué.",
        "auth.signUpFailed" to "La création du compte a échoué.",
        "auth.resetEmailFailed" to "Impossible d'envoyer le courriel de réinitialisation.",
        "auth.captchaNeeded" to "La connexion nécessite la vérification de sécurité.",
        "auth.googleFailed" to "La connexion avec Google a échoué. Réessayez.",
        "auth.googleUnfinished" to
            "La connexion avec Google ne s'est pas terminée. Réessayez.",
        "auth.googleNoBrowser" to
            "Aucun navigateur n'est disponible pour la connexion avec Google.",
    )
}

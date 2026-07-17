plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    // Generates the Firebase resources from google-services.json — the file
    // is client config (the same bits ship inside every APK), committed so CI
    // artifacts are push-enabled. The server-side service-account key is the
    // actual secret and never enters the repo.
    alias(libs.plugins.google.services)
}

android {
    namespace = "com.loonext.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.loonext.android"
        minSdk = 28
        targetSdk = 37
        versionCode = 1
        versionName = "1.0.0"

        // Public client-side values (same values the web bundle ships).
        buildConfigField("String", "API_URL", "\"https://api.loonext.com\"")
        buildConfigField(
            "String",
            "SUPABASE_URL",
            "\"https://qoruyuxcgkdqpcgclgzs.supabase.co\"",
        )
        buildConfigField(
            "String",
            "SUPABASE_PUBLISHABLE_KEY",
            "\"sb_publishable_iHmvcjwNRbHKk70eqIZS6w_c2ZLdbrL\"",
        )
    }

    buildTypes {
        // No debug applicationIdSuffix: Firebase registers com.loonext.android,
        // and google-services.json must match the built package name.
        debug {
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        optIn.add("androidx.compose.material3.ExperimentalMaterial3Api")
        optIn.add("androidx.compose.material3.ExperimentalMaterial3ExpressiveApi")
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.extended)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.telnyx.webrtc)
    // Initialized manually from BuildConfig when the founder provisions
    // Firebase (no google-services plugin) — no-ops gracefully until then.
    implementation(libs.firebase.messaging)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.compose.ui.tooling.preview)

    testImplementation(libs.junit)
    testImplementation(libs.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
}

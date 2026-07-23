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
    // Fleet crash reporting (#169): crashes + recorded non-fatals upload to
    // the Firebase console automatically. Free-unlimited; complements the
    // on-device crash file + share sheet (#168), which also works offline.
    alias(libs.plugins.crashlytics)
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
    // Jetpack Telecom (#171): CallsManager.addCall + CallControlScope — the OS
    // owns presentation + audio for every registered call.
    implementation(libs.androidx.core.telecom)
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
    // Tasks Map view (#184): osmdroid renders standard OSM raster tiles (the
    // same tile source the web map island uses) inside an AndroidView. No API
    // key, no Play Services. Tile policy compliance (user agent + attribution)
    // is handled at the MapView call site (features/tasks/TaskMap.kt).
    implementation("org.osmdroid:osmdroid-android:6.1.20")
    implementation(libs.telnyx.webrtc)
    // Initialized manually from BuildConfig when the founder provisions
    // Firebase (no google-services plugin) — no-ops gracefully until then.
    implementation(libs.firebase.messaging)
    implementation(libs.firebase.crashlytics)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.compose.ui.tooling.preview)

    testImplementation(libs.junit)
    testImplementation(libs.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
}

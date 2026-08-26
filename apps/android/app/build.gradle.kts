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

/**
 * Google Play REJECTS any upload whose versionCode is not strictly greater than
 * the last one it accepted, so a hardcoded `1` lets exactly ONE build ever ship.
 * CI passes the git commit count (`-PloonextVersionCode=$(git rev-list --count
 * HEAD)`) — monotonic by construction, needs no stored state, and never collides
 * across branches the way a manually-bumped number does. Local builds fall back
 * to 1; they are never uploaded.
 *
 * Read through `providers` (not a raw `project.property`) so the values stay
 * configuration-cache safe.
 */
val loonextVersionCode = providers.gradleProperty("loonextVersionCode")
    .orNull?.toIntOrNull() ?: 1
val loonextVersionName = providers.gradleProperty("loonextVersionName")
    .orNull ?: "0.16.0" // x-release-please-version

android {
    namespace = "com.loonext.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.loonext.android"
        minSdk = 28
        targetSdk = 37
        versionCode = loonextVersionCode
        versionName = loonextVersionName

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
        // #428: the Map's basemap. EMPTY on purpose. osmdroid's default source is
        // TileSourceFactory.MAPNIK, which is tile.openstreetmap.org — the OSMF's
        // donated infrastructure, and their Tile Usage Policy does not license a
        // paid product to serve it. With these blank the map draws pins on an
        // empty ground instead of falling back to somebody else's goodwill.
        // Filling them in is the whole configuration; see docs/MAP-TILES.md.
        buildConfigField("String", "MAP_TILE_URL", "\"\"")
        buildConfigField("String", "MAP_TILE_ATTRIBUTION", "\"\"")
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
        // #524: Robolectric renders the real composables, so it needs the real
        // merged manifest and the real resource table. Without this the Compose
        // test rule cannot launch its host activity at all.
        unitTests.isIncludeAndroidResources = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        optIn.add("androidx.compose.material3.ExperimentalMaterial3Api")
        optIn.add("androidx.compose.material3.ExperimentalMaterial3ExpressiveApi")
        // #180: calculateWindowSizeClass / calculateFromSize are still experimental.
        optIn.add("androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi")
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    // #330: the app lock for a phone that gets handed to whoever is covering
    // the weekend. BiometricPrompt also offers the device credential, so a
    // phone with a PIN and no fingerprint is still protectable.
    implementation(libs.androidx.biometric)
    // #473: passkeys as a second factor. Credential Manager owns the sheet, so
    // the ceremony is the platform's and this app never touches a private key.
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)
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
    implementation(libs.compose.material3.windowsize)
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
    // #524: press the control, then assert the effect happened. A source scan
    // can only ask whether a control LOOKS disabled, and every escape that has
    // shipped past this suite disabled it a way the scan had not been taught.
    testImplementation(libs.robolectric)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    // The empty activity `createAndroidComposeRule` launches lives in this
    // artifact's manifest, which only reaches the merged debug manifest from
    // `debugImplementation`.
    debugImplementation(libs.compose.ui.test.manifest)
}

// ---------------------------------------------------------------------------
// #607 A4 — the contracts this suite reads, declared as the inputs they are
// ---------------------------------------------------------------------------

/**
 * The trees `app/test-contract-inputs.txt` names, declared so that editing one
 * of them re-runs the tests that read it.
 *
 * The reasoning lives in that file, next to the list, because the list is the
 * part that has to be kept true. `TestContractInputsTest` reads the same file
 * and fails if a test reaches for a path it does not cover.
 */
val loonextRepoRoot: java.io.File = rootProject.projectDir.parentFile.parentFile

val loonextContractRoots: List<String> = layout.projectDirectory
    .file("test-contract-inputs.txt").asFile
    .readLines()
    .map { it.substringBefore('#').trim() }
    .filter { it.isNotEmpty() }

/**
 * An input that resolves to nothing is this bug wearing the fix's clothes: the
 * declaration is present, the hash is of an empty set, and the task goes
 * UP-TO-DATE exactly as before. So a moved or renamed root fails the BUILD here
 * rather than quietly restoring the defect — the same reason `check-open-lists`
 * skipping silently was worth fixing. A guard that can no-op has to say so.
 */
loonextContractRoots.forEach { path ->
    require(loonextRepoRoot.resolve(path).exists()) {
        "#607 A4: '$path' does not exist under $loonextRepoRoot. It is listed " +
            "in app/test-contract-inputs.txt because guards in app/src/test " +
            "read it, and an input that resolves to nothing puts " +
            ":app:testDebugUnitTest back to reporting the previous run's " +
            "answer. Re-point it, or delete the line and the guard together."
    }
}

tasks.withType<Test>().configureEach {
    inputs
        .files(loonextContractRoots.map { loonextRepoRoot.resolve(it) })
        .withPropertyName("loonextCrossLanguageContracts")
        // RELATIVE, not ABSOLUTE: the contents and the repo-relative paths are
        // what the guards read, so a CI checkout under a different directory
        // still hits the build cache.
        .withPathSensitivity(PathSensitivity.RELATIVE)

    // The list itself, so deleting a line re-runs the completeness check that
    // would object to it.
    inputs
        .file(layout.projectDirectory.file("test-contract-inputs.txt"))
        .withPropertyName("loonextContractInputManifest")
        .withPathSensitivity(PathSensitivity.RELATIVE)
}

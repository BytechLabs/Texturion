pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Telnyx WebRTC SDK is distributed via JitPack.
        maven("https://jitpack.io") {
            content { includeGroupByRegex("com\\.github\\.team-telnyx.*") }
        }
    }
}

rootProject.name = "loonext-android"
include(":app")

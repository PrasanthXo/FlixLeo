plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "cyou.flixleo.android"
    compileSdk = 35
    defaultConfig {
        applicationId = "cyou.flixleo.android"
        minSdk = 24
        targetSdk = 35
        versionCode = (project.findProperty("flixleoVersionCode")?.toString()?.toIntOrNull() ?: 6)
        versionName = project.findProperty("flixleoVersionName")?.toString() ?: "1.5.0-native"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }
    signingConfigs {
        create("flixleoRelease") {
            val keystore = System.getenv("FLIXLEO_KEYSTORE_PATH")
            if (!keystore.isNullOrBlank()) {
                storeFile = file(keystore)
                storePassword = System.getenv("FLIXLEO_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("FLIXLEO_KEY_ALIAS")
                keyPassword = System.getenv("FLIXLEO_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (!System.getenv("FLIXLEO_KEYSTORE_PATH").isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("flixleoRelease")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
    packaging { jniLibs { useLegacyPackaging = true } }
}
dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.videolan.android:libvlc-all:3.6.5")
}

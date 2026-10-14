plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "cyou.flixleo.android"
    compileSdk = 35
    defaultConfig {
        applicationId = "cyou.flixleo.android"
        minSdk = 24
        targetSdk = 35
        versionCode = 2
        versionName = "1.1.0"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    packaging { jniLibs { useLegacyPackaging = true } }
}

dependencies {
    // Native VLC decodes formats Android WebView commonly cannot (AC-3,
    // E-AC-3, DTS, MKV audio) and exposes embedded audio/subtitle tracks.
    implementation("org.videolan.android:libvlc-all:3.6.5")
}

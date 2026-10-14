# FlixLeo native Android Studio application (Kotlin)

This is a **fully native Android application**. The main activity uses **Jetpack Compose**. It does **not** load a website in WebView, React, Capacitor or an iframe.

## Open in Android Studio (Windows)
1. Clone the GitHub repository, checking out `feature/flixleo-fully-native-android-20261014`.
2. Android Studio → **Open** → select the repository's `android-native` folder (not the repository root).
3. Let Gradle sync with **JDK 17** and **Android SDK Platform 35**.
4. Run the `app` configuration on an Android ARM64 / ARM32 phone (Android 7.0 or later), or **Build → Build APK(s)**.

From PowerShell inside `android-native` with JDK 17 / Gradle 8.10.2 installed:

```powershell
gradle --no-daemon :app:assembleDebug
```

APK output: `android-native/app/build/outputs/apk/debug/app-debug.apk`.
CI workflow: `.github/workflows/build-flixleo-android.yml`.

## Native screens and capabilities

- Native Home with mixed perspective carousel, Continue Watching, For You language choices, genres, language catalogues and provider rows.
- Native Movies / Series, title details, seasons/episodes, debounced movie + series search.
- Native PlavioHD Live TV categories, stream-quality/server selection.
- Native watchlist and resume progress kept locally even without a cloud account.
- Embedded **LibVLC** with audio language and embedded subtitle selection, aspect ratio, seek, fullscreen and end-of-episode progression. External VLC is not needed.
- Native accounts with email verification and password reset, cloud watchlist/history sync, native profile preferences, list/revoke approved TV devices and enter a pairing ID, and update gateway checks.
- UI uses Kotlin, Jetpack Compose, AndroidX, Coil and libVLC. No WebView.

Existing production FlixLeo catalogue APIs `/api/tmdb/*` and `/api/stremio/*` are reused. The optional **native sign-in/cloud routes** at `/api/native/*` are added in `server/nativeMobileApi.ts` and require the updated backend to be **deployed** before sign-in works. No production credentials are embedded in the APK; the server uses the **anon** Supabase API key with verified user JWTs and RLS. Sessions are encrypted locally using Android Keystore AES-GCM.

## Current release status

`versionCode=3`, `versionName=1.2.0-native`. CI artifacts use a **debug signing key** and must not be advertised as stable installs or update-gateway download targets. For production, use an existing/reusable signing certificate and configure **release signing** securely. The app may not upgrade over an APK with a different signing certificate without uninstalling and losing local app data.

CI compilation and APK packaging alone are not physical-device video tests. Test all player controls, native catalogue/API availability, episode progression, auth, TV pairing and accessibility on Android devices before distribution. Metadata from TMDB is not a guarantee of source availability. DRM content and provider-restricted links may not play.

Licensing: libVLC is VideoLAN software (LGPL-2.1-or-later); review and ship necessary license/codec notices for redistribution.

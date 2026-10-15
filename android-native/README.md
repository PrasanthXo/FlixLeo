# FlixLeo native Android Studio application (Kotlin)

This is a **fully native Android application**. The main activity uses **Jetpack Compose**. It does **not** load a website in WebView, React, Capacitor or an iframe.

## Open in Android Studio (Windows)
1. Clone the GitHub repository, checking out `feature/flixleo-fully-native-android-20261014`.
2. Android Studio → **Open** → select the repository's `android-native` folder (not the repository root).
3. Let Gradle sync with **JDK 17** and **Android SDK Platform 35**. The Gradle 8.10.2 wrapper is included (`gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`).
4. Run the `app` configuration on an Android ARM64 / ARM32 phone (Android 7.0 or later), or **Build → Build APK(s)**.

From PowerShell inside `android-native` with JDK 17 / Gradle 8.10.2 installed:

```powershell
.\\gradlew.bat --no-daemon :app:assembleDebug
```

APK output: `android-native/app/build/outputs/apk/debug/app-debug.apk`.
CI workflow: `.github/workflows/build-flixleo-android.yml`.

## Native screens and capabilities

- Native Home with mixed perspective carousel, Continue Watching, For You language choices, genres, language catalogues and provider rows.
- Native Movies / Series, title details, seasons/episodes, debounced movie + series search.
- Native PlavioHD Live TV categories, stream-quality/server selection. Native video includes Android 8+ Picture-in-Picture mini player.
- Native watchlist and resume progress kept locally even without a cloud account.
- Embedded **LibVLC** with audio language and embedded subtitle selection, aspect ratio, seek, fullscreen and end-of-episode progression. External VLC is not needed.
- Native accounts with email verification and password reset, cloud watchlist/history sync, native profile preferences, list/revoke approved TV devices and enter a pairing ID, and update gateway checks.
- UI uses Kotlin, Jetpack Compose, AndroidX, Coil and libVLC. No WebView.

Existing production FlixLeo catalogue APIs `/api/tmdb/*` and `/api/stremio/*` are reused. The optional **native sign-in/cloud routes** at `/api/native/*` are added in `server/nativeMobileApi.ts` and require the updated backend to be **deployed** before sign-in works. No production credentials are embedded in the APK; the server uses the **anon** Supabase API key with verified user JWTs and RLS. Sessions are encrypted locally using Android Keystore AES-GCM.

## Current release status

`versionCode=3`, `versionName=1.2.0-native`. CI artifacts use a **debug signing key** and must not be advertised as stable installs or update-gateway download targets. For production, use an existing/reusable signing certificate and configure **release signing** securely. The app may not upgrade over an APK with a different signing certificate without uninstalling and losing local app data.

CI compilation and APK packaging alone are not physical-device video tests. Test all player controls, native catalogue/API availability, episode progression, auth, TV pairing and accessibility on Android devices before distribution. Metadata from TMDB is not a guarantee of source availability. DRM content and provider-restricted links may not play.

Licensing: libVLC is VideoLAN software (LGPL-2.1-or-later); review and ship necessary license/codec notices for redistribution.


## Native player: big ↔ mini ↔ fullscreen (v1.3.0)

Selecting an HTTPS stream opens the **big player** inside the native Android app, with video at the top and source/quality options underneath. **Scroll down** until the video leaves view, or tap **Mini player**, to float a playable mini view above the Android bottom navigation. It stays playing while switching Home/Movies/Series/Live TV/Search/Profile. Mini controls: pause/play, return to big, fullscreen, close/stop.

Tap **Fullscreen** or double-tap the video for immersive landscape playback. Playback controls automatically disappear after 4.5 seconds; tap to bring them back. Controls include Play/Pause, ±10 sec, seek, audio tracks, subtitle tracks, original/16:9/4:3/21:9 aspect ratios, minimize, and close. Back leaves fullscreen and returns to the previous big/mini view, rather than stopping playback. All three layouts keep **the same LibVLC player and same VLCVideoLayout**; changing UI size should not restart streams.

When Android is put into the background while playing, Android 8+ Picture-in-Picture is requested so the video may continue as an OS-level floating window. Returning to FlixLeo restores the previous view. Close or leave the in-app mini player to stop video and persist progress. On the end of a TV episode, FlixLeo saves completion and attempts the next episode.

Android Studio source: open this `android-native/` folder. VersionCode 4 / v1.3.0-native is a **debug/test build**, not a production signed release. Test video compatibility, rotation, PiP, controls and continuity on a physical device before publishing. The website, iOS, TV web and Windows EXE are not changed by this player work.

## Session recovery rebuild — 2026-10-15

Rebuild Android debug APK after the native session-recovery fix: temporary token refresh failures no longer delete the saved login session. Server-side refresh failures also distinguish temporary service outages from expired credentials. This CI build is debug-signed and is not a production signed release.

## Infinite-scroll APK build — 2026-10-15

This Android debug build includes native Movies and Series end-of-list pagination (commit d4be659), alongside the session recovery fix. Build with the existing GitHub Actions Android workflow. This is a CI debug-signed APK and may be incompatible with previously installed builds signed using another certificate; do not uninstall a user's existing app to force an update.

# FlixLeo Android — Native VLC app

This Android app keeps the live **flixleo.cyou** catalogue, account, search, watchlist, TV and update gateway, with in-app native LibVLC playback for direct HTTPS streams. No separate VLC installation is needed.

The native fullscreen player provides play/pause, 10-second skipping, a seek bar, audio language selection, embedded subtitles and aspect ratio. Returning to the catalogue saves Continue Watching progress; when an episode ends, the website can advance to the next one.

## Build
GitHub Actions > **Build FlixLeo Android APK** > **Run workflow**. Select your branch, wait for success, and download **FlixLeo-Android-debug-APK**. Extract app-debug.apk and install it on Android 7 or later (ARM32/ARM64).

For a local build, install JDK 17, Android SDK 35 and Gradle 8.10.2, then run:

```sh
cd android-native
gradle --no-daemon :app:assembleDebug
```

The APK is generated at `android-native/app/build/outputs/apk/debug/app-debug.apk`.

## Release security
Debug APKs are signed with development keys. Because CI runners can generate different debug keys, these APKs may not update each other in place. Production releases need a persistent, private keystore and release signing configuration. Do not publish an APK to website download spots or turn on forced updates before testing installation and signing. Android versionCode is 2 (1.1.0); the existing update gateway remains in place.

Player handoff is limited to the FlixLeo WebView and HTTPS streams. Chrome, iPhone/iPad/Mac and Windows keep their existing player behavior. DRM, provider blocks and individual codec support still depend on source and device. LibVLC is a VideoLAN project licensed under LGPL-2.1-or-later; include applicable notices and review distribution obligations before store publication.

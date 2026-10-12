# FlixLeo Android
Android WebView-based native shell for https://flixleo.cyou. Existing accounts, catalogue and streaming still depend on the live website. Browser video rendering and codec support remain subject to Android WebView limitations.
Android VLC Play uses the existing intent:// integration; installing VLC for Android is required.
Build from GitHub Actions > Build FlixLeo Android APK > Run workflow. Download the APK artifact and install on Android 7+.
This first build is **debug signed** and not suitable for Play Store production publication. Keep a stable release keystore for future signed updates.

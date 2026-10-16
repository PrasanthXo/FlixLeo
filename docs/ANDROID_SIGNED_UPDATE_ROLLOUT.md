# FlixLeo Android signed-update rollout runbook

Last validated by an actual Android user receiving an update notice: 2026-10-16.

## Golden rule
**Do not rebuild an already-signed APK to fix delivery.** Preserve its version code, binary and signing certificate. Never modify Windows or other application update policies for an Android-only rollout.

## Working delivery chain
1. Use the existing signed APK from private repository `PrasanthXo/FlixLeo-Android-Releases`, tag e.g. `android-v1.6.15`. Match exact asset `FlixLeo-Android-v1.6.15-signed.apk`.
2. Verify ZIP integrity and APK signature with Android SDK build-tools `apksigner verify`. Check the APK is the correct full-sized native release; preserve the signing key.
3. Publish those **same bytes** to the public repository `PrasanthXo/FlixLeo` under the **same tag and asset name**, using the existing release workflow/token `FLIXLEO_PUBLIC_RELEASE_TOKEN`. Do not overwrite an existing public signed APK silently.
4. Confirm the public GitHub Release asset is downloadable without authentication.
5. Backend `server/updateGateway.ts` detects signed `android-v1.6.N` releases and compares **Android version codes** (1.6.N => `100000 + N`), not publication order. Public GitHub API can time out/rate-limit; for the *already publicly verified* v1.6.15, the code includes a fallback with versionName `1.6.15`, versionCode `100015`, and public download URL. Keep the fallback current **only after** the replacement signed release is public and verified.
6. `server/landingRoutes.ts` `/api/download/android` must also recognize the v1.6 signed APK, not only v1.5. This route and the gateway are separate and both must be checked.
7. Confirm the backend fix commits are **actually live on Render**, not merely committed to GitHub. Service `flixleo` / `srv-db5aijvlk1mc739alrdg`; repo branch `main`. Inspect deploy commit and status `live`.
8. Verify live `https://flixleo.cyou/api/gateway/v1/check/flixleo-android?versionCode=1014` returns `policy.latestVersionName: "1.6.15"`, `latestVersionCode: 100015`, `updateAvailable: true`, and a valid public signed APK URL. For forced updates, only enable `forceUpdate` after public URL and installation are verified.
9. Existing native Android apps run a gateway check on foreground/open via `MainActivity.kt` and show the update notice if the version is newer **and the update URL starts with https and ends in .apk before query parameters**. Allow time for deploy and 2-minute release cache, reopen the app, and verify on-device.
10. Record delivery as **confirmed only when a phone actually receives the notice**, not when workflow/build/deploy alone succeeds.

## 2026-10-16 incident: real cause and fix
- The signed v1.6.15 APK **already existed**. Creating new signed builds was unnecessary.
- The public signed asset was available; GitHub Actions publication job fetched the private asset, verified v2 signature, found the matching public asset, and successfully fetched it.
- However, the live Android gateway response was still `latestVersionName=1.5.14`, `latestVersionCode=1014`, `updateAvailable=false`.
- Root cause: backend public release discovery could not select the new v1.6.15 in that live environment and fell back to hardcoded v1.5.14. Also, `/api/download/android` originally filtered to only v1.5 release tags.
- Fixed the Android download route in commit `fd6c008`. Fixed v1.6.15 gateway fallback and increased GitHub API release search range in commit `748df21`.
- **Critical operational error:** fixes were initially pushed to GitHub but Render was still running an older commit. Inspecting the deployment showed `748df21` building. After the corrected version became available, the user confirmed receiving the Android update notice.
- An auxiliary publication workflow initially failed due to SDK tooling setup; do not assume such a failure implies a missing APK. Inspect the **exact failed job logs**, not the workflow name. Known logs: run `38922093534`, job `117044325469`, which proved the APK was published and specifically exposed the old gateway policy.
- Do not conflate `notices: []` with a missing version update: inspect `policy.updateAvailable` and `policy.latestVersionCode` first.

## Before the NEXT Android update
Check current native `versionCode`, existing signing certificate, public tag and file availability, gateway policy, live Render SHA, and on-device receipt, **in that order**. Avoid a second build, unnecessary new workflow, premature forced update, and changing unrelated platforms.

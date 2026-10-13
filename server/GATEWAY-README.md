# Shared App Update Gateway

Hosted in the FlixLeo Express server. Supports flixleo-android, flixleo-windows, sabdham-android, sri-tunnel-android.

## Setup
1. Execute `server/sql/2026-10-12-app-gateway.sql` in the FlixLeo Supabase database SQL editor.
2. Set `GATEWAY_ADMIN_TOKEN` to a cryptographically random 32+ character secret in Render (never commit or embed it in apps).
3. Server must also have `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

Public: GET `/api/gateway/v1/check/flixleo-android?versionCode=1`.
Protected: GET `/api/gateway/v1/admin/apps`, PUT `/api/gateway/v1/admin/apps/:appId`, POST `/api/gateway/v1/admin/notices`, DELETE `/api/gateway/v1/admin/notices/:id`.

All admin requests require `Authorization: Bearer <GATEWAY_ADMIN_TOKEN>`.
Example PUT body:
```json
{"latestVersionCode":2,"minVersionCode":2,"latestVersionName":"1.1.0","forceUpdate":true,"maintenance":false,"updateUrl":"https://example.org/app.apk","releaseNotes":"Important security fix","maintenanceMessage":""}
```

An app enforces updates ONLY when its installed versionCode is below minVersionCode AND forceUpdate is true.
To avoid locking out users, publish and verify the replacement APK before raising minVersionCode.
This provides policy polling and notices; it does not send FCM remote push notifications. Remote push requires Firebase configuration, device token registration, topic permissions and an FCM sender. No credentials or FCM tokens should be publicly exposed.

## Resilient clients and production checks (2026-10-13)
- Public `GET /api/gateway/v1/health` reports whether DB/admin secrets are configured **without disclosing them**.
- Public checks return `ready:false` and a non-blocking policy if Supabase or its policies are missing. A 200 response with `ready:false` is **not** proof of a configured update gateway.
- Desktop EXE checks on startup and every six hours using its packaged version; update prompts require direct HTTPS `.exe` links.
- FlixLeo Android reads its actual installed versionCode and accepts only HTTPS `.apk` updates.
- Production setup still requires migration + all environment variables listed above; until then the gateway safely provides no updates. Never raise a minimum until the new signed binary exists.

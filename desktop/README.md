# FlixLeo Desktop (Windows)
This Electron shell opens the existing https://flixleo.cyou application with its existing account and catalogue.
Install VLC separately to enable external VLC playback from FlixLeo's streaming-server list.
Build on Windows: `npm install` then `npm run desktop:dist`.
GitHub Actions: **Build FlixLeo Windows App** → download **FlixLeo-Windows** artifact.
Unsigned installer: Windows SmartScreen may show a warning.
Stream URLs are not printed to the page or copied to the clipboard, but can still be observed in client networking and Windows process details. This is not DRM.

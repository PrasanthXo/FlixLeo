# FlixLeo Desktop (Windows)
This Electron shell opens the live https://flixleo.cyou website with the same signed-in account, movies, series, Live TV, and streaming catalogs. Windows EXE additionally displays the full web collection rows without altering other platforms.
Install VLC separately to enable external VLC playback from FlixLeo's streaming-server list.
Build on Windows: `npm install` then `npm run desktop:dist`. The build generates the Windows EXE icon from `public/flixleo-logo.svg`. The installer creates a **FlixLeo desktop shortcut** and Start Menu shortcut.
GitHub Actions: **Build FlixLeo Windows App** → download **FlixLeo-Windows** artifact.
Unsigned installer: Windows SmartScreen may show a warning.
Stream URLs are not printed to the page or copied to the clipboard, but can still be observed in client networking and Windows process details. This is not DRM.

Native player keyboard: **Esc** exits fullscreen, **Space** toggles play/pause, and **double-click** on the video enters/exits fullscreen. **F11** does not control fullscreen. The installer, taskbar, window, and shortcuts use the same FlixLeo brand icon.

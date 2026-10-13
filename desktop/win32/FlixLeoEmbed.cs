using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

internal static class FlixLeoEmbed {
    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr context);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr param);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)] static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)] static extern int GetWindowLong32(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] static extern IntPtr SetWindowLongPtr64(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)] static extern int SetWindowLong32(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; }
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }

    const int GWL_STYLE = -16;
    const long WS_CHILD = 0x40000000L, WS_POPUP = unchecked((long)0x80000000), WS_CAPTION = 0x00c00000L, WS_THICKFRAME = 0x00040000L;
    const uint SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010, SWP_FRAMECHANGED = 0x0020;
    static IntPtr WindowStyle(IntPtr hwnd) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, GWL_STYLE) : new IntPtr(GetWindowLong32(hwnd, GWL_STYLE)); }
    static void ChangeStyle(IntPtr hwnd, IntPtr style) {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, GWL_STYLE, style);
        else SetWindowLong32(hwnd, GWL_STYLE, style.ToInt32());
    }

    static int Main(string[] args) {
        long targetParent; int mpvPid;
        if (args.Length != 2 || !long.TryParse(args[0], out targetParent) || !int.TryParse(args[1], out mpvPid)) return 2;
        var parent = new IntPtr(targetParent);
        try {
            using (var process = Process.GetProcessById(mpvPid)) {
                IntPtr child = IntPtr.Zero;
                var deadline = DateTime.UtcNow.AddSeconds(45);
                while (DateTime.UtcNow < deadline && IsWindow(parent) && !process.HasExited) {
                    EnumWindows((hwnd, ctx) => {
                        uint pid;
                        GetWindowThreadProcessId(hwnd, out pid);
                        if (pid == (uint)mpvPid && IsWindowVisible(hwnd)) { child = hwnd; return false; }
                        return true;
                    }, IntPtr.Zero);
                    if (child != IntPtr.Zero) break;
                    Thread.Sleep(150);
                }
                if (child == IntPtr.Zero || !IsWindow(parent) || process.HasExited) return 3;
                long style = WindowStyle(child).ToInt64();
                style = (style | WS_CHILD) & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME);
                ChangeStyle(child, new IntPtr(style));
                SetLastErrorSafe();
                SetParent(child, parent);
                if (Marshal.GetLastWin32Error() != 0) return 4;
                ShowWindow(child, 5);
                Console.WriteLine("EMBEDDED");
                Console.Out.Flush();
                int px = 0, py = 0, pw = 1280, ph = 720;
                // mpv is a real HWND painted above Chromium; reserve the HTML
                // toolbar area only while the cursor has recently moved.
                int controlsHeight = 96;
                bool fullscreen = false;
                bool controlsVisible = false;
                int lastCursorX = int.MinValue, lastCursorY = int.MinValue;
                DateTime lastCursorMotion = DateTime.UtcNow;
                // Intercept double clicks over the child HWND. Chromium does not
                // receive mouse events that belong to this separate mpv process.
                // Use OS double-click time and movement limits, not arbitrary
                // web-player hit targets.
                const int VK_LBUTTON = 0x01, VK_ESCAPE = 0x1B, VK_SPACE = 0x20;
                const int VK_LEFT = 0x25, VK_UP = 0x26, VK_RIGHT = 0x27, VK_DOWN = 0x28;
                const int SM_CXDOUBLECLK = 36, SM_CYDOUBLECLK = 37;
                bool previousLeftDown = false;
                bool previousEscapeDown = false, previousSpaceDown = false;
                bool previousArrowLeft = false, previousArrowRight = false;
                bool previousArrowUp = false, previousArrowDown = false;
                DateTime firstClickAt = DateTime.MinValue;
                int firstClickX = 0, firstClickY = 0;
                // Avoid resizing the mpv child 40 times a second when neither
                // the Electron player rectangle nor toolbar state has changed.
                int appliedX = int.MinValue, appliedY = int.MinValue;
                int appliedW = int.MinValue, appliedH = int.MinValue;
                var updates = new System.Collections.Concurrent.ConcurrentQueue<string>();
                var reader = new Thread(() => {
                    try { string line; while ((line = Console.ReadLine()) != null) updates.Enqueue(line); }
                    catch {}
                });
                reader.IsBackground = true;
                reader.Start();
                while (IsWindow(parent) && IsWindow(child) && !process.HasExited) {
                    string line;
                    while (updates.TryDequeue(out line)) {
                        if (line == "FULLSCREEN") {
                            fullscreen = true;
                            controlsVisible = true;
                            lastCursorMotion = DateTime.UtcNow;
                            Console.WriteLine("CONTROLS_VISIBLE"); Console.Out.Flush();
                            continue;
                        }
                        if (line == "RESTORE") {
                            fullscreen = false;
                            controlsVisible = false;
                            Console.WriteLine("CONTROLS_HIDDEN"); Console.Out.Flush();
                            continue;
                        }
                        if (line.StartsWith("CONTROL_HEIGHT ", StringComparison.Ordinal)) {
                            int value;
                            if (int.TryParse(line.Substring("CONTROL_HEIGHT ".Length), out value))
                                controlsHeight = Math.Max(48, Math.Min(300, value));
                            continue;
                        }
                        var parts = line.Split(',');
                        int x, y, w, h;
                        if (parts.Length == 4 && int.TryParse(parts[0], out x) &&
                            int.TryParse(parts[1], out y) && int.TryParse(parts[2], out w) &&
                            int.TryParse(parts[3], out h)) {
                            px = Math.Max(0, x); py = Math.Max(0, y);
                            pw = Math.Max(1, w); ph = Math.Max(1, h);
                        }
                    }
                    int desiredX = px, desiredY = py, desiredW = pw, desiredH = ph;
                    Rect client;
                    if (fullscreen && GetClientRect(parent, out client)) {
                        Point cursor;
                        Rect parentRect;
                        if (GetCursorPos(out cursor) && GetWindowRect(parent, out parentRect)) {
                            bool inside = cursor.x >= parentRect.left && cursor.x < parentRect.right &&
                                cursor.y >= parentRect.top && cursor.y < parentRect.bottom;
                            bool moved = cursor.x != lastCursorX || cursor.y != lastCursorY;
                            lastCursorX = cursor.x; lastCursorY = cursor.y;
                            if (inside && moved) {
                                lastCursorMotion = DateTime.UtcNow;
                                if (!controlsVisible) {
                                    controlsVisible = true;
                                    Console.WriteLine("CONTROLS_VISIBLE"); Console.Out.Flush();
                                }
                            }
                            // A user operating the seek bar or menu must not lose it.
                            // Only active interaction holds the toolbar open.
                            // Merely parking the cursor near the controls should
                            // still let the pointer and controls fade out.
                            if (controlsVisible && (DateTime.UtcNow - lastCursorMotion).TotalMilliseconds > 3000) {
                                controlsVisible = false;
                                Console.WriteLine("CONTROLS_HIDDEN"); Console.Out.Flush();
                            }
                        }
                        desiredX = 0; desiredY = 0;
                        desiredW = Math.Max(1, Math.Min(client.right - client.left, pw));
                        desiredH = Math.Max(1, Math.Min(client.bottom - client.top - (controlsVisible ? controlsHeight : 0), ph));
                    }
                    if (appliedX != desiredX || appliedY != desiredY ||
                        appliedW != desiredW || appliedH != desiredH) {
                        SetWindowPos(child, IntPtr.Zero, desiredX, desiredY, desiredW, desiredH,
                            SWP_NOZORDER | SWP_NOACTIVATE);
                        appliedX = desiredX; appliedY = desiredY; appliedW = desiredW; appliedH = desiredH;
                    }

                    Point mouse;
                    Rect videoWindow;
                    bool leftDown = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
                    bool clickStart = leftDown && !previousLeftDown;
                    previousLeftDown = leftDown;
                    bool foreground = GetAncestor(GetForegroundWindow(), 2) == parent;
                    if (clickStart && foreground && GetCursorPos(out mouse) && GetWindowRect(child, out videoWindow) &&
                        mouse.x >= videoWindow.left && mouse.x < videoWindow.right &&
                        mouse.y >= videoWindow.top && mouse.y < videoWindow.bottom) {
                        var now = DateTime.UtcNow;
                        bool samePoint = Math.Abs(mouse.x - firstClickX) <= Math.Max(4, GetSystemMetrics(SM_CXDOUBLECLK)) &&
                            Math.Abs(mouse.y - firstClickY) <= Math.Max(4, GetSystemMetrics(SM_CYDOUBLECLK));
                        if (firstClickAt != DateTime.MinValue &&
                            (now - firstClickAt).TotalMilliseconds <= GetDoubleClickTime() && samePoint) {
                            firstClickAt = DateTime.MinValue;
                            Console.WriteLine("VIDEO_DOUBLE_CLICK"); Console.Out.Flush();
                        } else {
                            firstClickAt = now;
                            firstClickX = mouse.x; firstClickY = mouse.y;
                        }
                    }
                    // These keys are ignored by mpv's own bindings; the
                    // Electron host owns fullscreen and playback state.
                    bool escapeDown = (GetAsyncKeyState(VK_ESCAPE) & 0x8000) != 0;
                    bool spaceDown = (GetAsyncKeyState(VK_SPACE) & 0x8000) != 0;
                    bool focusedHere = GetAncestor(GetForegroundWindow(), 2) == parent;
                    if (focusedHere && fullscreen && escapeDown && !previousEscapeDown) {
                        Console.WriteLine("VIDEO_ESCAPE"); Console.Out.Flush();
                    }
                    if (focusedHere && spaceDown && !previousSpaceDown) {
                        Point keyCursor; Rect keyVideo;
                        bool cursorOverVideo = GetCursorPos(out keyCursor) && GetWindowRect(child, out keyVideo) &&
                            keyCursor.x >= keyVideo.left && keyCursor.x < keyVideo.right &&
                            keyCursor.y >= keyVideo.top && keyCursor.y < keyVideo.bottom;
                        if (fullscreen || cursorOverVideo) {
                            Console.WriteLine("VIDEO_SPACE"); Console.Out.Flush();
                        }
                    }
                    // Capture all four arrow keys while the native video
                    // is active. MPV's own arrow bindings are disabled by the
                    // host, avoiding duplicate seeks and volume changes.
                    bool arrowLeft = (GetAsyncKeyState(VK_LEFT) & 0x8000) != 0;
                    bool arrowRight = (GetAsyncKeyState(VK_RIGHT) & 0x8000) != 0;
                    bool arrowUp = (GetAsyncKeyState(VK_UP) & 0x8000) != 0;
                    bool arrowDown = (GetAsyncKeyState(VK_DOWN) & 0x8000) != 0;
                    if (focusedHere) {
                        Point keyCursor; Rect keyVideo;
                        bool cursorOverVideo = GetCursorPos(out keyCursor) && GetWindowRect(child, out keyVideo) &&
                            keyCursor.x >= keyVideo.left && keyCursor.x < keyVideo.right &&
                            keyCursor.y >= keyVideo.top && keyCursor.y < keyVideo.bottom;
                        if (fullscreen || cursorOverVideo) {
                            if (arrowLeft && !previousArrowLeft) { Console.WriteLine("VIDEO_LEFT"); Console.Out.Flush(); }
                            if (arrowRight && !previousArrowRight) { Console.WriteLine("VIDEO_RIGHT"); Console.Out.Flush(); }
                            if (arrowUp && !previousArrowUp) { Console.WriteLine("VIDEO_UP"); Console.Out.Flush(); }
                            if (arrowDown && !previousArrowDown) { Console.WriteLine("VIDEO_DOWN"); Console.Out.Flush(); }
                        }
                    }
                    previousArrowLeft = arrowLeft;
                    previousArrowRight = arrowRight;
                    previousArrowUp = arrowUp;
                    previousArrowDown = arrowDown;
                    previousEscapeDown = escapeDown;
                    previousSpaceDown = spaceDown;
                    // Sample at 40Hz so quick mouse clicks are not missed.
                    Thread.Sleep(25);
                }
                return 0;
            }
        } catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 5; }
    }

    // P/Invoke SetParent returns null for previously unparented top-level windows even on success.
    // SetLastError(0) allows the caller to distinguish that from an actual failure.
    [DllImport("kernel32.dll", EntryPoint = "SetLastError")] static extern void SetLastErrorSafe(uint code);
    static void SetLastErrorSafe() { SetLastErrorSafe(0); }
}

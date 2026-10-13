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
                bool fullscreen = false;
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
                        if (line == "FULLSCREEN") { fullscreen = true; continue; }
                        if (line == "RESTORE") { fullscreen = false; continue; }
                        var parts = line.Split(',');
                        int x, y, w, h;
                        if (parts.Length == 4 && int.TryParse(parts[0], out x) &&
                            int.TryParse(parts[1], out y) && int.TryParse(parts[2], out w) &&
                            int.TryParse(parts[3], out h)) {
                            px = Math.Max(0, x); py = Math.Max(0, y);
                            pw = Math.Max(1, w); ph = Math.Max(1, h);
                        }
                    }
                    Rect client;
                    if (fullscreen && GetClientRect(parent, out client))
                        SetWindowPos(child, IntPtr.Zero, 0, 0, Math.Max(1, client.right - client.left), Math.Max(1, client.bottom - client.top), SWP_NOZORDER | SWP_NOACTIVATE);
                    else
                        SetWindowPos(child, IntPtr.Zero, px, py, pw, ph, SWP_NOZORDER | SWP_NOACTIVATE);
                    Thread.Sleep(100);
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

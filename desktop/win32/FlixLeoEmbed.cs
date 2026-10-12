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
    static IntPtr WindowStyle(IntPtr hwnd) => IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, GWL_STYLE) : new IntPtr(GetWindowLong32(hwnd, GWL_STYLE));
    static void ChangeStyle(IntPtr hwnd, IntPtr style) {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, GWL_STYLE, style);
        else SetWindowLong32(hwnd, GWL_STYLE, style.ToInt32());
    }

    static int Main(string[] args) {
        if (args.Length != 2 || !long.TryParse(args[0], out long targetParent) || !int.TryParse(args[1], out int mpvPid)) return 2;
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
                while (IsWindow(parent) && IsWindow(child) && !process.HasExited) {
                    Rect rect;
                    if (GetClientRect(parent, out rect)) {
                        SetWindowPos(child, IntPtr.Zero, 0, 0, Math.Max(1, rect.right - rect.left),
                            Math.Max(1, rect.bottom - rect.top), SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
                    }
                    Thread.Sleep(250);
                }
                return 0;
            }
        } catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 5; }
    }

    // P/Invoke SetParent returns null for previously unparented top-level windows even on success.
    // SetLastError(0) allows the caller to distinguish that from an actual failure.
    [DllImport("kernel32.dll", EntryPoint = "SetLastError")] static extern void SetLastErrorSafe(uint code);
    static void SetLastErrorSafe() => SetLastErrorSafe(0);
}

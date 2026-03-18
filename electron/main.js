const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_ID = 'com.rybakic.mousejiggler';
const IS_WINDOWS = process.platform === 'win32';
const hasSingleInstanceLock = app.requestSingleInstanceLock();

const DEFAULT_SETTINGS = {
  enableMicroJiggle: false,
  enableKeypress: false,
  deviation: [4, 12],
  frequency: [700, 1400],
  smoothness: [6, 12],
  keypressInterval: [6000, 12000],
  enableScroll: false,
  scrollInterval: [7000, 13000],
  scrollAmount: [60, 160],
  enableClick: false,
  clickInterval: [8000, 15000],
  keepFocusOnTitle: true,
  focusInterval: [2500, 4500],
  cornerInterval: [2500, 4500],
  foregroundWindowTitle: '',
  enableCornerSmoothing: false,
};

const TRAY_ICON_FILES = {
  active: 'active.ico',
  disabled: 'disable.ico',
  fallback: 'icon.ico',
};

const state = {
  win: null,
  tray: null,
  jigglerProcess: null,
  isJigglerEnabled: false,
  isQuitting: false,
  settings: { ...DEFAULT_SETTINGS },
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  return Boolean(value);
}

function toNumber(value, fallback) {
  const numeric = Number(value);
  if (Number.isNaN(numeric) || !Number.isFinite(numeric)) {
    return fallback;
  }

  return numeric;
}

function normalizeRange(value, fallback, minLimit, maxLimit) {
  const raw = Array.isArray(value) ? value : [value, value];
  const fallbackMin = Array.isArray(fallback) ? fallback[0] : fallback;
  const fallbackMax = Array.isArray(fallback) ? fallback[1] : fallback;

  let min = clamp(Math.round(toNumber(raw[0], fallbackMin)), minLimit, maxLimit);
  let max = clamp(Math.round(toNumber(raw[1], fallbackMax)), minLimit, maxLimit);

  if (min > max) {
    [min, max] = [max, min];
  }

  return [min, max];
}

function areRangesEqual(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function sanitizeSettings(raw) {
  const input = raw ?? {};

  return {
    deviation: normalizeRange(input.deviation, DEFAULT_SETTINGS.deviation, 1, 100),
    frequency: normalizeRange(input.frequency, DEFAULT_SETTINGS.frequency, 100, 10000),
    smoothness: normalizeRange(input.smoothness, DEFAULT_SETTINGS.smoothness, 1, 20),
    keypressInterval: normalizeRange(input.keypressInterval, DEFAULT_SETTINGS.keypressInterval, 1000, 20000),
    enableScroll: toBoolean(input.enableScroll, DEFAULT_SETTINGS.enableScroll),
    scrollInterval: normalizeRange(input.scrollInterval, DEFAULT_SETTINGS.scrollInterval, 1500, 30000),
    scrollAmount: normalizeRange(input.scrollAmount, DEFAULT_SETTINGS.scrollAmount, 30, 360),
    enableClick: toBoolean(input.enableClick, DEFAULT_SETTINGS.enableClick),
    clickInterval: normalizeRange(input.clickInterval, DEFAULT_SETTINGS.clickInterval, 1500, 30000),
    keepFocusOnTitle: toBoolean(input.keepFocusOnTitle, DEFAULT_SETTINGS.keepFocusOnTitle),
    focusInterval: normalizeRange(input.focusInterval, DEFAULT_SETTINGS.focusInterval, 1000, 10000),
    cornerInterval: normalizeRange(input.cornerInterval, DEFAULT_SETTINGS.cornerInterval, 500, 10000),
    foregroundWindowTitle: String(input.foregroundWindowTitle ?? '').slice(0, 200),
    enableMicroJiggle: toBoolean(input.enableMicroJiggle, DEFAULT_SETTINGS.enableMicroJiggle),
    enableKeypress: toBoolean(input.enableKeypress, DEFAULT_SETTINGS.enableKeypress),
    enableCornerSmoothing: toBoolean(
      input.enableCornerSmoothing,
      DEFAULT_SETTINGS.enableCornerSmoothing,
    ),
  };
}

function areSettingsEqual(left, right) {
  return (
    areRangesEqual(left.deviation, right.deviation) &&
    areRangesEqual(left.frequency, right.frequency) &&
    areRangesEqual(left.smoothness, right.smoothness) &&
    areRangesEqual(left.keypressInterval, right.keypressInterval) &&
    left.enableScroll === right.enableScroll &&
    areRangesEqual(left.scrollInterval, right.scrollInterval) &&
    areRangesEqual(left.scrollAmount, right.scrollAmount) &&
    left.enableClick === right.enableClick &&
    areRangesEqual(left.clickInterval, right.clickInterval) &&
    left.keepFocusOnTitle === right.keepFocusOnTitle &&
    areRangesEqual(left.focusInterval, right.focusInterval) &&
    areRangesEqual(left.cornerInterval, right.cornerInterval) &&
    left.foregroundWindowTitle === right.foregroundWindowTitle &&
    left.enableMicroJiggle === right.enableMicroJiggle &&
    left.enableKeypress === right.enableKeypress &&
    left.enableCornerSmoothing === right.enableCornerSmoothing
  );
}

function resolvePublicAsset(name) {
  if (app.isPackaged) {
    const resourcePath = path.join(process.resourcesPath, 'public', name);
    if (fs.existsSync(resourcePath)) {
      return resourcePath;
    }

    return path.join(app.getAppPath(), 'public', name);
  }

  return path.join(__dirname, '..', 'public', name);
}

function getTrayIconPath(enabled) {
  const preferred = resolvePublicAsset(enabled ? TRAY_ICON_FILES.active : TRAY_ICON_FILES.disabled);
  const fallback = resolvePublicAsset(TRAY_ICON_FILES.fallback);

  if (fs.existsSync(preferred)) {
    return preferred;
  }

  return fallback;
}

function getTrayIcon(enabled) {
  const image = nativeImage.createFromPath(getTrayIconPath(enabled));
  if (!image.isEmpty()) {
    return image;
  }

  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
  );
}

function getWindowIconPath() {
  const preferred = resolvePublicAsset(TRAY_ICON_FILES.fallback);
  const alternate = resolvePublicAsset(TRAY_ICON_FILES.active);

  if (fs.existsSync(preferred)) {
    return preferred;
  }

  return alternate;
}

function applyWindowIcon(targetWindow) {
  if (!IS_WINDOWS) {
    return;
  }

  const windowIcon = nativeImage.createFromPath(getWindowIconPath());
  if (!windowIcon.isEmpty()) {
    targetWindow.setIcon(windowIcon);
  }
}

function getState() {
  return {
    enabled: state.isJigglerEnabled,
    settings: state.settings,
  };
}

function hasWindow() {
  return state.win && !state.win.isDestroyed();
}

function showMainWindow() {
  if (!hasWindow()) {
    return;
  }

  if (state.win.isMinimized()) {
    state.win.restore();
  }

  state.win.show();
  state.win.focus();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: state.isJigglerEnabled ? 'Выключить (F8)' : 'Включить (F8)',
      click: () => toggleJiggler(),
    },
    {
      label: 'Настройки',
      click: () => showMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        state.isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function updateTray() {
  if (!state.tray) {
    return;
  }

  state.tray.setImage(getTrayIcon(state.isJigglerEnabled));
  state.tray.setToolTip(
    `RYBAKIČ Mouse Jiggler: ${state.isJigglerEnabled ? 'включен (F8)' : 'выключен (F8)'}`,
  );
  state.tray.setContextMenu(buildTrayMenu());
}

function broadcastState() {
  if (hasWindow()) {
    state.win.webContents.send('jiggler:state', getState());
  }

  updateTray();
}

function buildJigglerScript(settings) {
  const titleFilter = String(settings.foregroundWindowTitle ?? '').replace(/'/g, "''");

  return `
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class MouseNative {
    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const byte VK_PAUSE = 0x13;
    public const byte VK_F13 = 0x7C;
    public const byte VK_F14 = 0x7D;
    public const byte VK_F15 = 0x7E;
    public const byte VK_F16 = 0x7F;
    public const byte VK_F17 = 0x80;
    public const byte VK_F18 = 0x81;
    public const byte VK_F19 = 0x82;
    public const byte VK_F20 = 0x83;
    public const byte VK_F21 = 0x84;
    public const byte VK_F22 = 0x85;
    public const byte VK_F23 = 0x86;
    public const byte VK_F24 = 0x87;
    public const byte VK_SCROLL = 0x91;
    public const int SW_SHOW = 5;
    public const int SW_MAXIMIZE = 3;
    private static readonly Random Rng = new Random();

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }


    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public static POINT GetCursorPosition() {
        POINT point;
        GetCursorPos(out point);
        return point;
    }

    public static string GetForegroundWindowTitle() {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) {
            return string.Empty;
        }

        var buffer = new StringBuilder(512);
        int length = GetWindowText(hwnd, buffer, buffer.Capacity);
        if (length <= 0) {
            return string.Empty;
        }

        return buffer.ToString();
    }


    public static IntPtr FindWindowByTitleContains(string filter) {
        if (string.IsNullOrWhiteSpace(filter)) {
            return IntPtr.Zero;
        }

        IntPtr result = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) {
                return true;
            }

            var buffer = new StringBuilder(512);
            int length = GetWindowText(hWnd, buffer, buffer.Capacity);
            if (length <= 0) {
                return true;
            }

            var title = buffer.ToString();
            if (title.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0) {
                result = hWnd;
                return false;
            }

            return true;
        }, IntPtr.Zero);

        return result;
    }

    private static void MoveDirectTo(int toX, int toY) {
        POINT current;
        GetCursorPos(out current);

        int dx = toX - current.X;
        int dy = toY - current.Y;
        if (dx != 0 || dy != 0) {
            mouse_event(MOUSEEVENTF_MOVE, dx, dy, 0, UIntPtr.Zero);
        }
    }

    private static void MoveSmoothTo(int toX, int toY) {
        POINT current;
        GetCursorPos(out current);

        int fromX = current.X;
        int fromY = current.Y;
        int steps = 6;
        int delayMs = 2;

        for (int i = 1; i <= steps; i++) {
            int nextX = fromX + ((toX - fromX) * i) / steps;
            int nextY = fromY + ((toY - fromY) * i) / steps;
            int dx = nextX - current.X;
            int dy = nextY - current.Y;

            if (dx != 0 || dy != 0) {
                mouse_event(MOUSEEVENTF_MOVE, dx, dy, 0, UIntPtr.Zero);
                current.X = nextX;
                current.Y = nextY;
            }

            Thread.Sleep(delayMs);
        }
    }

    public static void MoveCursorAlongCircle(IntPtr hWnd, bool smooth) {
        if (hWnd == IntPtr.Zero) {
            return;
        }

        RECT rect;
        if (!GetWindowRect(hWnd, out rect)) {
            return;
        }

        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        int centerX = rect.Left + (width / 2);
        int centerY = rect.Top + (height / 2);

        double radiusRatio = 0.25 + (Rng.NextDouble() * 0.1);
        int radius = Math.Max(24, (int)(Math.Min(width, height) * radiusRatio));

        int pointsCount = 24;
        double phase = Rng.NextDouble() * 2.0 * Math.PI;

        POINT original;
        GetCursorPos(out original);

        try {
            for (int i = 0; i < pointsCount; i++) {
                double angle = phase + (2.0 * Math.PI * i / pointsCount);
                int x = centerX + (int)(radius * Math.Cos(angle));
                int y = centerY + (int)(radius * Math.Sin(angle));
                if (smooth) {
                    MoveSmoothTo(x, y);
                } else {
                    MoveDirectTo(x, y);
                }
                mouse_event(MOUSEEVENTF_MOVE, 1, 0, 0, UIntPtr.Zero);
                mouse_event(MOUSEEVENTF_MOVE, -1, 0, 0, UIntPtr.Zero);
            }
        } finally {
            MoveDirectTo(original.X, original.Y);
            MoveDirectTo(original.X, original.Y);
            mouse_event(MOUSEEVENTF_MOVE, 1, 0, 0, UIntPtr.Zero);
            mouse_event(MOUSEEVENTF_MOVE, -1, 0, 0, UIntPtr.Zero);
            MoveDirectTo(original.X, original.Y);
        }
    }

    public static void TapKey(byte key) {
        keybd_event(key, 0, 0, UIntPtr.Zero);
        Thread.Sleep(8);
        keybd_event(key, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    public static void MouseWheel(int delta) {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, UIntPtr.Zero);
    }

    public static void MouseClick() {
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(6);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
    }

    public static bool GetWindowCenter(IntPtr hWnd, out int x, out int y) {
        x = 0;
        y = 0;
        if (hWnd == IntPtr.Zero) {
            return false;
        }

        RECT rect;
        if (!GetWindowRect(hWnd, out rect)) {
            return false;
        }

        x = rect.Left + ((rect.Right - rect.Left) / 2);
        y = rect.Top + ((rect.Bottom - rect.Top) / 2);
        return true;
    }

}
"@

$deviationMin = ${settings.deviation[0]}
$deviationMax = ${settings.deviation[1]}
$frequencyMinMs = ${settings.frequency[0]}
$frequencyMaxMs = ${settings.frequency[1]}
$smoothnessMin = ${settings.smoothness[0]}
$smoothnessMax = ${settings.smoothness[1]}
$keypressIntervalMinMs = ${settings.keypressInterval[0]}
$keypressIntervalMaxMs = ${settings.keypressInterval[1]}
$enableScroll = ${settings.enableScroll ? '$true' : '$false'}
$scrollIntervalMinMs = ${settings.scrollInterval[0]}
$scrollIntervalMaxMs = ${settings.scrollInterval[1]}
$scrollAmountMin = ${settings.scrollAmount[0]}
$scrollAmountMax = ${settings.scrollAmount[1]}
$enableClick = ${settings.enableClick ? '$true' : '$false'}
$clickIntervalMinMs = ${settings.clickInterval[0]}
$clickIntervalMaxMs = ${settings.clickInterval[1]}
$keepFocusOnTitle = ${settings.keepFocusOnTitle ? '$true' : '$false'}
$focusIntervalMinMs = ${settings.focusInterval[0]}
$focusIntervalMaxMs = ${settings.focusInterval[1]}
$cornerIntervalMinMs = ${settings.cornerInterval[0]}
$cornerIntervalMaxMs = ${settings.cornerInterval[1]}
$titleFilter = '${titleFilter}'
$enableMicroJiggle = ${settings.enableMicroJiggle ? '$true' : '$false'}
$enableKeypress = ${settings.enableKeypress ? '$true' : '$false'}
$enableCornerSmoothing = ${settings.enableCornerSmoothing ? '$true' : '$false'}

function Get-RandomInRange([int]$min, [int]$max) {
    if ($min -gt $max) {
        $tmp = $min
        $min = $max
        $max = $tmp
    }
    if ($min -eq $max) {
        return $min
    }
    return Get-Random -Minimum $min -Maximum ($max + 1)
}

function RestoreCursor([MouseNative+POINT]$target) {
    for ($i = 0; $i -lt 6; $i++) {
        [MouseNative]::SetCursorPos($target.X, $target.Y)
        Start-Sleep -Milliseconds 12
        $current = [MouseNative]::GetCursorPosition()
        $dx = [Math]::Abs($current.X - $target.X)
        $dy = [Math]::Abs($current.Y - $target.Y)
        if ($dx -le 2 -and $dy -le 2) {
            return
        }
    }
}

function ShouldRestoreCursor([int]$centerX, [int]$centerY) {
    $current = [MouseNative]::GetCursorPosition()
    $dx = [Math]::Abs($current.X - $centerX)
    $dy = [Math]::Abs($current.Y - $centerY)
    return ($dx -le 8 -and $dy -le 8)
}

function IsPointInRect([MouseNative+POINT]$point, [MouseNative+RECT]$rect) {
    return ($point.X -ge $rect.Left -and $point.X -le $rect.Right -and $point.Y -ge $rect.Top -and $point.Y -le $rect.Bottom)
}

$now = [DateTime]::UtcNow
$nextFocusAt = $now.AddMilliseconds($(Get-RandomInRange $focusIntervalMinMs $focusIntervalMaxMs))
$nextCornerAt = $now.AddMilliseconds($(Get-RandomInRange $cornerIntervalMinMs $cornerIntervalMaxMs))
$nextKeypressAt = $now.AddMilliseconds($(Get-RandomInRange $keypressIntervalMinMs $keypressIntervalMaxMs))
$nextScrollAt = $now.AddMilliseconds($(Get-RandomInRange $scrollIntervalMinMs $scrollIntervalMaxMs))
$nextClickAt = $now.AddMilliseconds($(Get-RandomInRange $clickIntervalMinMs $clickIntervalMaxMs))
$nextMicroAt = $now.AddMilliseconds($(Get-RandomInRange $frequencyMinMs $frequencyMaxMs))
$scrollPolarity = 1
$idleThresholdMs = 700
$lastCursorPos = [MouseNative]::GetCursorPosition()
$lastCursorMoveAt = [DateTime]::UtcNow
$keypressKeys = @(
    [MouseNative]::VK_SCROLL,
    [MouseNative]::VK_PAUSE,
    [MouseNative]::VK_F13,
    [MouseNative]::VK_F14,
    [MouseNative]::VK_F15,
    [MouseNative]::VK_F16,
    [MouseNative]::VK_F17,
    [MouseNative]::VK_F18,
    [MouseNative]::VK_F19,
    [MouseNative]::VK_F20,
    [MouseNative]::VK_F21,
    [MouseNative]::VK_F22,
    [MouseNative]::VK_F23,
    [MouseNative]::VK_F24
)

function Update-CursorIdleState {
    $current = [MouseNative]::GetCursorPosition()
    $dx = [Math]::Abs($current.X - $lastCursorPos.X)
    $dy = [Math]::Abs($current.Y - $lastCursorPos.Y)
    if ($dx -gt 2 -or $dy -gt 2) {
        $script:lastCursorPos = $current
        $script:lastCursorMoveAt = [DateTime]::UtcNow
    }
}

function Is-CursorIdle([int]$thresholdMs) {
    Update-CursorIdleState
    $elapsed = ([DateTime]::UtcNow - $lastCursorMoveAt).TotalMilliseconds
    return ($elapsed -ge $thresholdMs)
}

while ($true) {
    Update-CursorIdleState
    $targetWindow = $null
    if ($keepFocusOnTitle -and $titleFilter.Length -gt 0) {
        $now = [DateTime]::UtcNow
        if ($now -ge $nextFocusAt) {
            $nextFocusAt = $now.AddMilliseconds($(Get-RandomInRange $focusIntervalMinMs $focusIntervalMaxMs))
            $targetWindow = [MouseNative]::FindWindowByTitleContains($titleFilter)
            if ($targetWindow -ne [IntPtr]::Zero) {
                $currentForeground = [MouseNative]::GetForegroundWindow()
                if ($currentForeground -ne $targetWindow) {
                    [MouseNative]::ShowWindow($targetWindow, [MouseNative]::SW_MAXIMIZE) | Out-Null
                    [MouseNative]::SetForegroundWindow($targetWindow) | Out-Null
                }
            }
        }
    }

    if ($enableMicroJiggle -and ($now -ge $nextMicroAt)) {
        $nextMicroAt = $now.AddMilliseconds($(Get-RandomInRange $frequencyMinMs $frequencyMaxMs))
        $deviation = Get-RandomInRange $deviationMin $deviationMax
        $dx = Get-Random -Minimum (-$deviation) -Maximum ($deviation + 1)
        $dy = Get-Random -Minimum (-$deviation) -Maximum ($deviation + 1)

        if ($dx -eq 0 -and $dy -eq 0) {
            $dx = 1
        }

        $cycleMs = [Math]::Max([int]($(Get-RandomInRange $frequencyMinMs $frequencyMaxMs)), 100)
        $stepCount = [Math]::Max([int]($(Get-RandomInRange $smoothnessMin $smoothnessMax)), 1)

        # Короткое "касание" мыши: быстро ушли/вернулись и дали курсору свободно жить до следующего цикла.
        $motionBudgetMs = [Math]::Min([int]($cycleMs * 0.35), 220)
        $stepDelayMs = [Math]::Max([int]($motionBudgetMs / (2 * $stepCount)), 1)
        $motionSpentMs = $stepDelayMs * 2 * $stepCount

        $movedX = 0
        $movedY = 0
        for ($i = 1; $i -le $stepCount; $i++) {
            $nextX = [int][Math]::Round(($dx * $i) / $stepCount)
            $nextY = [int][Math]::Round(($dy * $i) / $stepCount)
            $incX = $nextX - $movedX
            $incY = $nextY - $movedY

            [MouseNative]::mouse_event([MouseNative]::MOUSEEVENTF_MOVE, $incX, $incY, 0, [UIntPtr]::Zero)

            $movedX = $nextX
            $movedY = $nextY
            Start-Sleep -Milliseconds $stepDelayMs
        }

        $returnedX = 0
        $returnedY = 0
        for ($i = 1; $i -le $stepCount; $i++) {
            $nextX = [int][Math]::Round(((-$dx) * $i) / $stepCount)
            $nextY = [int][Math]::Round(((-$dy) * $i) / $stepCount)
            $incX = $nextX - $returnedX
            $incY = $nextY - $returnedY

            [MouseNative]::mouse_event([MouseNative]::MOUSEEVENTF_MOVE, $incX, $incY, 0, [UIntPtr]::Zero)

            $returnedX = $nextX
            $returnedY = $nextY
            Start-Sleep -Milliseconds $stepDelayMs
        }

        $restMs = $cycleMs - $motionSpentMs
        if ($restMs -gt 0) {
            Start-Sleep -Milliseconds $restMs
        }
    }

    $now = [DateTime]::UtcNow
    if ($enableKeypress -and ($now -ge $nextKeypressAt)) {
        $nextKeypressAt = $now.AddMilliseconds($(Get-RandomInRange $keypressIntervalMinMs $keypressIntervalMaxMs))
        if (-not (Is-CursorIdle $idleThresholdMs)) {
            continue
        }
        if ($titleFilter.Length -gt 0) {
            $keyTarget = [MouseNative]::FindWindowByTitleContains($titleFilter)
            if ($keyTarget -ne [IntPtr]::Zero) {
                $originalForeground = [MouseNative]::GetForegroundWindow()
                [MouseNative]::ShowWindow($keyTarget, [MouseNative]::SW_SHOW) | Out-Null
                [MouseNative]::SetForegroundWindow($keyTarget) | Out-Null
                $original = [MouseNative]::GetCursorPosition()
                $rect = New-Object MouseNative+RECT
                $hasRect = [MouseNative]::GetWindowRect($keyTarget, [ref]$rect)
                $originalInside = $false
                if ($hasRect) {
                    $originalInside = IsPointInRect $original $rect
                }
                $centerX = 0
                $centerY = 0
                $hasCenter = [MouseNative]::GetWindowCenter($keyTarget, [ref]$centerX, [ref]$centerY)
                if ($hasCenter) {
                    [MouseNative]::SetCursorPos($centerX, $centerY)
                    Start-Sleep -Milliseconds 12
                }
                $key = Get-Random -InputObject $keypressKeys
                [MouseNative]::TapKey($key)
                Start-Sleep -Milliseconds 35
                if ($originalForeground -and $originalForeground -ne [IntPtr]::Zero -and $originalForeground -ne $keyTarget) {
                    [MouseNative]::SetForegroundWindow($originalForeground) | Out-Null
                    Start-Sleep -Milliseconds 8
                }
                if ($hasCenter) {
                    if ($originalInside) {
                        if (ShouldRestoreCursor $centerX $centerY) {
                            RestoreCursor $original
                        }
                    } else {
                        $current = [MouseNative]::GetCursorPosition()
                        if ($hasRect -and (IsPointInRect $current $rect)) {
                            RestoreCursor $original
                        }
                    }
                }
                continue
            }
        }
        $key = Get-Random -InputObject $keypressKeys
        [MouseNative]::TapKey($key)
    }

    if ($enableScroll -and ($now -ge $nextScrollAt)) {
        $nextScrollAt = $now.AddMilliseconds($(Get-RandomInRange $scrollIntervalMinMs $scrollIntervalMaxMs))
        if (-not (Is-CursorIdle $idleThresholdMs)) {
            continue
        }
        $deltaBase = [Math]::Max([int]($(Get-RandomInRange $scrollAmountMin $scrollAmountMax)), 1)
        $delta = $deltaBase * $scrollPolarity
        $scrollPolarity = -1 * $scrollPolarity

        if ($titleFilter.Length -gt 0) {
            $scrollTarget = [MouseNative]::FindWindowByTitleContains($titleFilter)
            if ($scrollTarget -ne [IntPtr]::Zero) {
                $originalForeground = [MouseNative]::GetForegroundWindow()
                [MouseNative]::ShowWindow($scrollTarget, [MouseNative]::SW_SHOW) | Out-Null
                [MouseNative]::SetForegroundWindow($scrollTarget) | Out-Null
                $original = [MouseNative]::GetCursorPosition()
                $rect = New-Object MouseNative+RECT
                $hasRect = [MouseNative]::GetWindowRect($scrollTarget, [ref]$rect)
                $originalInside = $false
                if ($hasRect) {
                    $originalInside = IsPointInRect $original $rect
                }
                $centerX = 0
                $centerY = 0
                $hasCenter = [MouseNative]::GetWindowCenter($scrollTarget, [ref]$centerX, [ref]$centerY)
                if ($hasCenter) {
                    [MouseNative]::SetCursorPos($centerX, $centerY)
                    Start-Sleep -Milliseconds 12
                }
                [MouseNative]::MouseWheel($delta)
                Start-Sleep -Milliseconds 35
                if ($originalForeground -and $originalForeground -ne [IntPtr]::Zero -and $originalForeground -ne $scrollTarget) {
                    [MouseNative]::SetForegroundWindow($originalForeground) | Out-Null
                    Start-Sleep -Milliseconds 8
                }
                if ($hasCenter) {
                    if ($originalInside) {
                        if (ShouldRestoreCursor $centerX $centerY) {
                            RestoreCursor $original
                        }
                    } else {
                        $current = [MouseNative]::GetCursorPosition()
                        if ($hasRect -and (IsPointInRect $current $rect)) {
                            RestoreCursor $original
                        }
                    }
                }
                continue
            }
        }

        [MouseNative]::MouseWheel($delta)
    }

    if ($enableClick -and ($now -ge $nextClickAt)) {
        $nextClickAt = $now.AddMilliseconds($(Get-RandomInRange $clickIntervalMinMs $clickIntervalMaxMs))
        if (-not (Is-CursorIdle $idleThresholdMs)) {
            continue
        }
        if ($titleFilter.Length -eq 0) {
            continue
        }
        $clickTarget = [MouseNative]::FindWindowByTitleContains($titleFilter)
        if ($clickTarget -eq [IntPtr]::Zero) {
            continue
        }
        $originalForeground = [MouseNative]::GetForegroundWindow()
        [MouseNative]::ShowWindow($clickTarget, [MouseNative]::SW_SHOW) | Out-Null
        [MouseNative]::SetForegroundWindow($clickTarget) | Out-Null
        $original = [MouseNative]::GetCursorPosition()
        $rect = New-Object MouseNative+RECT
        $hasRect = [MouseNative]::GetWindowRect($clickTarget, [ref]$rect)
        $originalInside = $false
        if ($hasRect) {
            $originalInside = IsPointInRect $original $rect
        }
        $targetX = 0
        $targetY = 0
        $hasTarget = $false
        if ($hasRect) {
            $width = $rect.Right - $rect.Left
            $height = $rect.Bottom - $rect.Top
            if ($width -gt 0 -and $height -gt 0) {
                $marginX = [int][Math]::Round($width * 0.2)
                $marginY = [int][Math]::Round($height * 0.2)
                $minX = $rect.Left + $marginX
                $maxX = $rect.Right - $marginX
                $minY = $rect.Top + $marginY
                $maxY = $rect.Bottom - $marginY
                if ($minX -gt $maxX) {
                    $minX = $rect.Left
                    $maxX = $rect.Right
                }
                if ($minY -gt $maxY) {
                    $minY = $rect.Top
                    $maxY = $rect.Bottom
                }
                $targetX = Get-RandomInRange $minX $maxX
                $targetY = Get-RandomInRange $minY $maxY
                $hasTarget = $true
            }
        }
        if (-not $hasTarget) {
            $centerX = 0
            $centerY = 0
            $hasCenter = [MouseNative]::GetWindowCenter($clickTarget, [ref]$centerX, [ref]$centerY)
            if ($hasCenter) {
                $targetX = $centerX
                $targetY = $centerY
                $hasTarget = $true
            }
        }
        if ($hasTarget) {
            [MouseNative]::SetCursorPos($targetX, $targetY)
            Start-Sleep -Milliseconds 12
        }
        [MouseNative]::MouseClick()
        Start-Sleep -Milliseconds 35
        if ($originalForeground -and $originalForeground -ne [IntPtr]::Zero -and $originalForeground -ne $clickTarget) {
            [MouseNative]::SetForegroundWindow($originalForeground) | Out-Null
            Start-Sleep -Milliseconds 8
        }
        if ($hasTarget) {
            if ($originalInside) {
                if (ShouldRestoreCursor $targetX $targetY) {
                    RestoreCursor $original
                }
            } else {
                $current = [MouseNative]::GetCursorPosition()
                if ($hasRect -and (IsPointInRect $current $rect)) {
                    RestoreCursor $original
                }
            }
        }
        continue
    }

    if ($keepFocusOnTitle -and $titleFilter.Length -gt 0) {
        $now = [DateTime]::UtcNow
        if ($now -ge $nextCornerAt) {
            $nextCornerAt = $now.AddMilliseconds($(Get-RandomInRange $cornerIntervalMinMs $cornerIntervalMaxMs))
            if (-not (Is-CursorIdle $idleThresholdMs)) {
                continue
            }
            if (-not $targetWindow -or $targetWindow -eq [IntPtr]::Zero) {
                $targetWindow = [MouseNative]::FindWindowByTitleContains($titleFilter)
            }
            if ($targetWindow -ne [IntPtr]::Zero) {
                [MouseNative]::MoveCursorAlongCircle($targetWindow, $enableCornerSmoothing)
            }
        }
    }

    $now = [DateTime]::UtcNow
    $nextWake = $nextClickAt
    if ($nextFocusAt -lt $nextWake) { $nextWake = $nextFocusAt }
    if ($nextCornerAt -lt $nextWake) { $nextWake = $nextCornerAt }
    if ($nextKeypressAt -lt $nextWake) { $nextWake = $nextKeypressAt }
    if ($nextScrollAt -lt $nextWake) { $nextWake = $nextScrollAt }
    if ($enableMicroJiggle -and ($nextMicroAt -lt $nextWake)) { $nextWake = $nextMicroAt }

    $sleepMs = [int]([Math]::Max([Math]::Min(($nextWake - $now).TotalMilliseconds, 200), 50))
    if ($sleepMs -gt 0) {
        Start-Sleep -Milliseconds $sleepMs
    } else {
        Start-Sleep -Milliseconds 10
    }
}
`;
}

function spawnJigglerProcess(settings) {
  if (IS_WINDOWS) {
    const logPath = path.join(app.getPath('userData'), 'jiggler.log');
    fs.writeFileSync(logPath, '', { encoding: 'utf8' });

    return spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-Command',
        buildJigglerScript(settings),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  }

  return null;
}

function stopJiggler() {
  const processToStop = state.jigglerProcess;
  state.jigglerProcess = null;

  if (processToStop) {
    processToStop.removeAllListeners('exit');
    processToStop.kill();
  }

  state.isJigglerEnabled = false;
  broadcastState();
}

function startJiggler() {
  if (state.jigglerProcess) {
    stopJiggler();
  }

  const nextProcess = spawnJigglerProcess(state.settings);
  if (!nextProcess) {
    state.isJigglerEnabled = false;
    broadcastState();
    return;
  }

  state.jigglerProcess = nextProcess;
  const logPath = path.join(app.getPath('userData'), 'jiggler.log');

  if (nextProcess.stdout) {
    nextProcess.stdout.on('data', (chunk) => {
      fs.appendFileSync(logPath, chunk.toString('utf8'), { encoding: 'utf8' });
    });
  }

  if (nextProcess.stderr) {
    nextProcess.stderr.on('data', (chunk) => {
      fs.appendFileSync(logPath, chunk.toString('utf8'), { encoding: 'utf8' });
    });
  }

  nextProcess.once('exit', () => {
    if (state.jigglerProcess !== nextProcess) {
      return;
    }

    state.jigglerProcess = null;
    if (state.isJigglerEnabled) {
      state.isJigglerEnabled = false;
      broadcastState();
    }
  });

  state.isJigglerEnabled = true;
  broadcastState();
}

function toggleJiggler() {
  if (state.isJigglerEnabled) {
    stopJiggler();
    return;
  }

  startJiggler();
}

function registerIpcHandlers() {
  ipcMain.handle('jiggler:get-state', () => getState());

  ipcMain.handle('jiggler:update-settings', (_event, rawSettings) => {
    const nextSettings = sanitizeSettings(rawSettings);
    const settingsChanged = !areSettingsEqual(state.settings, nextSettings);
    state.settings = nextSettings;

    if (state.isJigglerEnabled && settingsChanged) {
      stopJiggler();
      return getState();
    }

    if (!state.isJigglerEnabled && settingsChanged) {
      broadcastState();
    }

    return getState();
  });
}

function createWindow() {
  const windowOptions = {
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    title: 'RYBAKIČ - Mouse Jiggler',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (IS_WINDOWS) {
    windowOptions.icon = getWindowIconPath();
  }

  state.win = new BrowserWindow(windowOptions);
  state.win.removeMenu();
  applyWindowIcon(state.win);
  state.win.maximize();

  if (!app.isPackaged) {
    state.win.loadURL('http://localhost:4200');
    // state.win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'rybakic-jiggler', 'browser', 'index.html');
    state.win.loadFile(indexPath);
  }

  state.win.on('close', (event) => {
    if (state.isQuitting) {
      return;
    }

    event.preventDefault();
    state.win.hide();
  });

  state.win.webContents.on('did-finish-load', () => {
    broadcastState();
  });
}

function createTray() {
  state.tray = new Tray(getTrayIcon(false));
  state.tray.setContextMenu(buildTrayMenu());
  state.tray.on('double-click', () => showMainWindow());
  state.tray.on('click', () => showMainWindow());
  updateTray();
}

if (!IS_WINDOWS) {
  app.whenReady().then(() => app.quit());
} else {
  app.setAppUserModelId(APP_ID);

  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      showMainWindow();
    });
  }

  app.whenReady().then(() => {
    if (!hasSingleInstanceLock) {
      return;
    }

    createWindow();
    createTray();
    registerIpcHandlers();
    globalShortcut.register('F8', () => toggleJiggler());
  });

  app.on('activate', () => {
    showMainWindow();
  });

  app.on('before-quit', () => {
    state.isQuitting = true;
    globalShortcut.unregisterAll();
    stopJiggler();
  });

  app.on('window-all-closed', () => {});
}

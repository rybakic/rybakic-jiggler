const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let win;
let tray;
let jigglerProcess = null;
let isJigglerEnabled = false;
let isQuitting = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const IS_WINDOWS = process.platform === 'win32';

const DEFAULT_SETTINGS = {
  deviation: 10,
  frequency: 1000,
  smoothness: 10,
  keepFocusOnTitle: false,
  focusInterval: 3000,
  foregroundWindowTitle: '',
  enableMicroJiggle: true,
};

const TRAY_ICON_FILES = {
  active: 'active.ico',
  disabled: 'disable.ico',
  fallback: 'icon.ico',
};

let jigglerSettings = { ...DEFAULT_SETTINGS };

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sanitizeSettings(raw) {
  const input = raw ?? {};

  return {
    deviation: clamp(Math.round(Number(input.deviation) || DEFAULT_SETTINGS.deviation), 1, 100),
    frequency: clamp(Math.round(Number(input.frequency) || DEFAULT_SETTINGS.frequency), 100, 10000),
    smoothness: clamp(Math.round(Number(input.smoothness) || DEFAULT_SETTINGS.smoothness), 1, 20),
    keepFocusOnTitle: Boolean(input.keepFocusOnTitle),
    focusInterval: clamp(Math.round(Number(input.focusInterval) || DEFAULT_SETTINGS.focusInterval), 1000, 10000),
    foregroundWindowTitle: String(input.foregroundWindowTitle ?? '').slice(0, 200),
    enableMicroJiggle:
      input.enableMicroJiggle === undefined
        ? DEFAULT_SETTINGS.enableMicroJiggle
        : Boolean(input.enableMicroJiggle),
  };
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

function getState() {
  return {
    enabled: isJigglerEnabled,
    settings: jigglerSettings,
  };
}

function showMainWindow() {
  if (!win || win.isDestroyed()) {
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }

  win.show();
  win.focus();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: isJigglerEnabled ? 'Выключить (F8)' : 'Включить (F8)',
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
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function updateTray() {
  if (!tray) {
    return;
  }

  tray.setImage(getTrayIcon(isJigglerEnabled));
  tray.setToolTip(
    `RYBAKIČ Mouse Jiggler: ${isJigglerEnabled ? 'включен (F8)' : 'выключен (F8)'}`,
  );
  tray.setContextMenu(buildTrayMenu());
}

function broadcastState() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('jiggler:state', getState());
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
    public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);

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

    public static void MoveCursorToWindowCorners(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) {
            return;
        }

        RECT rect;
        if (!GetWindowRect(hWnd, out rect)) {
            return;
        }

        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;

        double insetRatioX = 0.2 + (Rng.NextDouble() * 0.15);
        double insetRatioY = 0.2 + (Rng.NextDouble() * 0.15);
        int insetX = Math.Max(24, (int)(width * insetRatioX));
        int insetY = Math.Max(24, (int)(height * insetRatioY));

        int left = rect.Left + insetX;
        int top = rect.Top + insetY;
        int right = rect.Right - insetX;
        int bottom = rect.Bottom - insetY;

        var points = new POINT[]
        {
            new POINT { X = left, Y = top },
            new POINT { X = right, Y = top },
            new POINT { X = right, Y = bottom },
            new POINT { X = left, Y = bottom },
        };

        for (int i = points.Length - 1; i > 0; i--) {
            int j = Rng.Next(i + 1);
            var temp = points[i];
            points[i] = points[j];
            points[j] = temp;
        }

        POINT original;
        GetCursorPos(out original);

        try {
            foreach (var point in points) {
                MoveDirectTo(point.X, point.Y);
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
}
"@

$deviation = ${settings.deviation}
$frequencyMs = ${settings.frequency}
$smoothness = ${settings.smoothness}
$keepFocusOnTitle = ${settings.keepFocusOnTitle ? '$true' : '$false'}
$focusIntervalMs = ${settings.focusInterval}
$titleFilter = '${titleFilter}'
$enableMicroJiggle = ${settings.enableMicroJiggle ? '$true' : '$false'}
$lastFocusAt = [DateTime]::UtcNow.AddMilliseconds(-$focusIntervalMs)

while ($true) {
    $targetWindow = $null
    if ($keepFocusOnTitle -and $titleFilter.Length -gt 0) {
        $now = [DateTime]::UtcNow
        if (($now - $lastFocusAt).TotalMilliseconds -ge $focusIntervalMs) {
            $lastFocusAt = $now
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

    if ($enableMicroJiggle) {
        $dx = Get-Random -Minimum (-$deviation) -Maximum ($deviation + 1)
        $dy = Get-Random -Minimum (-$deviation) -Maximum ($deviation + 1)

        if ($dx -eq 0 -and $dy -eq 0) {
            $dx = 1
        }

        $cycleMs = [Math]::Max([int]$frequencyMs, 100)
        $stepCount = [Math]::Max($smoothness, 1)

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
    } else {
        Start-Sleep -Milliseconds $frequencyMs
    }

    if ($titleFilter.Length -gt 0) {
        if (-not $targetWindow -or $targetWindow -eq [IntPtr]::Zero) {
            $targetWindow = [MouseNative]::FindWindowByTitleContains($titleFilter)
        }
        if ($targetWindow -ne [IntPtr]::Zero) {
            [MouseNative]::MoveCursorToWindowCorners($targetWindow)
        }
    }
}
`;
}

function spawnJigglerProcess(settings) {
  if (IS_WINDOWS) {
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
      { stdio: 'ignore' },
    );
  }

  return null;
}

function stopJiggler() {
  const processToStop = jigglerProcess;
  jigglerProcess = null;

  if (processToStop) {
    processToStop.removeAllListeners('exit');
    processToStop.kill();
  }

  isJigglerEnabled = false;
  broadcastState();
}

function startJiggler() {
  if (jigglerProcess) {
    stopJiggler();
  }

  const nextProcess = spawnJigglerProcess(jigglerSettings);
  if (!nextProcess) {
    isJigglerEnabled = false;
    broadcastState();
    return;
  }

  jigglerProcess = nextProcess;

  nextProcess.once('exit', () => {
    if (jigglerProcess !== nextProcess) {
      return;
    }

    jigglerProcess = null;
    if (isJigglerEnabled) {
      isJigglerEnabled = false;
      broadcastState();
    }
  });

  isJigglerEnabled = true;
  broadcastState();
}

function toggleJiggler() {
  if (isJigglerEnabled) {
    stopJiggler();
    return;
  }

  startJiggler();
}

function registerIpcHandlers() {
  ipcMain.handle('jiggler:get-state', () => getState());

  ipcMain.handle('jiggler:update-settings', (_event, rawSettings) => {
    jigglerSettings = sanitizeSettings(rawSettings);

    if (isJigglerEnabled) {
      stopJiggler();
      return getState();
    }

    broadcastState();
    return getState();
  });
}

function createWindow() {
  const windowOptions = {
    width: 560,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
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

  win = new BrowserWindow(windowOptions);
  win.removeMenu();

  if (!app.isPackaged) {
    win.loadURL('http://localhost:4200');
    // win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'rybakic-jiggler', 'browser', 'index.html');
    win.loadFile(indexPath);
  }

  win.on('close', (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    win.hide();
  });

  win.webContents.on('did-finish-load', () => {
    broadcastState();
  });
}

function createTray() {
  tray = new Tray(getTrayIcon(false));
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', () => showMainWindow());
  tray.on('click', () => showMainWindow());
  updateTray();
}

if (!IS_WINDOWS) {
  app.whenReady().then(() => app.quit());
} else {
  app.setAppUserModelId('com.rybakic.mousejiggler');

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
    isQuitting = true;
    globalShortcut.unregisterAll();
    stopJiggler();
  });

  app.on('window-all-closed', () => {});
}

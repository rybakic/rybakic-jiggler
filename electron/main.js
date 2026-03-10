const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_ID = 'com.rybakic.mousejiggler';
const IS_WINDOWS = process.platform === 'win32';
const hasSingleInstanceLock = app.requestSingleInstanceLock();

const DEFAULT_SETTINGS = {
  deviation: 10,
  frequency: 1000,
  smoothness: 10,
  keepFocusOnTitle: false,
  focusInterval: 3000,
  cornerInterval: 3000,
  foregroundWindowTitle: '',
  enableMicroJiggle: true,
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

function sanitizeSettings(raw) {
  const input = raw ?? {};

  return {
    deviation: clamp(Math.round(Number(input.deviation) || DEFAULT_SETTINGS.deviation), 1, 100),
    frequency: clamp(Math.round(Number(input.frequency) || DEFAULT_SETTINGS.frequency), 100, 10000),
    smoothness: clamp(Math.round(Number(input.smoothness) || DEFAULT_SETTINGS.smoothness), 1, 20),
    keepFocusOnTitle: Boolean(input.keepFocusOnTitle),
    focusInterval: clamp(Math.round(Number(input.focusInterval) || DEFAULT_SETTINGS.focusInterval), 1000, 10000),
    cornerInterval: clamp(Math.round(Number(input.cornerInterval) || DEFAULT_SETTINGS.cornerInterval), 500, 10000),
    foregroundWindowTitle: String(input.foregroundWindowTitle ?? '').slice(0, 200),
    enableMicroJiggle:
      input.enableMicroJiggle === undefined
        ? DEFAULT_SETTINGS.enableMicroJiggle
        : Boolean(input.enableMicroJiggle),
    enableCornerSmoothing:
      input.enableCornerSmoothing === undefined
        ? DEFAULT_SETTINGS.enableCornerSmoothing
        : Boolean(input.enableCornerSmoothing),
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

    private static void MoveSmoothTo(int toX, int toY) {
        POINT current;
        GetCursorPos(out current);

        int fromX = current.X;
        int fromY = current.Y;
        int steps = 12;

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

            Thread.Sleep(8);
        }
    }

    public static void MoveCursorToWindowCorners(IntPtr hWnd, bool smooth) {
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
                if (smooth) {
                    MoveSmoothTo(point.X, point.Y);
                } else {
                    MoveDirectTo(point.X, point.Y);
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
}
"@

$deviation = ${settings.deviation}
$frequencyMs = ${settings.frequency}
$smoothness = ${settings.smoothness}
$keepFocusOnTitle = ${settings.keepFocusOnTitle ? '$true' : '$false'}
$focusIntervalMs = ${settings.focusInterval}
$cornerIntervalMs = ${settings.cornerInterval}
$titleFilter = '${titleFilter}'
$enableMicroJiggle = ${settings.enableMicroJiggle ? '$true' : '$false'}
$enableCornerSmoothing = ${settings.enableCornerSmoothing ? '$true' : '$false'}
$lastFocusAt = [DateTime]::UtcNow.AddMilliseconds(-$focusIntervalMs)
$lastCornerAt = [DateTime]::UtcNow.AddMilliseconds(-$cornerIntervalMs)

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
        $now = [DateTime]::UtcNow
        if (($now - $lastCornerAt).TotalMilliseconds -ge $cornerIntervalMs) {
            $lastCornerAt = $now
            if (-not $targetWindow -or $targetWindow -eq [IntPtr]::Zero) {
                $targetWindow = [MouseNative]::FindWindowByTitleContains($titleFilter)
            }
            if ($targetWindow -ne [IntPtr]::Zero) {
                [MouseNative]::MoveCursorToWindowCorners($targetWindow, $enableCornerSmoothing)
            }
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
    state.settings = sanitizeSettings(rawSettings);

    if (state.isJigglerEnabled) {
      stopJiggler();
      return getState();
    }

    broadcastState();
    return getState();
  });
}

function createWindow() {
  const windowOptions = {
    width: 550,
    height: 550,
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

  state.win = new BrowserWindow(windowOptions);
  state.win.removeMenu();
  if (IS_WINDOWS) {
    const windowIcon = nativeImage.createFromPath(getWindowIconPath());
    if (!windowIcon.isEmpty()) {
      state.win.setIcon(windowIcon);
    }
  }

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

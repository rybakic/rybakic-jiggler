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
const IS_MACOS = process.platform === 'darwin';

// Mitigate early V8 init crashes observed on macOS by disabling compile hints.
if (IS_MACOS) {
  app.commandLine.appendSwitch('disable-features', 'V8CompileHints');
  app.commandLine.appendSwitch('js-flags', '--no-compile-hints --no-compilation-cache');
}

const DEFAULT_SETTINGS = {
  deviation: 10,
  frequency: 1000,
  smoothness: 10,
};

const TRAY_ICON_FILES = {
  active: 'active.ico',
  disabled: 'disable.ico',
  fallback: 'icon.ico',
};
const MAC_TRAY_ICON_FILES = {
  active: 'active.icns',
  disabled: 'disable.icns',
  fallback: 'icon.icns',
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
  };
}

function resolvePublicAsset(name) {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), 'public', name);
  }

  return path.join(__dirname, '..', 'public', name);
}

function getTrayIconPath(enabled) {
  if (IS_MACOS) {
    const macPreferred = resolvePublicAsset(enabled ? MAC_TRAY_ICON_FILES.active : MAC_TRAY_ICON_FILES.disabled);
    const macFallback = resolvePublicAsset(MAC_TRAY_ICON_FILES.fallback);

    if (fs.existsSync(macPreferred)) {
      return macPreferred;
    }

    if (fs.existsSync(macFallback)) {
      return macFallback;
    }
  }

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
  return `
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class MouseNative {
    public const uint MOUSEEVENTF_MOVE = 0x0001;

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);

    public static POINT GetCursorPosition() {
        POINT point;
        GetCursorPos(out point);
        return point;
    }
}
"@

$deviation = ${settings.deviation}
$frequencyMs = ${settings.frequency}
$smoothness = ${settings.smoothness}

while ($true) {
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
}
`;
}

function buildMacJigglerScript(settings) {
  return `
const app = Application.currentApplication();
app.includeStandardAdditions = true;

ObjC.import('Cocoa');
ObjC.import('ApplicationServices');

function getCursorPosition() {
    const point = $.NSEvent.mouseLocation;
    const height = $.NSScreen.mainScreen.frame.size.height;

    return {
        x: Number(point.x),
        y: Number(height - point.y),
    };
}

function moveMouse(x, y) {
    const point = $.CGPointMake(x, y);
    const event = $.CGEventCreateMouseEvent(
        null,
        $.kCGEventMouseMoved,
        point,
        $.kCGMouseButtonLeft
    );

    $.CGEventPost($.kCGHIDEventTap, event);
    $.CFRelease(event);
}

function sleepMs(milliseconds) {
    app.delay(milliseconds / 1000);
}

const deviation = ${settings.deviation};
const frequencyMs = ${settings.frequency};
const smoothness = ${settings.smoothness};

while (true) {
    const base = getCursorPosition();

    let dx = Math.floor(Math.random() * (deviation * 2 + 1)) - deviation;
    let dy = Math.floor(Math.random() * (deviation * 2 + 1)) - deviation;

    if (dx === 0 && dy === 0) {
        dx = 1;
    }

    const cycleMs = Math.max(frequencyMs, 100);
    const stepCount = Math.max(smoothness, 1);
    const motionBudgetMs = Math.min(Math.floor(cycleMs * 0.35), 220);
    const stepDelayMs = Math.max(Math.floor(motionBudgetMs / (2 * stepCount)), 1);
    const motionSpentMs = stepDelayMs * 2 * stepCount;

    for (let i = 1; i <= stepCount; i += 1) {
        const x = base.x + Math.round((dx * i) / stepCount);
        const y = base.y + Math.round((dy * i) / stepCount);
        moveMouse(x, y);
        sleepMs(stepDelayMs);
    }

    for (let i = 1; i <= stepCount; i += 1) {
        const x = base.x + dx - Math.round((dx * i) / stepCount);
        const y = base.y + dy - Math.round((dy * i) / stepCount);
        moveMouse(x, y);
        sleepMs(stepDelayMs);
    }

    const restMs = cycleMs - motionSpentMs;
    if (restMs > 0) {
        sleepMs(restMs);
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

  if (IS_MACOS) {
    return spawn('osascript', ['-l', 'JavaScript', '-e', buildMacJigglerScript(settings)], {
      stdio: 'ignore',
    });
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

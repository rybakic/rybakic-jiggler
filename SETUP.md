# SETUP (New PC)

## 1. Install tools

- Git
- Node.js 20+ (LTS recommended)
- npm (comes with Node.js)

Check:

```bash
node -v
npm -v
git --version
```

## 2. Clone project

```bash
git clone <YOUR_REPO_URL>
cd rybakic-jiggler
```

## 3. Install dependencies

```bash
npm install
```

## 4. Run in development

```bash
npm run dev
```

## 5. Build Windows installer

```bash
npm run build:win
```

Installer output:

- `release/setup_win64.exe`

## Important (Windows symlink issue)

Project uses:

- `build.win.signAndEditExecutable = true`

If build fails with:

- `Cannot create symbolic link` (winCodeSign cache extraction)

Do one of these:

1. Enable Windows Developer Mode
2. Run terminal as Administrator

Optional cleanup before retry:

```powershell
Remove-Item "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign" -Recurse -Force
```

Then run again:

```bash
npm run build:win
```

## What to send to users

Only this file is needed:

- `release/setup_win64.exe`

No need to send `win-unpacked` folder.

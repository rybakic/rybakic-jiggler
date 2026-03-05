# RYBAKIČ Mouse Jiggler

Простое десктопное приложение для имитации активности мыши на Windows и macOS.

## Демо

![Демо RYBAKIČ Mouse Jiggler](public/demo.gif)

## Что делает приложение

- Плавно смещает курсор и возвращает его в исходную точку.
- Включается и выключается глобальной горячей клавишей `F8`.

## Параметры

- `Отклонение` - расстояние смещения курсора в пикселях.
- `Частота` - интервал цикла в миллисекундах.
- `Плавность` - количество шагов интерполяции движения.

## Скачать приложение

Готовые пакеты для Windows (`.exe`) и macOS (`.dmg`) публикуются в разделе **Releases** этого репозитория на GitHub.

Откройте страницу репозитория -> **Releases** -> скачайте последний setup-файл.

[![Download](https://img.shields.io/badge/Download-Latest%20Release-brightgreen?style=for-the-badge&logo=github)](https://github.com/rybakic/rybakic-jiggler/releases)

## Быстрый старт (разработка)

```bash
npm install
npm run dev 
```

## Сборка установщика

```bash
npm run build:win
```

Результат:

- `release/setup_win64`

### Сборка для macOS

```bash
npm run build:mac
```

Результат:

- `release/setup_macOS.dmg`

### Сборка сразу для обеих платформ

```bash
npm run build:all
```

Примечание: для `macOS`-пакетов сборку нужно запускать на macOS.

## Примечания по сборке (Windows)

При `signAndEditExecutable: true` сборка может падать с ошибкой `Cannot create symbolic link` (распаковка кэша winCodeSign).

Как исправить:

- Включить Windows Developer Mode, или
- Запускать терминал от имени администратора.

Если нужно, очистите кэш и пересоберите:

```powershell
Remove-Item "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign" -Recurse -Force
npm run build:win
``` 

## Примечания для macOS

Для управления курсором приложению нужен доступ:

`System Settings -> Privacy & Security -> Accessibility`.

Добавьте приложение в список разрешенных.
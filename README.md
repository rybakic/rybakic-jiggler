# RYBAKIČ Mouse Jiggler

Простое десктопное приложение для имитации активности мыши на Windows.

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

Готовые `.exe` файлы публикуются в разделе **Releases** этого репозитория на GitHub.

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

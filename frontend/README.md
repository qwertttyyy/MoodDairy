# Moods frontend

React/TypeScript-клиент дневника настроения. В development Vite проксирует
`/api`, `/admin` и `/static` на Django по `http://localhost:8000`. Production
сборка — устанавливаемая PWA, но offline хранит только оболочку и не сохраняет
ответы API или пользовательские записи.

## Запуск

```bash
npm ci
npm run dev
```

Основные команды:

```bash
npm run format          # применить Prettier
npm run check           # format:check, lint, types, unit/component, build
npm run test:e2e        # короткий smoke-набор в Chromium
npm run test:e2e:all    # необязательная ручная проверка Firefox и WebKit
npm run test:pwa        # production SW, manifest, offline и Cache Storage
npm run generate:icons  # пересобрать PNG-иконки из public/favicon.svg
```

Для browser-тестов один раз установите движки:

```bash
npx playwright install chromium firefox webkit
```

## PWA-контракт

- Workbox precache содержит только HTML, хешированные JS/CSS, manifest,
  `theme-init.js` и иконки.
- `/api/**` всегда использует `NetworkOnly`; приложение автоматически
  проверяет, что API URL отсутствуют в Cache Storage.
- `/` и `/share/<token>/` открывают ранее сохранённую оболочку offline и
  объясняют, что данные требуют интернета.
- Новая версия service worker ожидает действия «Обновить» и не перехватывает
  работающую вкладку автоматически.
- Chromium install prompt доступен из настроек; на iOS показывается системная
  инструкция «Поделиться → На экран Домой».

Поддерживаются две последние версии Chrome, Edge и Firefox, Safari/iOS 16.4+.
Offline-чтение и offline-редактирование дневника не реализованы намеренно:
для них нужен отдельный дизайн защищённого хранилища и синхронизации.

## Production

`npm run build` дополнительно проверяет gzip budgets (80 KiB на JS chunk и
15 KiB CSS на начальный маршрут) и наличие обеих форм `backdrop-filter`.
Версия берётся из `package.json`, build SHA — из `GITHUB_SHA`/git.

Frontend публикуется в плоский `/var/www/moods`: хешированные assets копируются
до замены `index.html`, старые assets не удаляются. Production-конфигурация
nginx приведена как один самодостаточный
[`moods.example.conf`](../deploy/nginx/moods.example.conf). Production source
maps не публикуются.

# Полный план исправлений frontend и подготовки PWA

## Результат

Все исправления выполняются в одной ветке и попадают в один PR/одно общее изменение. Работа разделяется на последовательные тематические коммиты. Каждый коммит должен проходить сборку, проверку типов, линтер и относящиеся к нему тесты. Production-деплой выполняется только после слияния всего изменения.

После выполнения плана приложение должно:

- полноценно устанавливаться как PWA;
- открывать оболочку приложения без интернета;
- явно сообщать, что для записей, авторизации и общих ссылок нужен интернет;
- никогда не сохранять API-ответы и дневниковые записи в PWA-кеше;
- корректно работать на актуальных Chrome, Edge и Firefox, а также Safari/iOS 16.4+;
- не показывать пустой экран при проблемах запуска;
- корректно различать загрузку, ошибку и отсутствие данных;
- быть доступным с клавиатуры и для программ чтения с экрана;
- иметь проверяемые контракты API и более безопасную обработку шифрования;
- иметь автоматические component-, integration-, E2E-, accessibility- и PWA-тесты;
- безопасно и атомарно выкладываться через nginx без поломки уже открытых вкладок.

## План коммитов

### 1. `chore(frontend): strengthen quality toolchain`

- Обновить TypeScript до версии 7 и подключить совместимый `oxlint-tsgolint` для type-aware проверок.
- Включить `strict` и запретить прохождение CI при предупреждениях линтера.
- Исправить существующие Fast Refresh warnings: вынести хуки, контексты, константы и вспомогательные функции из файлов React-компонентов.
- Добавить Prettier и команды `format`, `format:check`, `typecheck`, `lint`, `test`, `test:e2e`, `test:pwa` и объединяющую обязательные проверки `check`.
- Добавить Testing Library, `user-event`, `jest-dom`, MSW, Playwright и `@axe-core/playwright`.
- Обновить lock-файл так, чтобы полный `npm audit` не содержал известной уязвимости `nanoid`.
- Настроить CI: установка через lock-файл, форматирование, линтер, типы, unit/component tests, production build и E2E.
- Не менять внешний вид или поведение приложения.

### 2. `refactor(frontend): validate API and crypto boundaries`

- Добавить Zod-схемы для конфигурации, auth/session, тегов, записей, группировки, диапазонов дат, sharing status и публичной ссылки.
- Получать типы из схем и убрать небезопасные `as T` при разборе ответов.
- Добавить ошибки сети, тайм-аута, HTTP/API, несовместимого API, формата шифротекста и расшифровки.
- Передавать `AbortSignal` из TanStack Query во все запросы.
- Тайм-ауты: bootstrap 12 секунд, обычные запросы 20 секунд, создание общей копии 60 секунд.
- Очищать таймеры и отменять запросы при размонтировании/смене запроса.
- Retry: один раз для сети и 5xx, без retry для 4xx, формата и crypto.
- Строго проверять шифротекст, Base64, IV 12 байт и непустое содержимое.
- Включить `noUncheckedIndexedAccess` и `exactOptionalPropertyTypes`.
- Не журналировать заметки, ключи, шифротекст и полные приватные API-ответы.

### 3. `fix(frontend): make startup and data failures recoverable`

- Добавить startup-состояния: загрузка, готово, offline, сервер недоступен, некорректная конфигурация и Retry.
- Не открывать дневник до валидной конфигурации шифрования.
- При ошибке локального шифрования после server login безопасно выйти.
- Централизовать `not_authenticated`: очистить session key и приватный query cache, показать вход и сообщение об истёкшей сессии.
- Не считать неправильные credentials истёкшей сессией.
- При истечении сессии сохранить wrapped key; при явном logout очистить все ключи.
- Добавить общий ErrorBoundary.
- Использовать Loading/Error/Empty/Ready и не показывать Empty при ошибке.
- Добавить ошибки и Retry для записей, графика, тегов и sharing.
- Повреждённые записи: безопасная карточка с датой и удалением; пропуск точки графика с предупреждением; запрет неполной общей ссылки; `Promise.allSettled`.

### 4. `fix(entries): complete CRUD, dates and sharing flows`

- Добавить обычную кнопку удаления в окно редактирования; swipe оставить дополнением.
- Удаление: pending, закрытие только после успеха, ошибка внутри открытого окна.
- `ConfirmProvider` принимает `() => void | Promise<void>`, блокирует повтор, не закрывается во время pending, закрывается после успеха и остаётся после ошибки.
- Применить к удалению записей/тегов, замене общей ссылки и выходу.
- Использовать единый helper локальной календарной даты для месяца, группировки, графика и публичной копии; убрать UTC/local расхождение у полуночи.
- Старую ссылку без ключа нельзя копировать; показать «Создать новую ссылку».
- Не заменять ссылку до загрузки статуса; предупредить, что старая ссылка сразу перестанет работать.
- Ключ ссылки — только память и URL hash, никогда сервер/localStorage.

### 5. `fix(a11y): make the application keyboard and screen-reader accessible`

- Удалить `user-scalable=no`.
- Перевести Modal на `<dialog>` с `showModal`, `aria-labelledby`, focus trap, Escape/backdrop policy, возвратом фокуса и вложенными подтверждениями.
- Начальный фокус: заголовок длинного контента, безопасная Cancel в опасном подтверждении.
- Не ставить `touch-action: none` на body; сохранять и точно восстанавливать старые inline styles.
- Кликабельные div заменить на button; связать toggle с label; сделать строки настроек кликабельными; добавить подписи/active state нижней навигации; tabs и управление стрелками.
- Добавить `<main>`, заголовки, `focus-visible`, `aria-invalid`/`aria-describedby`, live/status, alert и busy.
- Canvas получает текстовое описание и скрытую сводку.
- Зоны нажатия минимум 44×44, исправить контраст, `autocomplete="new-password"`.
- Reduced motion без бесконечного почти мгновенного spinner; диалоги без ожидания анимации.
- Непрозрачные карточки при `prefers-reduced-transparency`.

### 6. `fix(ui): stabilize theme, settings, charts and layout`

- Ранний внешний `theme-init.js`: сохранённая тема для приложения, системная для public page, без светлой вспышки и inline script.
- Public page реагирует на обе стороны смены system theme; синхронно обновляется `theme-color`.
- Убрать localStorage из state updater, сохранять в effect, сохранять неизвестные поля, обрабатывать ошибки, реагировать на storage event.
- График не показывает старые точки под новым периодом: фиксированный skeleton и Retry; ResizeObserver через rAF.
- Добавить 404.
- Ограничить diary/public до 720 px, выровнять dock; проверить 320 px и landscape без горизонтальной прокрутки.
- Package version `1.2.0`, Vite defines `__APP_VERSION__` и сокращённый `__BUILD_SHA__`, значения в настройках.

### 7. `perf(frontend): split routes, tabs and styles`

- Lazy chunks для дневника и public page через `React.lazy`/`Suspense`.
- Разделить CSS по токенам и компонентам/маршрутам.
- CSS minify через esbuild; build-check сохраняет `backdrop-filter` и `-webkit-backdrop-filter`.
- Монтировать tab при первом посещении, сохранять state/scroll, передавать `active`, отключать запросы скрытого tab.
- Feed после посещения home, sharing после settings, tags EntryModal только при открытом modal.
- `staleTime` около 30 секунд; без refetch на focus, с refetch после online.
- Без массового memo.
- Budgets: route initial JS ≤ 80 KiB gzip, initial CSS ≤ 15 KiB gzip, CI падает при превышении.

### 8. `feat(pwa): add installable offline application shell`

- `vite-plugin-pwa@1.3.x`, Workbox `generateSW`, `registerType: "prompt"`.
- Manifest Moods: id/start_url/scope `/`, standalone, темы, standard/maskable 192/512, Apple 180.
- Иконки из фирменного изображения с безопасными maskable-отступами.
- Precache только app shell: HTML, hashed JS/CSS, icons, manifest, `theme-init.js`.
- `/api/**` — `NetworkOnly`; не кешировать entries/tags/auth/config/share.
- Navigation fallback `/` и `/share/*`, отсутствующие assets остаются 404.
- Offline shell с ясным сообщением и Retry; public offline сообщает, что нужен интернет.
- Update SW только по согласию, кнопка «Обновить» активирует worker и reload.
- Установка в settings: Chromium prompt, скрытие standalone, iOS-инструкция, честный fallback.
- Автотест отсутствия `/api` в Cache Storage.

### 9. `deploy(frontend): add secure atomic nginx deployment and runbook`

- Production nginx template: navigation-only SPA fallback, direct `/share`, asset 404, Content-Type, no-cache для HTML/manifest/sw/theme init, immutable hashed assets.
- Security headers: same-origin CSP, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`, `worker-src 'self'`, Permissions-Policy без camera/microphone/geolocation, HSTS/nosniff/Referrer-Policy.
- Разрешить только нужную часть inline style CSP; не разрешать inline scripts.
- Releases: `/var/www/moods/releases/<sha>/`, `/shared/assets/`, атомарный `/current` symlink.
- Workflow: build, upload temp SHA, shared assets, validate references, release, atomic switch, smoke, rollback.
- Хранить 5 releases; shared assets удалять только старше 30 дней и после проверки ссылок сохранённых releases.
- Одноразовая migration-инструкция с `nginx -t` перед reload.
- README: честные offline-возможности, браузеры, install/update, cache policy, runbook, smoke и rollback.

## Изменения внутренних интерфейсов

- `AuthContext`: startup states, startup error, `retryBootstrap`.
- API client: Zod schema, `AbortSignal`, timeout.
- Query functions используют TanStack Query `signal`.
- `ConfirmProvider`: `() => void | Promise<void>`, pending/error.
- `Modal`: обязательный доступный заголовок, initial focus, close lock.
- Decrypt result: union корректной/повреждённой записи.
- Chart result включает `corruptedCount`.
- Backend API и корректный encrypted format не меняются; миграций БД нет.

## Автоматические проверки

### Unit и component

- Все успешные/ошибочные API-ответы, abort/timeout, retry policy, ciphertext/IV.
- Частично повреждённые записи, локальные даты и UTC-midnight.
- Bootstrap load/error/offline/Retry, session expiry/re-login.
- CRUD мышью/клавиатурой, async confirm/error.
- Ошибка не становится Empty; старая/новая share link.
- Theme/storage sync; chart period без stale points.

### Playwright E2E

- Register/login/logout/session expiry; entry CRUD; tags.
- Dialog focus/Tab/Shift+Tab/Escape/nested/return focus.
- Share create/copy/replace/revoke.
- Сетевые ошибки, corrupted entry, direct share и 404.
- Light/dark/system; 320 px, mobile portrait/landscape/desktop.

### Accessibility и PWA

- Axe без serious/critical в основных авторизованных сценариях.
- Lighthouse CI: Performance ≥ 90, public Accessibility 100, Best Practices ≥ 95.
- Manifest/icons/standalone/SW; offline shell/message; user-approved waiting SW.
- Cache Storage без `/api`; missing asset возвращает 404, не HTML.

### Production smoke

- `/`, manifest, `sw.js`, direct `/share/test/`, missing asset 404, immutable assets.
- CSP не блокирует приложение/SW.
- Старые вкладки продолжают грузить assets после switch.
- Rollback без пересборки.

## Критерии готовности

- Девять коммитов в одной ветке/общем изменении; каждый отдельно проходит относящиеся проверки.
- `npm audit` без известных уязвимостей.
- `format:check`, lint без warnings, typecheck, unit tests, E2E и production build проходят CI.
- PWA устанавливается и открывает shell offline; API/user data не попадают в SW cache.
- Нет пустого startup и нет Error→Empty.
- CRUD доступен мышью, касанием и клавиатурой.
- Production deployment атомарен и rollback проверяем.

## Принятые ограничения

- Offline-чтение/редактирование дневника не входят: нужен отдельный дизайн защищённого локального хранилища и conflict sync.
- Внешний вид сохраняется; дизайн меняется только ради доступности, читаемости, адаптивности и bugfix.
- Backend API совместим, миграций нет.
- Сторонний error monitoring не добавляется из-за чувствительности данных.
- Public source maps не публикуются.
- Поддержка ниже Safari/iOS 16.4 и старше двух последних Chrome/Edge/Firefox не гарантируется.

## Прогресс

- [x] 1. Quality toolchain
- [x] 2. API и crypto boundaries
- [ ] 3. Startup и data failures
- [ ] 4. CRUD, даты и sharing
- [ ] 5. Accessibility
- [ ] 6. Theme, settings, charts и layout
- [ ] 7. Performance и splitting
- [ ] 8. PWA
- [ ] 9. Nginx deployment и runbook

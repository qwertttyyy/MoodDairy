# План: перенос фронтенда на React и переход к монорепе backend + frontend

> Документ для агента-исполнителя. Все пути указаны от корня репозитория.
> Принцип миграции: старый фронтенд (Django-шаблоны) живёт до последнего этапа,
> ката (cutover) — одним финальным коммитом.

## 1. Цель

- Переписать фронтенд (vanilla JS SPA) на React, разместить в `frontend/` в корне.
- Бэкенд (`backend/`, Django 6 + DRF) остаётся API + админкой, шаблоны и статика приложения из него удаляются.
- Инфраструктура: отдельные Dockerfile для backend и frontend, nginx-контейнер раздаёт SPA и проксирует API.
- CI/CD дополняется проверками и сборкой фронтенда.

## 2. Текущее состояние (что важно знать)

| Что | Где |
|-----|-----|
| SPA-шаблон (auth, лента, график, настройки, модалки) | `backend/templates/index.html` |
| Страница врача (read-only) | `backend/templates/share.html` |
| Вся логика приложения (~1500 строк): crypto, api, auth, entries, chart (canvas), share, settings | `backend/static/app.js` |
| Логика страницы врача (~400 строк) | `backend/static/share.js` |
| Дизайн-система: CSS-переменные, `data-theme`, liquid-glass | `backend/static/styles.css` |
| Роуты шаблонов и API | `backend/config/urls.py` |
| Сервисы compose: `db`, `redis`, `backend` (gunicorn на 127.0.0.1:8000) | `docker-compose.yml` |
| CI: paths-filter → тесты в docker → деплой по SSH (git pull + rebuild) | `.github/workflows/deploy.yml` |

Особенности:
- Аутентификация — сессионная (cookie) + CSRF-токен из cookie `csrftoken`. Сейчас cookie ставится через `ensure_csrf_cookie` на view шаблона `index.html`.
- Флаг `ENCRYPTION_ENABLED` пробрасывается в шаблон как `window.__APP_CONFIG__`.
- В проде статику отдаёт внешний (вне репозитория) reverse proxy на хосте, который проксирует на 127.0.0.1:8000; каталог `./staticfiles` смонтирован в контейнер.
- Клиентское шифрование: PBKDF2 (600 000 итераций, SHA-256) → AES-256-GCM, формат хранения `ivB64:ctB64`.

## 3. Ключевые решения

| Область | Решение | Альтернатива (почему нет) |
|---------|---------|---------------------------|
| Сборка | **Vite** (актуальный мажор) | CRA мёртв; Next.js избыточен — SSR не нужен, есть готовый DRF API |
| Язык | **TypeScript** | JS проще на старте, но типизация слоёв crypto/api (байты vs base64, формы ответов DRF) убирает целый класс ошибок; шаблон Vite для TS стандартен |
| Роутинг | **react-router**, 2 роута: `/` и `/share/:token` | Свой роутер — экономия 0, ошибок больше |
| Серверное состояние | **TanStack Query** (`useQuery`, `useInfiniteQuery`, инвалидация после мутаций) | Ручные хуки, как в старом коде — придётся самому писать кэш/сброс/гонки; Redux избыточен |
| Клиентское состояние | React Context: `AuthProvider` (сессия + crypto-ключ), `SettingsProvider` (тема и пр. в localStorage) | — |
| График | **Портировать существующий canvas-код как есть** в компонент `MoodChart` (чистая функция от данных: рисование, SMA-сглаживание, подписи) | Recharts/Chart.js — не воспроизведут текущий дизайн 1-в-1, лишний бандл |
| Стили | **Перенести `styles.css` как есть** (глобальный импорт), классы сохраняются | Tailwind/CSS-modules — переделка всего дизайна не входит в задачу |
| Раздача SPA в проде | **nginx-контейнер** `frontend`: статика SPA + прокси `/api/`, `/admin/`, `/static/` на backend | Вшивать build в Django (whitenoise + шаблон с manifest) — сильная связка, сложнее кэшировать |
| Статика админки | **WhiteNoise** в backend (nginx проксирует `/static/` на gunicorn) | Общий volume nginx↔backend — лишняя связность контейнеров |
| Конфиг фронта | Эндпоинт **`GET /api/config/`** (`AllowAny` + `ensure_csrf_cookie`): отдаёт `{"encryption_enabled": bool}` и заодно ставит CSRF-cookie | Build-time env — потребовал бы разные сборки для разных режимов |
| Тесты фронта | **Vitest**: crypto (roundtrip, формат, wrap/unwrap), `parseErrors`. Компонентные тесты — вне обязательного объёма | — |

## 4. Инварианты — ломать нельзя

1. **Формат шифрования**: `ivB64:ctB64`, IV 12 байт, AES-256-GCM, PBKDF2 600 000 итераций SHA-256. Старые данные в БД должны расшифровываться новым фронтом.
2. **Ключи хранилищ браузера** (иначе действующие пользователи потеряют сессию/ключ после деплоя):
   - `sessionStorage["enc_key"]` — raw-ключ base64;
   - `localStorage["wrapped_enc_key"]` — обёрнутый ключ `ivB64:ctB64`;
   - `localStorage["moods_settings"]` — JSON `{darkMode, reduceTransparency, chartSmooth}`.
3. **Контракт API не меняется** (см. §5). Разрешено только добавить `GET /api/config/`.
4. **URL ссылки врача**: `/share/<token>/` + ключ в URL-фрагменте `#<keyB64>`. Старые ссылки должны открываться в новом SPA. Фрагмент никогда не уходит на сервер.
5. Страница врача работает **без авторизации** и не должна дёргать `/api/config/`, `/api/auth/*`.
6. UI, тексты и поведение — 1-в-1 со старым фронтом (включая тёмную тему, «уменьшить прозрачность», плавный/резкий график, памятки, бесконечную прокрутку).
7. Все константы (`MOOD_COLORS/LABELS/EMOJI/GUIDE`, `ANXIETY_*`, `MONTH_NAMES`) переносятся без изменений из `backend/static/app.js:7-35`.

## 5. Контракт API (сверено с кодом views)

Аутентификация — сессия; для мутаций заголовок `X-CSRFToken` из cookie `csrftoken`; `credentials: same-origin`.

| Метод и путь | Запрос → Ответ |
|---|---|
| `POST /api/auth/register/` | `{username, password, encryption_salt}` → `201 {id, username, wrapping_key}` |
| `POST /api/auth/login/` | `{username, password}` → `{id, username, wrapping_key}` |
| `POST /api/auth/logout/` | → `204` |
| `GET /api/auth/me/` | → `{id, username}` (401 если нет сессии) |
| `GET /api/auth/profile/` | → `{encryption_salt}` |
| `GET /api/auth/unwrap-key/` | → `{wrapping_key}` либо `401` |
| `GET /api/entries/?period=\|?year=&month=` | → `[{id, mood, note, anxiety, tags:[{id,name}], timestamp}]` (mood/note/anxiety — шифротекст) |
| `GET /api/entries/grouped/?before=YYYY-MM-DD` | → `{results: {"YYYY-MM-DD": [entry,…]}, next_before}` |
| `GET /api/entries/date-range/` | → `{first_date}` |
| `GET /api/entries/export/` | → файл JSON (открывать через `window.location.href`) |
| `POST /api/entries/` / `PUT /api/entries/{id}/` | `{mood, note, anxiety, tags:[id], timestamp}` |
| `DELETE /api/entries/{id}/` | → `204` |
| `GET /api/tags/` | → `[{id, name}]` |
| `GET /api/sharing/` | → `{active:false}` либо `{active:true, token, created_at, is_encrypted}` |
| `POST /api/sharing/` | `{data_blob, is_encrypted}` → `201 {token}` |
| `DELETE /api/sharing/` | → `200` либо `204` (активной не было) |
| `GET /api/sharing/{token}/data/` | публичный → `{data_blob, is_encrypted}`, `410` если недействительна |
| `GET /api/config/` **(добавить)** | публичный → `{encryption_enabled}`; ставит CSRF-cookie |

Обработка ошибок DRF — перенести `Api.parseErrors` из `app.js:234-244`.

## 6. Целевая структура репозитория

```
MoodDairy/
├── backend/
│   ├── Dockerfile            # перенесён из корня, контекст ./backend
│   ├── entrypoint.sh         # перенесён из корня
│   ├── requirements.txt      # перенесён из корня (+ whitenoise)
│   ├── config/ accounts/ entries/ sharing/ core/   # без изменений моделей
│   └── manage.py
├── frontend/
│   ├── Dockerfile            # multi-stage: node build → nginx
│   ├── nginx.conf
│   ├── index.html
│   ├── package.json / vite.config.ts / tsconfig.json / eslint.config.js
│   └── src/
│       ├── main.tsx                    # роутер, QueryClient, провайдеры
│       ├── pages/AppPage/              # экран авторизации + оболочка с табами
│       ├── pages/SharePage/            # страница врача
│       ├── features/
│       │   ├── auth/                   # формы, AuthProvider, tryRestore
│       │   ├── entries/                # лента (useInfiniteQuery), карточка, модалка записи
│       │   ├── chart/                  # MoodChart (canvas), фильтры периодов, MonthPicker
│       │   ├── sharing/                # блок «доступ для врача» в настройках
│       │   └── settings/               # тумблеры темы/прозрачности/графика, экспорт, выход
│       └── shared/
│           ├── api/client.ts           # fetch-обёртка + CSRF + parseErrors
│           ├── crypto/crypto.ts        # порт модуля Crypto (+ тесты рядом)
│           ├── constants.ts            # MOOD_*, ANXIETY_*, MONTH_NAMES
│           ├── lib/dates.ts            # dayLabel, formatTime, isoDateStr…
│           ├── ui/                     # Modal, ConfirmDialog, Toast, Toggle, Spinner
│           └── styles/styles.css       # перенесённый styles.css
├── plans/
├── docker-compose.yml        # db, redis, backend, frontend
├── docker-compose.test.yml   # контекст сборки ./backend
└── .github/workflows/deploy.yml
```

## 7. Этапы

### Этап 0 — подготовка бэкенда (аддитивно, ничего не ломает)

1. Эндпоинт `GET /api/config/`: `APIView`, `permission_classes=(AllowAny,)`, метод обёрнут `ensure_csrf_cookie` (`@method_decorator`), ответ `{"encryption_enabled": settings.ENCRYPTION_ENABLED}`. Разместить в `core/` (добавить `core/views.py`, `core/urls.py`, включить в `config/urls.py` под `api/`).
2. Тест на эндпоинт (наличие cookie `csrftoken` в ответе, корректный флаг).

**Готово, когда**: старый фронт работает как раньше, `curl localhost:8000/api/config/` отдаёт флаг и Set-Cookie.

### Этап 1 — каркас frontend

1. `npm create vite@latest frontend -- --template react-ts`, зафиксировать актуальные мажоры: react, react-router, @tanstack/react-query, vitest.
2. `vite.config.ts` — dev-прокси, чтобы работать против локального Django (cookie same-origin, CORS не нужен):
   ```ts
   server: { proxy: { '/api': 'http://localhost:8000', '/admin': 'http://localhost:8000', '/static': 'http://localhost:8000' } }
   ```
3. Перенести `backend/static/styles.css` → `frontend/src/shared/styles/styles.css`, подключить глобально. `index.html`: `<html lang="ru" data-theme="light">`, meta viewport и шрифт Nunito — как в `backend/templates/index.html:2-13`.
4. `.gitignore` в корне: добавить `node_modules/`, `frontend/dist/`.
5. Роуты: `/` → AppPage, `/share/:token` → SharePage (заглушки).

**Готово, когда**: `npm run dev` открывает пустые страницы со стилями и фоном-blobs, `npm run build` и `npm run lint` проходят.

### Этап 2 — shared-слой: crypto, api, константы (+ тесты)

1. `shared/crypto/crypto.ts` — прямой порт объекта `Crypto` из `app.js:109-207` (deriveKey, generateSalt, encrypt/decrypt, wrapKey/unwrapKey, storeFromDerived, hasKey/hasWrapped, clear). Ключи хранилищ — из §4. Флаг шифрования передавать параметром/через модульный setter (берётся из `/api/config/`), а не из `window.__APP_CONFIG__`.
2. `shared/api/client.ts` — порт `Api` (`app.js:213-245`): fetch-обёртка с `X-CSRFToken` из cookie, `credentials: 'same-origin'`, `parseErrors`.
3. `shared/constants.ts`, `shared/lib/dates.ts` — порт констант и date-утилит (`app.js:7-72`).
4. Vitest: roundtrip encrypt→decrypt; проверка формата (`iv:ct`, IV 12 байт); wrap→unwrap; decrypt заранее зашифрованного вектора (сгенерировать в тесте независимым кодом WebCrypto с теми же параметрами); `parseErrors` на строке/`detail`/`non_field_errors`/полевых ошибках. В окружении тестов нужен `happy-dom`/`jsdom` + доступный `globalThis.crypto` (Node ≥20 — есть).

**Готово, когда**: `npm run test` зелёный.

### Этап 3 — авторизация и оболочка приложения

1. `AuthProvider`: bootstrap-последовательность — `GET /api/config/` → `tryRestore` (порт `app.js:325-342`: `/me/` → есть ключ? → `unwrap-key`) → состояние `loading | anon | authed`.
2. Экран входа/регистрации (порт `Auth` из `app.js:251-355` и разметки `index.html:29-52`): табы, валидация, деривация ключа при регистрации/логине, wrap ключа, обработка ошибок.
3. Оболочка: шапка, таб-бар с анимированным индикатором (`TabNav`, `app.js:1187-1229`), три таба. Индикатор — через `ref` + пересчёт на resize.
4. Выход: подтверждение, `Crypto.clear()`, `POST /logout/`, сброс состояния (порт `app.js:344-348`).

**Готово, когда**: в dev-режиме против локального Django работают регистрация, вход, восстановление сессии по F5, выход.

### Этап 4 — записи

1. Лента: `useInfiniteQuery` по `/api/entries/grouped/` с курсором `next_before`; расшифровка в `select`/маппере (порт `_decryptEntry`, `app.js:425-432`); группировка по дням, метки «Сегодня/Вчера»; бесконечная прокрутка (IntersectionObserver на элементе-лоадере вместо scroll-листенера); пустое состояние.
2. Карточка записи (порт `_cardHTML`) — бейдж настроения, бейдж тревоги, заметка, теги, время, кнопка удаления. Вместо `innerHTML` — JSX; экранирование больше не нужно (React экранирует сам).
3. Модалка записи (порт `EntryModal`, `app.js:543-704`): пикеры настроения 1–9 и тревоги 1–5 (повторный клик по тревоге — сброс), заметка, теги-чипы (`/api/tags/` через `useQuery`), дата/время с ограничением «не в будущем», create/update с шифрованием.
4. Подтверждение удаления (порт `Confirm`) — переиспользуемый `ConfirmDialog`.
5. Памятка (порт `MoodGuide`, `app.js:738-825`): табы «Настроение/Тревога», кликабельный выбор оценки, если открыта модалка записи.
6. После мутаций — инвалидация запросов записей и графика; Toast-уведомления; блокировка прокрутки body при открытых модалках.

**Готово, когда**: полный CRUD-цикл записей с тегами и тревогой визуально и поведенчески совпадает со старым фронтом.

### Этап 5 — график, настройки, доступ для врача

1. `MoodChart`: canvas-рисование — прямой порт `Chart._draw/_sma/_stats` (`app.js:994-1172`) в компонент с `useRef`; пропсы: `entries`, `smooth`, `isMonthMode`; перерисовка через ResizeObserver (debounce 150 мс). Расшифровка mood для графика — как в `_fetchAndDraw`.
2. Фильтры периодов (сегмент-контрол с индикатором) и `MonthPicker` (порт `app.js:831-920`): границы из `/api/entries/date-range/`, clamp по текущему месяцу.
3. Настройки (порт `Settings`, `app.js:1235-1283`): тумблеры темы/прозрачности/плавности — состояние в `localStorage["moods_settings"]`, применение `data-theme` и класса `reduce-transparency` на `<html>`; экспорт JSON; выход.
4. Доступ для врача (порт `Share`, `app.js:1289-1401`): статус активной ссылки, создание (выгрузка всех записей → расшифровка → перешифровка одноразовым ключом → `POST /api/sharing/` → URL с `#key`), копирование, отзыв. Поведение «полная ссылка показывается только при создании» сохранить.

**Готово, когда**: все периоды графика, помесячная навигация, статистика, экспорт и жизненный цикл ссылки работают как раньше.

### Этап 6 — страница врача (`/share/:token`)

1. Порт `share.js` целиком: чтение токена из пути и ключа из `location.hash`, загрузка `/api/sharing/{token}/data/`, расшифровка blob (или JSON.parse при `is_encrypted=false`), помесячная навигация, график (переиспользовать `MoodChart`), статистика с тревогой, список записей по дням, состояния «загрузка/ошибка/нет ключа».
2. Автотема по `prefers-color-scheme` (как в `share.js:70-72`), без записи в настройки.

**Готово, когда**: ссылка, созданная в приложении, открывается в приватном окне и полностью читается.

### Этап 7 — инфраструктура

1. Перенести `Dockerfile`, `entrypoint.sh`, `requirements.txt` в `backend/`; в Dockerfile `COPY . .` (контекст станет `./backend`), путь до entrypoint скорректировать.
2. WhiteNoise: добавить в `requirements.txt`, middleware сразу после `SecurityMiddleware`. `collectstatic` в entrypoint остаётся (нужен админке).
3. `frontend/Dockerfile` (multi-stage):
   ```dockerfile
   FROM node:22-alpine AS build
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   COPY . .
   RUN npm run build

   FROM nginx:1.27-alpine
   COPY nginx.conf /etc/nginx/conf.d/default.conf
   COPY --from=build /app/dist /usr/share/nginx/html
   ```
4. `frontend/nginx.conf`: gzip; `location /` → `try_files $uri /index.html` (для `index.html` — `no-cache`, для хэшированных ассетов — длинный `Cache-Control`); `location /api/` , `/admin/`, `/static/` → `proxy_pass http://backend:8000` с пробросом `Host`, `X-Forwarded-Proto`, `X-Forwarded-For`.
5. `docker-compose.yml`:
   - `backend`: `build: ./backend`, порт наружу больше не публикуется, volume `./staticfiles` удалить;
   - `frontend`: `build: ./frontend`, `ports: ["127.0.0.1:8000:80"]`, `depends_on: backend` — хостовый reverse proxy менять не нужно (он уже смотрит на 127.0.0.1:8000);
   - `db`, `redis` — без изменений.
6. `docker-compose.test.yml`: `build: ./backend`.
7. Ката: удалить `backend/templates/`, `backend/static/`, из `config/urls.py` убрать `app_view`, роут `share/<token>/` и DEBUG-раздачу статики фронта (роут админки и API остаются).

**Готово, когда**: чистый `docker compose up -d --build` на машине разработчика поднимает всё; на `http://localhost:8000` работает полный сценарий из §9, `/admin/` открывается со стилями.

### Этап 8 — CI/CD (`.github/workflows/deploy.yml`)

1. `changes`-фильтры: `code` → `backend/**`, `docker-compose.test.yml`; новый фильтр `frontend` → `frontend/**`; `deploy` → объединение + `docker-compose.yml`.
2. Новый job `frontend-checks` (при `frontend == 'true'`): `actions/setup-node@v4` (node 22, cache npm по `frontend/package-lock.json`), `npm ci`, `npm run lint`, `npm run test -- --run`, `npm run build`; `working-directory: frontend`.
3. `test` (бэкенд) — без изменений, кроме уже сделанного `--exit-code-from backend`.
4. `deploy`: зависит от `[changes, test, frontend-checks]`, условие — оба результата `success || skipped`; в SSH-скрипте:
   ```
   docker compose build backend frontend
   docker compose up -d --remove-orphans backend frontend
   ```
   `--remove-orphans` обязателен: сервис переименован, старый контейнер надо убрать.

**Готово, когда**: пуш только в `frontend/**` не гоняет бэкенд-тесты и наоборот; деплой обновляет оба контейнера.

### Этап 9 — документация и чистка

1. README: стек (React + TS + Vite + TanStack Query, nginx), новая структура, dev-режим (см. §8), обновлённый быстрый старт. Раздел API дополнить `/api/config/`.
2. Убедиться, что `staticfiles/` больше не нужен в корне (gitignore уже есть; на сервере каталог можно удалить).
3. Финальный прогон чек-листа §9.

## 8. Режим разработки (зафиксировать в README)

- Бэкенд: `docker compose up -d db redis` + `python manage.py runserver` из `backend/` (либо целиком в docker).
- Фронтенд: `cd frontend && npm run dev` → http://localhost:5173, запросы уходят через vite-прокси на :8000, cookie-сессия работает без CORS-настроек.
- Старый фронт на :8000 продолжает работать до этапа 7 — удобно сравнивать поведение бок о бок.

## 9. Чек-лист приёмки (вручную, `docker compose up -d --build`, чистый профиль браузера)

1. Регистрация нового пользователя → создание записи (настроение, тревога, заметка, теги, дата/время).
2. F5 → сессия и ключ восстановились без ввода пароля (unwrap-key).
3. Лента: группировка по дням, бесконечная прокрутка, редактирование, удаление с подтверждением.
4. График: все периоды, помесячная навигация с границами, статистика, плавный/резкий режим.
5. Настройки: тёмная тема (переживает F5), прозрачность, экспорт JSON.
6. Ссылка врача: создать → открыть в приватном окне (график, тревога, записи по месяцам) → отозвать → ссылка отдаёт «недействительна».
7. Выход → вход существующим пользователем: старые записи расшифровываются (инвариант формата).
8. `/admin/` работает, статика админки на месте.
9. Тесты: `docker compose -f docker-compose.test.yml up --build --exit-code-from backend` зелёный; `npm run test`, `npm run lint`, `npm run build` зелёные.

## 10. Риски и примечания

- **Web Crypto требует secure context** (https или localhost) — в проде https уже есть, в dev работаем на localhost. Ничего делать не нужно, просто не тестировать по голому http с другого хоста.
- **Кэш браузеров после ката**: имена ассетов у Vite хэшированные, `index.html` отдаётся с `no-cache` — старые клиенты подтянут новый бандл сами.
- **Переименование compose-сервисов** (`web`→`backend`, новый `frontend`): без `--remove-orphans` на сервере останется висеть старый контейнер, держащий порт 8000.
- **Хостовый reverse proxy вне репозитория**: менять не требуется (порт 8000 сохраняется за контейнером `frontend`). Проверить после деплоя: если на хосте была отдельная location для `/static/` с alias на `./staticfiles` — удалить её, статику теперь отдаёт цепочка nginx→whitenoise.
- **`pg_data/` в корне принадлежит postgres (root)** — не трогать, в контекст сборки не попадает (Dockerfile переезжает в `backend/`); при желании добавить `.dockerignore`.
- Порядок этапов 0–6 строгий; 7–8 можно делать параллельно после 6.
